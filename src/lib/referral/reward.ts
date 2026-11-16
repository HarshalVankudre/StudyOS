/**
 * The reward: REFERRAL_CREDITS to the invited friend and to the inviter,
 * once, after the friend's first charged workspace build (server-only).
 *
 * The build route marks the pending referral qualified (`qualifiedAt`) when
 * a build was saved AND charged (a failure or a build charged nothing never
 * qualifies; a charge completed by the hold's release after a failed settle
 * does), then tries the reward right away (rewardQualifiedReferral, best
 * effort, bounded in time, never failing the build). A reward that has to
 * wait (the friend's email is not verified yet, Clerk cannot be reached, a
 * database error, the daily ceiling, the program paused) stays pending and is
 * tried again by the friend's next charged build and by the maintenance job
 * (retryPendingReferralRewards).
 *
 * Checked at reward time, from Clerk (one call for both users):
 *  - the friend exists and is not banned (else: skipped, like a deleted
 *    account) nor locked out (else: wait; Clerk lifts a lockout by itself),
 *    and their primary email is verified (else: wait);
 *  - the friend's Clerk account is no older than the attribution allows
 *    (else: rejected, account_not_new);
 *  - the inviter still exists, in Clerk, not banned, and without a deletion
 *    tombstone (else: rejected, referrer_deleted); locked out: wait;
 *  - the two primary emails are not the same mailbox once +tags, case and
 *    Gmail dots are ignored (else: rejected, same_email).
 * Clerk unreachable is never a rejection: the referral waits.
 *
 * Then, using only the credits module's grant primitives, in two
 * transactions:
 *  1. under the FRIEND's credit lock and their mailbox's lock (mailbox.ts):
 *     re-read the row (still pending, or another run decided it). If the
 *     friend's grant is already in the ledger (key referral:referee:<friend>)
 *     an earlier run decided the reward: only the inviter's half is left.
 *     Otherwise the decision is made and written here, atomically: a check
 *     above failed, or the friend's mailbox already earned a friend bonus on
 *     another account (rejected, mailbox_reused), and the row is rejected in
 *     this transaction; or the daily ceiling across everyone is reached
 *     (wait, and the operator is alerted once a day per server; a soft
 *     ceiling, see mailbox.ts); or the friend's grant
 *     (grantCreditsTx) and its mailbox row are written. A rejection therefore
 *     can never land after the friend was granted, nor a grant after a
 *     rejection: both happen only under this lock, on a pending row with no
 *     friend grant.
 *  2. under the INVITER's credit lock and their mailbox's lock, in one
 *     transaction: re-read the row, count the inviter's earlier
 *     referral_referrer grants in their own ledger AND their mailbox's
 *     inviter grants across all its accounts (all time, and the last 24
 *     hours), grant theirs (key referral:referrer:<friend>) only below
 *     REFERRAL_MAX_REWARDS and REFERRAL_MAX_PER_DAY on both counts, record
 *     the mailbox row, and mark the row rewarded with what the inviter got
 *     (a conditional update on `pending`). The locks serialize every reward
 *     of one inviter account and of one inviter mailbox, so parallel rewards
 *     can never pass the caps; neither count drops when a friend deletes
 *     their account.
 * Lock order is always one user's credit lock, then one mailbox lock.
 * Both ledger keys make every step idempotent: a retry after a failure
 * between 1 and 2 finds the friend's grant done and completes the inviter's
 * part.
 */
import "server-only";

import { clerkClient } from "@clerk/nextjs/server";
import { prisma } from "@/lib/db";
import { grantCreditsTx, withUserCreditLock } from "@/lib/credits";
import { reportError } from "@/lib/ops/report-error";
import {
  REFERRAL_CREDITS,
  REFERRAL_MAX_FRIEND_GRANTS_PER_DAY,
  REFERRAL_MAX_PER_DAY,
  REFERRAL_MAX_REWARDS,
} from "@/lib/price-list";
import {
  REFERRAL_NEW_ACCOUNT_MS,
  REFERRAL_REASON_REFEREE,
  REFERRAL_REASON_REFERRER,
  refereeGrantKey,
  referralsEnabled,
  referrerGrantKey,
  type ReferralRejectReason,
  type ReferrerOutcome,
} from "./config";
import {
  emailIdentity,
  friendGrantsSince,
  lockMailbox,
  mailboxGrants,
  mailboxHash,
  recordMailboxGrant,
  referralMailboxKey,
} from "./mailbox";

