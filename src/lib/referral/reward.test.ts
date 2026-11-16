// @vitest-environment node
/**
 * The reward against the real credits module (grants, idempotency keys,
 * per-user locks) on the in-memory Postgres stand-in, whose transactions,
 * unique keys and advisory locks behave like the real ones under concurrency
 * (src/test/billing-fakes.ts).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { createFakeDb } from "@/test/billing-fakes";

const h = vi.hoisted(() => ({
  db: null as unknown as ReturnType<typeof createFakeDb>,
  reportError: vi.fn(),
}));
vi.mock("@/lib/db", async () => {
  const { createFakeDb } = await import("@/test/billing-fakes");
  h.db = createFakeDb();
  return { prisma: h.db.db };
});
vi.mock("@clerk/nextjs/server", () => ({ clerkClient: vi.fn() }));
vi.mock("@/lib/ops/report-error", () => ({ reportError: h.reportError }));

import { getCreditBalance, grantCredits, TRIAL_CREDITS } from "@/lib/credits";
import {
  REFERRAL_CREDITS,
  REFERRAL_MAX_FRIEND_GRANTS_PER_DAY,
  REFERRAL_MAX_PER_DAY,
  REFERRAL_MAX_REWARDS,
} from "@/lib/price-list";
import { mailboxHash, referralMailboxKey } from "./mailbox";
import {
  type ClerkFacts,
  emailIdentity,
  qualifyReferral,
  resetReferralCeilingAlertForTests,
  retryPendingReferralRewards,
  REWARD_RETRY_GAP_MS,
  rewardReferral,
  rewardReferralAfterBuild,
  type RewardDeps,
} from "./reward";

const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;
const INVITER = "inviter";
const KEY = referralMailboxKey({ CLERK_SECRET_KEY: "sk_test_reward" })!;

/** Clerk as the tests see it: users by id; `down` makes every call fail. */
const clerk = { users: new Map<string, ClerkFacts>(), down: false, calls: 0 };
const deps: RewardDeps = {
  lookupUsers: async (ids) => {
    clerk.calls++;
    if (clerk.down) throw new Error("Clerk unreachable");
    return ids.map((id) => clerk.users.get(id)).filter((u): u is ClerkFacts => Boolean(u));
  },
  now: () => new Date(),
  mailboxKey: () => KEY,
};

function clerkUser(id: string, over: Partial<ClerkFacts> = {}) {
  clerk.users.set(id, { id, createdAt: Date.now() - 60_000, email: `${id}@uni.example`, emailVerified: true, ...over });
}

/** A friend invited by INVITER: account made (trial granted), attributed, and (by default) qualified. */
async function friend(id: string, opts: { qualified?: boolean; inviter?: string; email?: string } = {}) {
  clerkUser(id, opts.email ? { email: opts.email } : {});
  await getCreditBalance(id);
  await h.db.db.referral.create({
    data: {
      referrerId: opts.inviter ?? INVITER,
      refereeId: id,
      code: "K7MPQ2XR",
      qualifiedAt: opts.qualified === false ? null : new Date(),
    },
  });
}

const ledger = (userId: string, reason?: string) =>
  h.db.state.ledger.filter((l) => l.userId === userId && (!reason || l.reason === reason));
const inviteLedger = () => h.db.state.ledger.filter((l) => l.reason.startsWith("referral_"));
const row = (refereeId: string) => h.db.db.referral.findUnique({ where: { refereeId } });
const balance = (userId: string) => h.db.state.accounts.get(userId)?.balance;
type MailboxRow = { id: string; hash: string; role: string; createdAt: Date };
const register = (): Promise<MailboxRow[]> => h.db.db.referralMailbox.findMany({});

/** What a friend deleting their account does to their row (lib/account/erase-user-data.ts). */
async function eraseFriend(id: string) {
  await h.db.db.referral.updateMany({ where: { refereeId: id }, data: { refereeId: null } });
  await h.db.db.creditLedger.deleteMany({ where: { userId: id } });
  await h.db.db.creditAccount.deleteMany({ where: { userId: id } });
  clerk.users.delete(id);
}