export { emailIdentity } from "./mailbox";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/** What the reward checks need to know about one user, from Clerk. */
export interface ClerkFacts {
  id: string;
  /** Account creation, ms since the epoch. */
  createdAt: number;
  email: string | null;
  emailVerified: boolean;
  /** Banned by the operator: treated like a deleted account. */
  banned?: boolean;
  /** Locked out after failed sign-ins (Clerk lifts it after a while): the reward waits. */
  locked?: boolean;
}

export interface RewardDeps {
  /** The users that exist among `ids`, in one call. Throws when Clerk cannot be reached. */
  lookupUsers: (ids: string[]) => Promise<ClerkFacts[]>;
  now: () => Date;
  /** The mailbox register's key (mailbox.ts referralMailboxKey by default). */
  mailboxKey?: () => Buffer | null;
}

/** The users among `ids` from Clerk's backend API (missing ones are left out). */
export async function clerkLookupUsers(ids: string[]): Promise<ClerkFacts[]> {
  const client = await clerkClient();
  const { data } = await client.users.getUserList({ userId: ids, limit: ids.length });
  return data.map((user) => {
    const primary = user.primaryEmailAddress ?? null;
    return {
      id: user.id,
      createdAt: user.createdAt,
      email: primary?.emailAddress ?? null,
      emailVerified: primary?.verification?.status === "verified",
      banned: user.banned,
      locked: user.locked,
    };
  });
}

const DEFAULT_DEPS: RewardDeps = { lookupUsers: clerkLookupUsers, now: () => new Date() };

export type RewardOutcome =
  /** No pending referral for this friend (none, or already decided). */
  | { kind: "none" }
  /** Pending, tried again later. */
  | {
      kind: "waiting";
      why:
        | "not_qualified"
        | "unverified_email"
        | "clerk_unavailable"
        | "account_locked"
        | "daily_ceiling"
        | "no_key"
        | "paused";
    }
  | { kind: "rejected"; reason: ReferralRejectReason }
  | { kind: "rewarded"; referrer: ReferrerOutcome }
  /** The friend's account is gone (or banned), or a parallel run decided the referral first. */
  | { kind: "skipped"; why: "deleted_account" | "already_decided" };

/**
 * The once-a-day alert when friend bonuses hit the daily ceiling (per server
 * instance; on globalThis so every bundle of this module shares it).
 */
const ceilingAlert = globalThis as typeof globalThis & { __studyosReferralCeilingAlertAt?: number };

function alertDailyCeiling(now: Date): void {
  const last = ceilingAlert.__studyosReferralCeilingAlertAt;
  if (last !== undefined && now.getTime() - last < DAY_MS) return;
  ceilingAlert.__studyosReferralCeilingAlertAt = now.getTime();
  reportError(
    new Error(
      `Invite friend bonuses reached the daily ceiling (${REFERRAL_MAX_FRIEND_GRANTS_PER_DAY} in 24 hours): ` +
        "new rewards wait. Check the Referrals section of the operator console for farming.",
    ),
    { source: "referral-ceiling" },
  );
}

/** Tests only: forget that the ceiling alert was sent. */
export function resetReferralCeilingAlertForTests(): void {
  delete ceilingAlert.__studyosReferralCeilingAlertAt;
}

type FriendStep =
  /** The friend's bonus is in the ledger (now, or by an earlier run): the inviter's half is next. */
  | { kind: "granted" }
  | { kind: "rejected"; reason: ReferralRejectReason }
  | { kind: "decided" }
  | { kind: "ceiling" }
  | { kind: "deleted_account" };

/** Try to reward the friend's pending, qualified referral (see the header). */
export async function rewardReferral(refereeId: string, deps: RewardDeps = DEFAULT_DEPS): Promise<RewardOutcome> {
  if (!referralsEnabled()) return { kind: "waiting", why: "paused" };
  const row = await prisma.referral.findUnique({ where: { refereeId } });
  if (!row || row.status !== "pending") return { kind: "none" };
  if (!row.qualifiedAt) return { kind: "waiting", why: "not_qualified" };
  const referrerId = row.referrerId;

  let users: ClerkFacts[];
  try {
    users = await deps.lookupUsers([refereeId, referrerId]);
  } catch {
    return { kind: "waiting", why: "clerk_unavailable" };
  }
  const friend = users.find((u) => u.id === refereeId);
  if (!friend || friend.banned) return { kind: "skipped", why: "deleted_account" };
  if (friend.locked) return { kind: "waiting", why: "account_locked" };
  if (!friend.emailVerified || !friend.email) return { kind: "waiting", why: "unverified_email" };
  const key = (deps.mailboxKey ?? referralMailboxKey)();
  if (!key) return { kind: "waiting", why: "no_key" };

  const found = users.find((u) => u.id === referrerId);
  const tombstone = await prisma.deletedAccount.findUnique({ where: { userId: referrerId }, select: { userId: true } });
  // The inviter, unless deleted (here or in Clerk) or banned.
  const inviter = found && !found.banned && !tombstone ? found : null;
  const inviterGone = inviter === null;
  if (inviter?.locked) return { kind: "waiting", why: "account_locked" };

  let verdict: ReferralRejectReason | null = null;
  if (friend.createdAt < row.createdAt.getTime() - REFERRAL_NEW_ACCOUNT_MS) verdict = "account_not_new";
  else if (inviterGone) verdict = "referrer_deleted";
  else if (inviter.email && emailIdentity(friend.email) === emailIdentity(inviter.email)) verdict = "same_email";

  const friendHash = mailboxHash(friend.email, key);
  const inviterHash = inviter?.email ? mailboxHash(inviter.email, key) : null;
  const now = deps.now();
  const dayAgo = new Date(now.getTime() - DAY_MS);

  // 1. The decision, and the friend's bonus, under the friend's lock.
  const first = await withUserCreditLock(refereeId, async (tx): Promise<FriendStep> => {
    await lockMailbox(tx, friendHash);
    const current = await tx.referral.findUnique({ where: { refereeId }, select: { status: true } });
    if (current?.status !== "pending") return { kind: "decided" };
    const done = await tx.creditLedger.findUnique({
      where: { idempotencyKey: refereeGrantKey(refereeId) },
      select: { id: true },
    });
    if (done) return { kind: "granted" };
    const reason = verdict ?? ((await mailboxGrants(tx, friendHash, "friend")) > 0 ? "mailbox_reused" : null);
    if (reason) {
      await tx.referral.updateMany({
        where: { refereeId, status: "pending" },
        data: { status: "rejected", rejectReason: reason },
      });
      return { kind: "rejected", reason };
    }
    if ((await friendGrantsSince(tx, dayAgo)) >= REFERRAL_MAX_FRIEND_GRANTS_PER_DAY) return { kind: "ceiling" };
    const granted = await grantCreditsTx(tx, refereeId, REFERRAL_CREDITS, REFERRAL_REASON_REFEREE, refereeGrantKey(refereeId));
    if (granted === "deleted_account") return { kind: "deleted_account" };
    if (granted === "granted") await recordMailboxGrant(tx, friendHash, "friend");
    return { kind: "granted" };
  });
  if (first.kind === "decided") return { kind: "skipped", why: "already_decided" };
  if (first.kind === "rejected") return { kind: "rejected", reason: first.reason };
  if (first.kind === "deleted_account") return { kind: "skipped", why: "deleted_account" };
  if (first.kind === "ceiling") {
    alertDailyCeiling(now);
    return { kind: "waiting", why: "daily_ceiling" };
  }

  // 2. The inviter's bonus, within the caps, and the final status, atomically.
  const outcome = await withUserCreditLock(referrerId, async (tx): Promise<ReferrerOutcome | null> => {
    if (inviterHash) await lockMailbox(tx, inviterHash);
    const current = await tx.referral.findUnique({ where: { refereeId }, select: { status: true } });
    if (current?.status !== "pending") return null;
    let result: ReferrerOutcome;
    if (inviterGone) {
      // Only reached when an earlier run granted the friend before the inviter went.
      result = "referrer_deleted";
    } else {
      const [total, today, mailboxTotal, mailboxToday] = await Promise.all([
        tx.creditLedger.count({ where: { userId: referrerId, reason: REFERRAL_REASON_REFERRER } }),
        tx.creditLedger.count({
          where: { userId: referrerId, reason: REFERRAL_REASON_REFERRER, createdAt: { gte: dayAgo } },
        }),
        inviterHash ? mailboxGrants(tx, inviterHash, "inviter") : 0,
        inviterHash ? mailboxGrants(tx, inviterHash, "inviter", dayAgo) : 0,
      ]);
      if (Math.max(total, mailboxTotal) >= REFERRAL_MAX_REWARDS) result = "capped_total";
      else if (Math.max(today, mailboxToday) >= REFERRAL_MAX_PER_DAY) result = "capped_daily";
      else {
        const granted = await grantCreditsTx(
          tx,
          referrerId,
          REFERRAL_CREDITS,
          REFERRAL_REASON_REFERRER,
          referrerGrantKey(refereeId),
        );
        if (granted === "granted" && inviterHash) await recordMailboxGrant(tx, inviterHash, "inviter");
        result = granted === "deleted_account" ? "referrer_deleted" : "granted";
      }
    }
    await tx.referral.updateMany({
      where: { refereeId, status: "pending" },
      data: { status: "rewarded", rewardedAt: now, referrerOutcome: result },
    });
    return result;
  });
  if (outcome === null) return { kind: "skipped", why: "already_decided" };
  return { kind: "rewarded", referrer: outcome };
}