beforeEach(async () => {
  h.db.reset();
  clerk.users.clear();
  clerk.down = false;
  clerk.calls = 0;
  h.reportError.mockReset();
  resetReferralCeilingAlertForTests();
  clerkUser(INVITER, { createdAt: Date.now() - 90 * DAY });
  await getCreditBalance(INVITER);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("a qualified referral", () => {
  it("rewards both sides once, through the grant primitive, with keys per friend", async () => {
    await friend("f1");
    expect(await rewardReferral("f1", deps)).toEqual({ kind: "rewarded", referrer: "granted" });
    expect(balance("f1")).toBe(TRIAL_CREDITS + REFERRAL_CREDITS);
    expect(balance(INVITER)).toBe(TRIAL_CREDITS + REFERRAL_CREDITS);
    expect(ledger("f1", "referral_referee")).toEqual([
      expect.objectContaining({ delta: REFERRAL_CREDITS, idempotencyKey: "referral:referee:f1" }),
    ]);
    expect(ledger(INVITER, "referral_referrer")).toEqual([
      expect.objectContaining({ delta: REFERRAL_CREDITS, idempotencyKey: "referral:referrer:f1" }),
    ]);
    expect(await row("f1")).toMatchObject({ status: "rewarded", referrerOutcome: "granted", rewardedAt: expect.any(Date) });
  });

  it("records each grant in the mailbox register: a keyed hash and a side, never an id or an address", async () => {
    await friend("f1", { email: "Ada.Lovelace+study@gmail.com" });
    await rewardReferral("f1", deps);
    const rows = await register();
    expect(rows.map((r) => r.role).sort()).toEqual(["friend", "inviter"]);
    expect(rows.find((r) => r.role === "friend")!.hash).toBe(mailboxHash("adalovelace@gmail.com", KEY));
    for (const r of rows) {
      expect(Object.keys(r).sort()).toEqual(["createdAt", "hash", "id", "role"]);
      expect(r.hash).toMatch(/^[A-Za-z0-9_-]{43}$/);
      for (const leak of ["ada", "lovelace", "f1", INVITER]) expect(r.hash.toLowerCase()).not.toContain(leak);
    }
  });

  it("grants each side exactly once under retries and parallel runs", async () => {
    await friend("f1");
    const outcomes = await Promise.all(Array.from({ length: 6 }, () => rewardReferral("f1", deps)));
    for (let i = 0; i < 3; i++) outcomes.push(await rewardReferral("f1", deps));
    expect(outcomes.filter((o) => o.kind === "rewarded")).toHaveLength(1);
    expect(ledger("f1", "referral_referee")).toHaveLength(1);
    expect(ledger(INVITER, "referral_referrer")).toHaveLength(1);
    expect(balance("f1")).toBe(TRIAL_CREDITS + REFERRAL_CREDITS);
    expect(balance(INVITER)).toBe(TRIAL_CREDITS + REFERRAL_CREDITS);
    expect(await register()).toHaveLength(2);
  });

  it("completes the inviter's half when a run stopped after the friend's grant", async () => {
    await friend("f1");
    // The friend's grant landed, then the run died before the inviter's part.
    await grantCredits("f1", REFERRAL_CREDITS, "referral_referee", "referral:referee:f1");
    expect(await rewardReferral("f1", deps)).toEqual({ kind: "rewarded", referrer: "granted" });
    expect(ledger("f1", "referral_referee")).toHaveLength(1);
    expect(ledger(INVITER, "referral_referrer")).toHaveLength(1);
  });
});

describe("waiting (stays pending, tried again later)", () => {
  it("until the friend's first charged build: an unqualified referral is not rewarded", async () => {
    await friend("f1", { qualified: false });
    expect(await rewardReferral("f1", deps)).toEqual({ kind: "waiting", why: "not_qualified" });
    expect(ledger("f1", "referral_referee")).toHaveLength(0);
    expect(clerk.calls).toBe(0);
  });

  it("while the friend's email is not verified; rewarded once it is", async () => {
    await friend("f1");
    clerkUser("f1", { emailVerified: false });
    expect(await rewardReferral("f1", deps)).toEqual({ kind: "waiting", why: "unverified_email" });
    expect(await row("f1")).toMatchObject({ status: "pending" });
    expect(ledger("f1", "referral_referee")).toHaveLength(0);
    clerkUser("f1");
    expect(await rewardReferral("f1", deps)).toMatchObject({ kind: "rewarded" });
  });

  it("while Clerk cannot be reached: never a rejection", async () => {
    await friend("f1");
    clerk.down = true;
    expect(await rewardReferral("f1", deps)).toEqual({ kind: "waiting", why: "clerk_unavailable" });
    expect(await row("f1")).toMatchObject({ status: "pending", rejectReason: null });
    expect(inviteLedger()).toHaveLength(0);
  });

  it("while either side is locked out of their account (Clerk lifts a lockout by itself)", async () => {
    await friend("f1");
    clerkUser("f1", { locked: true });
    expect(await rewardReferral("f1", deps)).toEqual({ kind: "waiting", why: "account_locked" });
    clerkUser("f1");
    clerkUser(INVITER, { createdAt: Date.now() - 90 * DAY, locked: true });
    expect(await rewardReferral("f1", deps)).toEqual({ kind: "waiting", why: "account_locked" });
    expect(await row("f1")).toMatchObject({ status: "pending", rejectReason: null });
    expect(inviteLedger()).toHaveLength(0);
    clerkUser(INVITER, { createdAt: Date.now() - 90 * DAY });
    expect(await rewardReferral("f1", deps)).toMatchObject({ kind: "rewarded", referrer: "granted" });
  });

  it("while the program is paused (STUDYOS_REFERRALS=off), without asking Clerk; rewarded once it is back", async () => {
    await friend("f1");
    vi.stubEnv("STUDYOS_REFERRALS", "off");
    expect(await rewardReferral("f1", deps)).toEqual({ kind: "waiting", why: "paused" });
    expect(await retryPendingReferralRewards({ deps })).toMatchObject({ tried: 0, paused: true });
    expect(clerk.calls).toBe(0);
    expect(await row("f1")).toMatchObject({ status: "pending" });
    vi.stubEnv("STUDYOS_REFERRALS", "on");
    expect(await rewardReferral("f1", deps)).toMatchObject({ kind: "rewarded" });
  });
});

describe("rejected at reward time (nobody gets anything)", () => {
  const nothingGranted = () => expect(inviteLedger()).toEqual([]);

  it("an inviter whose account is deleted, here or in Clerk, or banned", async () => {
    await friend("f1");
    await h.db.db.deletedAccount.create({ data: { userId: INVITER } });
    expect(await rewardReferral("f1", deps)).toEqual({ kind: "rejected", reason: "referrer_deleted" });
    await friend("f2", { inviter: "ghost" }); // never existed in Clerk
    expect(await rewardReferral("f2", deps)).toEqual({ kind: "rejected", reason: "referrer_deleted" });
    clerkUser("banned-inviter", { banned: true });
    await friend("f3", { inviter: "banned-inviter" });
    expect(await rewardReferral("f3", deps)).toEqual({ kind: "rejected", reason: "referrer_deleted" });
    expect(await row("f1")).toMatchObject({ status: "rejected", rejectReason: "referrer_deleted" });
    nothingGranted();
  });

  it("a friend whose mailbox is the inviter's (+tags, case and Gmail dots ignored)", async () => {
    clerkUser(INVITER, { email: "Ada.Lovelace@gmail.com" });
    await friend("f1");
    clerkUser("f1", { email: "adalovelace+study2@googlemail.com" });
    expect(await rewardReferral("f1", deps)).toEqual({ kind: "rejected", reason: "same_email" });
    nothingGranted();
  });

  it("a friend whose Clerk account is older than attribution allows", async () => {
    await friend("f1");
    clerkUser("f1", { createdAt: Date.now() - 10 * DAY });
    expect(await rewardReferral("f1", deps)).toEqual({ kind: "rejected", reason: "account_not_new" });
    nothingGranted();
  });

  it("a friend no longer in Clerk, or banned, is skipped like a deleted account (their data goes with it)", async () => {
    await friend("f1");
    clerk.users.delete("f1");
    expect(await rewardReferral("f1", deps)).toEqual({ kind: "skipped", why: "deleted_account" });
    await friend("f2");
    clerkUser("f2", { banned: true });
    expect(await rewardReferral("f2", deps)).toEqual({ kind: "skipped", why: "deleted_account" });
    expect(await row("f2")).toMatchObject({ status: "pending" });
    nothingGranted();
  });

  it("rewarded and rejected referrals are never looked at again", async () => {
    await friend("f1");
    await h.db.db.referral.updateMany({ where: { refereeId: "f1" }, data: { status: "rejected", rejectReason: "self_referral" } });
    expect(await rewardReferral("f1", deps)).toEqual({ kind: "none" });
    expect(await rewardReferral("nobody", deps)).toEqual({ kind: "none" });
    expect(clerk.calls).toBe(0);
  });
});

describe("one decision per referral (the reject-vs-reward race)", () => {
  it("a run that would reject, after an earlier run granted the friend, completes the reward instead", async () => {
    await friend("f1");
    // An earlier run granted the friend (and died); the inviter is gone since.
    await grantCredits("f1", REFERRAL_CREDITS, "referral_referee", "referral:referee:f1");
    await h.db.db.deletedAccount.create({ data: { userId: INVITER } });
    expect(await rewardReferral("f1", deps)).toEqual({ kind: "rewarded", referrer: "referrer_deleted" });
    expect(await row("f1")).toMatchObject({ status: "rewarded", referrerOutcome: "referrer_deleted", rejectReason: null });
    expect(ledger("f1", "referral_referee")).toHaveLength(1);
    expect(ledger(INVITER, "referral_referrer")).toHaveLength(0);
  });

  it("parallel runs that see Clerk differently settle on one outcome, whichever decides first", async () => {
    // One run sees the inviter, the other a Clerk where the inviter is gone.
    const blind: RewardDeps = {
      ...deps,
      lookupUsers: async (ids) => (await deps.lookupUsers(ids)).filter((u) => u.id !== INVITER),
    };
    for (const order of [[deps, blind], [blind, deps]]) {
      h.db.reset();
      await getCreditBalance(INVITER);
      await friend("f1");
      await Promise.all(order.map((d) => rewardReferral("f1", d)));
      const decided = await row("f1");
      const friendGrants = ledger("f1", "referral_referee").length;
      if (decided!.status === "rejected") {
        expect(decided).toMatchObject({ rejectReason: "referrer_deleted" });
        expect(inviteLedger()).toHaveLength(0);
      } else {
        expect(decided!.status).toBe("rewarded");
        expect(friendGrants).toBe(1);
      }
    }
  });
});

describe("one mailbox, many accounts (the mailbox register)", () => {
  it("a mailbox earns the friend bonus once, ever: a new account on it, even after the first was deleted, is rejected", async () => {
    await friend("f1", { email: "ada@gmail.com" });
    expect(await rewardReferral("f1", deps)).toMatchObject({ kind: "rewarded", referrer: "granted" });
    // The friend deletes their account and signs up again, invited again.
    await eraseFriend("f1");
    await friend("f1-again", { email: "A.D.A+again@googlemail.com" });
    expect(await rewardReferral("f1-again", deps)).toEqual({ kind: "rejected", reason: "mailbox_reused" });
    expect(await row("f1-again")).toMatchObject({ status: "rejected", rejectReason: "mailbox_reused" });
    expect(ledger("f1-again", "referral_referee")).toHaveLength(0);
    // The inviter got one bonus, not two.
    expect(ledger(INVITER, "referral_referrer")).toHaveLength(1);
  });

  it("parallel accounts on one mailbox: exactly one earns", async () => {
    const emails = ["bob@gmail.com", "b.o.b@gmail.com", "BOB+1@gmail.com", "bob+2@googlemail.com"];
    for (const [i, email] of emails.entries()) await friend(`m${i}`, { email });
    const outcomes = await Promise.all(emails.map((_, i) => rewardReferral(`m${i}`, deps)));
    expect(outcomes.filter((o) => o.kind === "rewarded")).toHaveLength(1);
    expect(outcomes.filter((o) => o.kind === "rejected" && o.reason === "mailbox_reused")).toHaveLength(3);
    expect(h.db.state.ledger.filter((l) => l.reason === "referral_referee")).toHaveLength(1);
    expect((await register()).filter((r) => r.role === "friend")).toHaveLength(1);
  });

  it(`the inviter's daily cap counts their mailbox across all their accounts, under concurrency`, async () => {
    clerkUser(INVITER, { createdAt: Date.now() - 90 * DAY, email: "boss@gmail.com" });
    clerkUser("inviter-2", { createdAt: Date.now() - 90 * DAY, email: "b.o.s.s+alt@gmail.com" });
    await getCreditBalance("inviter-2");
    const ids: string[] = [];
    for (let i = 0; i < REFERRAL_MAX_PER_DAY + 2; i++) {
      const id = `x${i}`;
      await friend(id, { inviter: i % 2 === 0 ? INVITER : "inviter-2" });
      ids.push(id);
    }
    const outcomes = await Promise.all(ids.map((id) => rewardReferral(id, deps)));
    const granted = outcomes.filter((o) => o.kind === "rewarded" && o.referrer === "granted");
    expect(granted).toHaveLength(REFERRAL_MAX_PER_DAY);
    expect(outcomes.filter((o) => o.kind === "rewarded" && o.referrer === "capped_daily")).toHaveLength(2);
    const inviterGrants = h.db.state.ledger.filter((l) => l.reason === "referral_referrer");
    expect(inviterGrants).toHaveLength(REFERRAL_MAX_PER_DAY);
    // Both accounts earned, yet together no more than one mailbox may.
    expect(new Set(inviterGrants.map((l) => l.userId))).toEqual(new Set([INVITER, "inviter-2"]));
    // Every friend still got theirs.
    for (const id of ids) expect(ledger(id, "referral_referee"), id).toHaveLength(1);
  });

  it("the inviter's total cap counts their mailbox too: a fresh account on it is already capped", async () => {
    const hash = mailboxHash("boss@gmail.com", KEY);
    for (let i = 0; i < REFERRAL_MAX_REWARDS - 1; i++) {
      await h.db.db.referralMailbox.create({
        data: { hash, role: "inviter", createdAt: new Date(Date.now() - (2 + i) * DAY) },
      });
    }
    clerkUser("fresh-inviter", { createdAt: Date.now() - DAY, email: "Boss@gmail.com" });
    await getCreditBalance("fresh-inviter");
    await friend("y0", { inviter: "fresh-inviter" });
    await friend("y1", { inviter: "fresh-inviter" });
    expect(await rewardReferral("y0", deps)).toEqual({ kind: "rewarded", referrer: "granted" });
    expect(await rewardReferral("y1", deps)).toEqual({ kind: "rewarded", referrer: "capped_total" });
    expect(ledger("fresh-inviter", "referral_referrer")).toHaveLength(1);
  });

  it("past the daily ceiling across everyone, friend bonuses wait and the operator is told once", async () => {
    const recent = new Date(Date.now() - HOUR);
    for (let i = 0; i < REFERRAL_MAX_FRIEND_GRANTS_PER_DAY; i++) {
      await h.db.db.referralMailbox.create({ data: { hash: `h${i}`, role: "friend", createdAt: recent } });
    }
    await friend("c0");
    await friend("c1");
    expect(await rewardReferral("c0", deps)).toEqual({ kind: "waiting", why: "daily_ceiling" });
    expect(await rewardReferral("c1", deps)).toEqual({ kind: "waiting", why: "daily_ceiling" });
    expect(await row("c0")).toMatchObject({ status: "pending" });
    expect(inviteLedger()).toHaveLength(0);
    expect(h.reportError).toHaveBeenCalledTimes(1);
    expect(h.reportError.mock.calls[0][1]).toEqual({ source: "referral-ceiling" });
    // A day on, the window has room again: the waiting rewards go through.
    await h.db.db.referralMailbox.updateMany({ where: { role: "friend" }, data: { createdAt: new Date(Date.now() - 25 * HOUR) } });
    expect(await rewardReferral("c0", deps)).toMatchObject({ kind: "rewarded" });
  });
});

describe("the inviter's caps", () => {
  const friends = async (n: number, prefix: string) => {
    const ids = Array.from({ length: n }, (_, i) => `${prefix}${i}`);
    for (const id of ids) await friend(id);
    return ids;
  };

  it(`at most ${REFERRAL_MAX_PER_DAY} in 24 hours, under concurrency; every friend still gets theirs`, async () => {
    const ids = await friends(REFERRAL_MAX_PER_DAY + 3, "d");
    const outcomes = await Promise.all(ids.map((id) => rewardReferral(id, deps)));
    const granted = outcomes.filter((o) => o.kind === "rewarded" && o.referrer === "granted");
    const capped = outcomes.filter((o) => o.kind === "rewarded" && o.referrer === "capped_daily");
    expect(granted).toHaveLength(REFERRAL_MAX_PER_DAY);
    expect(capped).toHaveLength(3);
    expect(ledger(INVITER, "referral_referrer")).toHaveLength(REFERRAL_MAX_PER_DAY);
    for (const id of ids) {
      expect(ledger(id, "referral_referee"), id).toHaveLength(1);
      expect(await row(id)).toMatchObject({ status: "rewarded" });
    }
    const withheld = await h.db.db.referral.findMany({ where: { referrerOutcome: "capped_daily" } });
    expect(withheld).toHaveLength(3);
  });

  it(`at most ${REFERRAL_MAX_REWARDS} in total, under concurrency, counted from the inviter's own ledger`, async () => {
    // Earlier rewards, spread over past days (outside the daily window).
    for (let i = 0; i < REFERRAL_MAX_REWARDS - 2; i++) {
      await h.db.db.creditLedger.create({
        data: {
          userId: INVITER,
          reason: "referral_referrer",
          delta: REFERRAL_CREDITS,
          idempotencyKey: `referral:referrer:old${i}`,
          createdAt: new Date(Date.now() - (2 + i) * DAY),
        },
      });
    }
    const ids = await friends(4, "t");
    const outcomes = await Promise.all(ids.map((id) => rewardReferral(id, deps)));
    expect(outcomes.filter((o) => o.kind === "rewarded" && o.referrer === "granted")).toHaveLength(2);
    expect(outcomes.filter((o) => o.kind === "rewarded" && o.referrer === "capped_total")).toHaveLength(2);
    expect(ledger(INVITER, "referral_referrer")).toHaveLength(REFERRAL_MAX_REWARDS);
    for (const id of ids) expect(ledger(id, "referral_referee"), id).toHaveLength(1);

    // Friends deleting their accounts (their rows anonymised) free no slot.
    for (const id of ids) await eraseFriend(id);
    await friend("late");
    expect(await rewardReferral("late", deps)).toEqual({ kind: "rewarded", referrer: "capped_total" });
    expect(ledger(INVITER, "referral_referrer")).toHaveLength(REFERRAL_MAX_REWARDS);
    expect(ledger("late", "referral_referee")).toHaveLength(1);
  });

  it("the daily cap frees up as earlier rewards pass 24 hours", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-15T09:00:00Z"));
    const first = await friends(REFERRAL_MAX_PER_DAY, "a");
    for (const id of first) await rewardReferral(id, deps);
    await friend("b0");
    expect(await rewardReferral("b0", deps)).toMatchObject({ referrer: "capped_daily" });
    vi.setSystemTime(new Date("2026-11-16T09:01:00Z"));
    await friend("c0");
    clerkUser("c0");
    expect(await rewardReferral("c0", deps)).toMatchObject({ referrer: "granted" });
  });
});

describe("after a build (the build route's hook)", () => {
  it("marks the friend's referral qualified and rewards it", async () => {
    await friend("f1", { qualified: false });
    expect(await rewardReferralAfterBuild("f1", { deps })).toEqual({ kind: "rewarded", referrer: "granted" });
    expect(await row("f1")).toMatchObject({ status: "rewarded", qualifiedAt: expect.any(Date) });
  });

  it("qualifying is one cheap read for everyone else, and says whether a reward is to be tried", async () => {
    expect(await qualifyReferral("not-invited")).toBe(false);
    await friend("f1", { qualified: false });
    expect(await qualifyReferral("f1")).toBe(true);
    expect(await row("f1")).toMatchObject({ status: "pending", qualifiedAt: expect.any(Date) });
    expect(await rewardReferralAfterBuild("not-invited", { deps })).toEqual({ kind: "none" });
    expect(clerk.calls).toBe(0);
  });

  it("qualifies even while the program is paused, so the reward follows once it is back", async () => {
    await friend("f1", { qualified: false });
    vi.stubEnv("STUDYOS_REFERRALS", "off");
    expect(await rewardReferralAfterBuild("f1", { deps })).toEqual({ kind: "waiting", why: "paused" });
    expect(await row("f1")).toMatchObject({ status: "pending", qualifiedAt: expect.any(Date) });
  });

  it("never waits long: a slow reward finishes in the background", async () => {
    await friend("f1", { qualified: false });
    let release!: () => void;
    const slow: RewardDeps = {
      ...deps,
      lookupUsers: (ids) => new Promise((resolve) => (release = () => resolve(deps.lookupUsers(ids)))),
    };
    expect(await rewardReferralAfterBuild("f1", { deps: slow, timeoutMs: 20 })).toEqual({ kind: "timeout" });
    // Qualified already, so a retry (or this run, finishing) rewards it.
    expect(await row("f1")).toMatchObject({ status: "pending", qualifiedAt: expect.any(Date) });
    release();
    await vi.waitFor(async () => expect(await row("f1")).toMatchObject({ status: "rewarded" }));
  });

  it("never throws: a failure is reported and the referral stays pending", async () => {
    await friend("f1");
    const broken: RewardDeps = { ...deps, now: () => { throw new Error("boom"); } };
    expect(await rewardReferralAfterBuild("f1", { deps: broken })).toEqual({ kind: "failed" });
    expect(h.reportError).toHaveBeenCalledTimes(1);
    expect(await row("f1")).toMatchObject({ status: "pending" });
    expect(ledger(INVITER, "referral_referrer")).toHaveLength(0);
  });
});

describe("the maintenance retry", () => {
  it("rewards qualified referrals still pending, and leaves the others", async () => {
    await friend("ready");
    await friend("unverified");
    clerkUser("unverified", { emailVerified: false });
    await friend("not-built", { qualified: false });
    const now = new Date();
    expect(await retryPendingReferralRewards({ deps, now })).toEqual({ tried: 2, rewarded: 1, rejected: 0, waiting: 1, failed: 0 });
    expect(await row("ready")).toMatchObject({ status: "rewarded" });
    expect(await row("unverified")).toMatchObject({ status: "pending", lastTriedAt: now });
    expect(await row("not-built")).toMatchObject({ status: "pending", lastTriedAt: null });
    // Tried a moment ago: left alone until the next day's run.
    expect(await retryPendingReferralRewards({ deps, now: new Date(now.getTime() + HOUR) })).toMatchObject({ tried: 0 });
    expect(REWARD_RETRY_GAP_MS).toBeLessThan(DAY);
    const nextDay = new Date(now.getTime() + DAY);
    expect(await retryPendingReferralRewards({ deps, now: nextDay })).toMatchObject({ tried: 1, waiting: 1 });
  });

  it("tries the least recently tried first, so referrals that keep waiting never starve the others", async () => {
    await friend("stuck-a");
    await friend("stuck-b");
    clerkUser("stuck-a", { emailVerified: false });
    clerkUser("stuck-b", { emailVerified: false });
    await friend("ready");
    // Made last: the oldest-first order of before would never reach it.
    await h.db.db.referral.updateMany({ where: { refereeId: "ready" }, data: { createdAt: new Date(Date.now() + 1000) } });
    const t0 = new Date(Date.now() + 2000);
    expect(await retryPendingReferralRewards({ deps, now: t0, limit: 2 })).toMatchObject({ tried: 2, waiting: 2 });
    expect(await row("ready")).toMatchObject({ status: "pending", lastTriedAt: null });
    const t1 = new Date(t0.getTime() + DAY);
    expect(await retryPendingReferralRewards({ deps, now: t1, limit: 2 })).toMatchObject({ tried: 2, rewarded: 1 });
    expect(await row("ready")).toMatchObject({ status: "rewarded" });
  });

  it("looks both sides up in batched Clerk calls, at most the cap per run (the rest wait, untouched)", async () => {
    for (let i = 0; i < 5; i++) {
      await friend(`b${i}`);
      clerkUser(`b${i}`, { emailVerified: false });
    }
    expect(await retryPendingReferralRewards({ deps })).toMatchObject({ tried: 5, waiting: 5 });
    expect(clerk.calls).toBe(1);

    h.db.reset();
    clerk.calls = 0;
    await getCreditBalance(INVITER);
    for (let i = 0; i < 120; i++) {
      await h.db.db.referral.create({ data: { referrerId: INVITER, refereeId: `w${i}`, code: "K7MPQ2XR", qualifiedAt: new Date() } });
    }
    // One call of 100 users: the inviter and 99 friends; the other 21 wait.
    expect(await retryPendingReferralRewards({ deps, limit: 200, maxClerkCalls: 1 })).toMatchObject({ tried: 99 });
    expect(clerk.calls).toBe(1);
    expect(await h.db.db.referral.count({ where: { lastTriedAt: null } })).toBe(21);
    expect(await retryPendingReferralRewards({ deps, maxClerkCalls: 0 })).toMatchObject({ tried: 0 });
  });

  it("Clerk unreachable: every row waits, none is rejected", async () => {
    await friend("f1");
    await friend("f2");
    clerk.down = true;
    expect(await retryPendingReferralRewards({ deps })).toEqual({ tried: 2, rewarded: 0, rejected: 0, waiting: 2, failed: 0 });
    expect(inviteLedger()).toHaveLength(0);
  });

  it("skips anonymised rows (the friend deleted their account) and looks back 30 days only", async () => {
    await friend("gone");
    await eraseFriend("gone");
    await friend("old");
    await h.db.db.referral.updateMany({ where: { refereeId: "old" }, data: { createdAt: new Date(Date.now() - 31 * DAY) } });
    expect(await retryPendingReferralRewards({ deps })).toMatchObject({ tried: 0 });
    expect(clerk.calls).toBe(0);
  });
});

describe("emailIdentity", () => {
  it("treats +tags, case and Gmail dots as the same mailbox, and nothing else", () => {
    expect(emailIdentity(" Ada.Lovelace+x@Gmail.com ")).toBe("adalovelace@gmail.com");
    expect(emailIdentity("a.b@googlemail.com")).toBe("ab@gmail.com");
    expect(emailIdentity("a.b+c@uni.edu")).toBe("a.b@uni.edu");
    expect(emailIdentity("a.b@uni.edu")).not.toBe(emailIdentity("ab@uni.edu"));
  });

  it("the register's hash follows it, and depends on the server key", () => {
    expect(mailboxHash("Ada.Lovelace+x@googlemail.com", KEY)).toBe(mailboxHash("adalovelace@gmail.com", KEY));
    expect(mailboxHash("ab@uni.edu", KEY)).not.toBe(mailboxHash("a.b@uni.edu", KEY));
    const other = referralMailboxKey({ CLERK_SECRET_KEY: "sk_test_other" })!;
    expect(mailboxHash("ada@gmail.com", other)).not.toBe(mailboxHash("ada@gmail.com", KEY));
    expect(referralMailboxKey({})).toBeNull();
  });
});