/** How long a build waits for its reward before answering anyway. */
export const REWARD_WAIT_MS = 3_000;

export type AfterBuildOutcome = RewardOutcome | { kind: "timeout" } | { kind: "failed" };

const reportReward = (refereeId: string) => (error: unknown) => {
  reportError(error, { source: "referral-reward", userId: refereeId });
  return { kind: "failed" } as const;
};

/**
 * Called by the build route once a build was saved and charged (charged
 * more than nothing): marks the friend's pending referral qualified. True
 * when there is a pending referral for the reward to try (the route then
 * calls rewardQualifiedReferral); false for everyone else, after one cheap
 * read. Never throws: a failure is reported (the friend's next charged build
 * qualifies it again).
 */
export async function qualifyReferral(refereeId: string, now: () => Date = () => new Date()): Promise<boolean> {
  try {
    // The one query every build pays; only an invited friend's build goes on.
    const row = await prisma.referral.findUnique({ where: { refereeId }, select: { status: true, qualifiedAt: true } });
    if (!row || row.status !== "pending") return false;
    if (!row.qualifiedAt) {
      await prisma.referral.updateMany({
        where: { refereeId, status: "pending", qualifiedAt: null },
        data: { qualifiedAt: now() },
      });
    }
    return true;
  } catch (error) {
    reportReward(refereeId)(error);
    return false;
  }
}

/**
 * Try the reward of a qualified referral, waiting at most `timeoutMs`; a
 * reward still running then finishes (or is reported) in the background.
 * Never throws: a failure is reported and the referral stays pending.
 */
export async function rewardQualifiedReferral(
  refereeId: string,
  opts: { timeoutMs?: number; deps?: RewardDeps } = {},
): Promise<AfterBuildOutcome> {
  const work = rewardReferral(refereeId, opts.deps ?? DEFAULT_DEPS).catch(reportReward(refereeId));
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<{ kind: "timeout" }>((resolve) => {
    timer = setTimeout(() => resolve({ kind: "timeout" }), opts.timeoutMs ?? REWARD_WAIT_MS);
  });
  try {
    return await Promise.race([work, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/** Both of the above: qualify the friend's referral, then try its reward. */
export async function rewardReferralAfterBuild(
  refereeId: string,
  opts: { timeoutMs?: number; deps?: RewardDeps } = {},
): Promise<AfterBuildOutcome> {
  const deps = opts.deps ?? DEFAULT_DEPS;
  if (!(await qualifyReferral(refereeId, deps.now))) return { kind: "none" };
  return rewardQualifiedReferral(refereeId, { ...opts, deps });
}

/** Pending referrals the maintenance job tries per run. */
export const REWARD_RETRY_BATCH = 50;
/** How far back the maintenance job looks for qualified, still pending referrals. */
export const REWARD_RETRY_WINDOW_MS = 30 * DAY_MS;
/**
 * A referral the maintenance job tried less than this long ago is left for
 * a later run: a day, less a margin so the daily job (03:30) never skips the
 * rows its previous run tried.
 */
export const REWARD_RETRY_GAP_MS = 20 * HOUR_MS;
/** Users looked up in one Clerk call by the maintenance job. */
export const REWARD_RETRY_LOOKUP_CHUNK = 100;
/** Clerk calls the maintenance job makes per run, at most (each for up to REWARD_RETRY_LOOKUP_CHUNK users). */
export const REWARD_RETRY_CLERK_CALLS = 2;

export interface RewardRetryResult {
  tried: number;
  rewarded: number;
  rejected: number;
  waiting: number;
  failed: number;
  /** The program is paused (STUDYOS_REFERRALS=off): nothing was tried. */
  paused?: true;
}

/**
 * Maintenance: retry the qualified referrals still pending (attributed in the
 * last REWARD_RETRY_WINDOW_MS), the least recently tried first (never tried,
 * then oldest attempt, then oldest referral), skipping those tried in the last
 * REWARD_RETRY_GAP_MS, so referrals that keep waiting (an email never
 * verified) cannot starve the others. Every row is stamped `lastTriedAt`
 * before it is tried. Both sides of every row are looked up in batched Clerk
 * calls (at most REWARD_RETRY_CLERK_CALLS per run; rows they could not cover
 * are left for the next run, unstamped). One failure never stops the others.
 */
export async function retryPendingReferralRewards(
  opts: { limit?: number; now?: Date; deps?: RewardDeps; maxClerkCalls?: number } = {},
): Promise<RewardRetryResult> {
  const result: RewardRetryResult = { tried: 0, rewarded: 0, rejected: 0, waiting: 0, failed: 0 };
  if (!referralsEnabled()) return { ...result, paused: true };
  const now = opts.now ?? new Date();
  const deps = opts.deps ?? DEFAULT_DEPS;
  const candidates = await prisma.referral.findMany({
    where: {
      status: "pending",
      // An anonymised row (the friend deleted their account) has no one to reward.
      refereeId: { not: null },
      createdAt: { gte: new Date(now.getTime() - REWARD_RETRY_WINDOW_MS) },
      qualifiedAt: { not: null },
      OR: [{ lastTriedAt: null }, { lastTriedAt: { lt: new Date(now.getTime() - REWARD_RETRY_GAP_MS) } }],
    },
    orderBy: [{ lastTriedAt: { sort: "asc", nulls: "first" } }, { createdAt: "asc" }],
    take: opts.limit ?? REWARD_RETRY_BATCH,
    select: { refereeId: true, referrerId: true },
  });

  // The rows whose two sides fit in the run's Clerk calls, in order.
  const maxUsers = Math.max(0, opts.maxClerkCalls ?? REWARD_RETRY_CLERK_CALLS) * REWARD_RETRY_LOOKUP_CHUNK;
  const ids = new Set<string>();
  const rows: string[] = [];
  for (const { refereeId, referrerId } of candidates) {
    if (!refereeId) continue;
    const need = [refereeId, referrerId].filter((id, i, all) => !ids.has(id) && all.indexOf(id) === i);
    if (ids.size + need.length > maxUsers) break;
    for (const id of need) ids.add(id);
    rows.push(refereeId);
  }
  if (rows.length === 0) return result;

  // Both sides of every row, REWARD_RETRY_LOOKUP_CHUNK users per call.
  const facts = new Map<string, ClerkFacts>();
  const unreachable = new Set<string>();
  const all = [...ids];
  for (let i = 0; i < all.length; i += REWARD_RETRY_LOOKUP_CHUNK) {
    const part = all.slice(i, i + REWARD_RETRY_LOOKUP_CHUNK);
    try {
      for (const user of await deps.lookupUsers(part)) facts.set(user.id, user);
    } catch {
      for (const id of part) unreachable.add(id);
    }
  }

  await prisma.referral.updateMany({
    where: { refereeId: { in: rows }, status: "pending" },
    data: { lastTriedAt: now },
  });
  const cached: RewardDeps = {
    ...deps,
    lookupUsers: async (ids) => {
      if (ids.some((id) => unreachable.has(id))) throw new Error("Clerk unreachable");
      return ids.map((id) => facts.get(id)).filter((u): u is ClerkFacts => Boolean(u));
    },
  };
  result.tried = rows.length;
  for (const refereeId of rows) {
    try {
      const outcome = await rewardReferral(refereeId, cached);
      if (outcome.kind === "rewarded") result.rewarded++;
      else if (outcome.kind === "rejected") result.rejected++;
      else if (outcome.kind === "waiting") result.waiting++;
    } catch (error) {
      result.failed++;
      reportError(error, { source: "referral-reward", userId: refereeId });
    }
  }
  return result;
}
