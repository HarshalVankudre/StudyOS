/**
 * StudyOS credit system (server-only): balances, grants, debits and the
 * hold-and-settle mechanism every AI action is paid through.
 *
 * What an action costs is set in lib/price-list.ts: each AI action has a
 * fixed, published credit price, reserved before the work starts
 * (reserveCredits) and settled when it ends (settleCreditHold, or
 * releaseCreditHold when the outcome is free). Model spend is still measured
 * here (usageToCredits, at the peg of lib/credits-info.ts, 1000 credits ===
 * $3.00 of token spend), because an action whose real cost on the configured
 * model exceeds its list price is charged that real cost instead.
 *
 * Grants: a new account receives the one-time trial (TRIAL_CREDITS) and
 * nothing more; Pro adds PRO_MONTHLY_CREDITS for each paid month; packs add
 * CREDIT_PACK_SIZE. There is no free monthly top-up.
 */
import { prisma } from "@/lib/db";
import type { Prisma } from "@/generated/prisma";
import type { TokenUsage } from "@/lib/ai/usage-meter";
import { callCostUsd, MODEL_PRICES } from "@/lib/ai/model-pricing";
import { usdToCredits } from "@/lib/credits-info";
import { PRO_MONTHLY_CREDITS, TRIAL_CREDITS } from "@/lib/price-list";

// The peg and the conversions live in the client-safe credits-info; the
// grants and the action prices in the client-safe price list.
export { creditsToUsd, USD_PER_1000_CREDITS, usdToCredits } from "@/lib/credits-info";
export {
  CREDIT_PACK_PRICE_USD,
  CREDIT_PACK_SIZE,
  PRO_MONTHLY_CREDITS,
  RENDER_CREDITS,
  TRIAL_CREDITS,
} from "@/lib/price-list";

// GLM 5.2 list price on OpenRouter, USD per 1,000,000 tokens (the legacy
// single rate, still used for usage that does not say which model ran).
export const GLM_INPUT_USD_PER_MTOK = MODEL_PRICES["z-ai/glm-5.2"].inputPerMTok;
export const GLM_OUTPUT_USD_PER_MTOK = MODEL_PRICES["z-ai/glm-5.2"].outputPerMTok;

/**
 * Dollar cost of a request's tokens. The usage meter prices every call with
 * its own model's rates (`costUsd`); usage without that is priced here at
 * `model`'s rates (the legacy GLM 5.2 rate when no model is given).
 */
export function usageToUsd(usage: TokenUsage, model?: string): number {
  if (typeof usage.costUsd === "number") return usage.costUsd;
  const cacheRead = usage.cacheReadTokens ?? 0;
  const cacheWrite = usage.cacheWriteTokens ?? 0;
  return callCostUsd(model, {
    input: Math.max(0, usage.promptTokens - cacheRead - cacheWrite),
    output: usage.completionTokens,
    cacheRead,
    cacheWrite,
  });
}

/** Credits a request costs. 0 when nothing ran (e.g. the local mock); else ≥ 1. */
export function usageToCredits(usage: TokenUsage, model?: string): number {
  if (usage.promptTokens <= 0 && usage.completionTokens <= 0) return 0;
  return Math.max(1, usdToCredits(usageToUsd(usage, model)));
}

// ---- Accounts, the deletion tombstone and the per-user lock ----------------

/** The Prisma client, or an interactive transaction on it. */
export type CreditsDb = Prisma.TransactionClient;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Serialize one user's money-moving writes: account creation, grants, pack
 * reversals and the deletion tombstone all take this transaction-scoped
 * Postgres advisory lock first. A grant therefore lands entirely before the
 * tombstone or sees it and is refused; it can never slip in between.
 * Lock order is always this lock, then the CreditAccount row.
 */
async function lockUser(tx: CreditsDb, userId: string): Promise<void> {
  const key = `studyos:user:${userId}`;
  await tx.$queryRaw`SELECT 1 AS "locked" FROM pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
}

/** Run `fn` in a transaction holding the user's credit lock. */
export async function withUserCreditLock<T>(
  userId: string,
  fn: (tx: CreditsDb) => Promise<T>,
): Promise<T> {
  return prisma.$transaction(
    async (tx) => {
      await lockUser(tx, userId);
      return fn(tx);
    },
    { maxWait: 10_000, timeout: 20_000 },
  );
}

async function isTombstoned(tx: CreditsDb, userId: string): Promise<boolean> {
  const row = await tx.deletedAccount.findUnique({
    where: { userId },
    select: { userId: true },
  });
  return row !== null;
}

/**
 * With the user lock held: make sure the account exists, seeding the one-time
 * trial grant (TRIAL_CREDITS) once. False (and nothing written) for a deleted
 * account. The ledger reason and key stay "free_signup", so rows written
 * before the trial was named keep meaning the same single grant.
 */
async function ensureAccountTx(tx: CreditsDb, userId: string): Promise<boolean> {
  const existing = await tx.creditAccount.findUnique({
    where: { userId },
    select: { userId: true },
  });
  if (existing) return true;
  if (await isTombstoned(tx, userId)) return false;
  await tx.creditAccount.create({ data: { userId, balance: TRIAL_CREDITS } });
  await tx.creditLedger.create({
    data: {
      userId,
      delta: TRIAL_CREDITS,
      reason: "free_signup",
      idempotencyKey: `free_signup:${userId}`,
    },
  });
  return true;
}

/**
 * The account, created on first sight with the trial grant. Null for
 * an account that was deleted: an AI request still in flight while the
 * account is erased never recreates it (or its signup credits).
 */
async function ensureAccount(userId: string): Promise<{ balance: number } | null> {
  const existing = await prisma.creditAccount.findUnique({ where: { userId } });
  if (existing) return existing;
  const created = await withUserCreditLock(userId, (tx) => ensureAccountTx(tx, userId));
  if (!created) return null;
  return prisma.creditAccount.findUnique({ where: { userId } });
}

// ---- Pro status and the Pro allowance --------------------------------------

/**
 * How long after its paid period ends a subscription row still counts as Pro
 * without a renewal being recorded: covers Stripe's renewal invoice and a
 * few days of webhook retries. The maintenance job re-reads lapsed rows.
 */
export const PRO_GRACE_MS = 7 * DAY_MS;

type ProRow = {
  status: string;
  currentPeriodEnd: Date | null;
  disputeId?: string | null;
};

/**
 * Does this subscription row grant Pro right now? Active on Stripe, no open
 * or lost dispute on the payment of its current period, and its paid period
 * (plus PRO_GRACE_MS) not over. Rows without a known period end (written by
 * the code before stripeSyncedAt existed) follow their status alone until
 * the maintenance job has re-read them from Stripe (lib/billing.ts
 * reconcileUnsyncedSubscriptions, and the re-read of active rows with no
 * period end), which sets the period end.
 */
export function subscriptionGrantsPro(row: ProRow | null, now = new Date()): boolean {
  if (row?.status !== "active") return false;
  if (row.disputeId) return false;
  if (row.currentPeriodEnd && row.currentPeriodEnd.getTime() + PRO_GRACE_MS < now.getTime()) {
    return false;
  }
  return true;
}

/** The Subscription fields the allowance reads. */
export type AllowanceRow = ProRow & {
  stripeSubscriptionId: string | null;
  allowanceSubscriptionId: string | null;
  allowancePeriodStart: Date | null;
  allowancePeriodEnd: Date | null;
  allowanceYearly: boolean;
  allowanceStopAt: Date | null;
  disputedAt: Date | null;
};

export const ALLOWANCE_ROW_SELECT = {
  status: true,
  currentPeriodEnd: true,
  disputeId: true,
  stripeSubscriptionId: true,
  allowanceSubscriptionId: true,
  allowancePeriodStart: true,
  allowancePeriodEnd: true,
  allowanceYearly: true,
  allowanceStopAt: true,
  disputedAt: true,
} as const;

/**
 * `date` plus `months` calendar months in UTC, clamping the day to the target
 * month's length (Jan 31 + 1 month = Feb 28/29), always measured from the
 * original date so the anniversary day never drifts (Mar 31 stays the 31st).
 */
export function addMonthsUtc(date: Date, months: number): Date {
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth() + months;
  const targetYear = y + Math.floor(m / 12);
  const targetMonth = ((m % 12) + 12) % 12;
  const daysInTarget = new Date(
    Date.UTC(targetYear, targetMonth + 1, 0),
  ).getUTCDate();
  return new Date(
    Date.UTC(
      targetYear,
      targetMonth,
      Math.min(date.getUTCDate(), daysInTarget),
      date.getUTCHours(),
      date.getUTCMinutes(),
      date.getUTCSeconds(),
      date.getUTCMilliseconds(),
    ),
  );
}

/** Further monthly allowances one paid year accrues (its invoice pays the first). */
export const MAX_ACCRUED_MONTHS = 11;

/**
 * A paid period long enough to accrue monthly allowances: a yearly price.
 * Measured in calendar months, so a day or two either way at the boundary
 * (Feb 29 anchors, month-end clamping) never changes the answer.
 */
export function isYearlyPeriod(start: Date, end: Date): boolean {
  return end.getTime() >= addMonthsUtc(start, 11).getTime();
}

/**
 * Which further monthly allowances (1..11) of a yearly paid period are due by
 * `now`. Allowance 0 is granted by the paid invoice itself; allowance i falls
 * on the i-th monthly anniversary of the period start. Never more than
 * MAX_ACCRUED_MONTHS, never an anniversary within a day of the period end
 * (that month belongs to the next invoice), and none on or after `stopAt`
 * (the subscription ended, or its payment was refunded or disputed).
 */
export function dueAllowanceMonths(
  periodStart: Date,
  periodEnd: Date,
  now: Date,
  stopAt?: Date | null,
): number[] {
  const due: number[] = [];
  for (let i = 1; i <= MAX_ACCRUED_MONTHS; i++) {
    const anniversary = addMonthsUtc(periodStart, i);
    if (anniversary.getTime() > periodEnd.getTime() - DAY_MS) break;
    if (stopAt && anniversary.getTime() >= stopAt.getTime()) break;
    if (anniversary.getTime() > now.getTime()) break;
    due.push(i);
  }
  return due;
}

/** The calendar month (UTC) containing `date`, as YYYY-MM. */
export function monthKey(date: Date): string {
  return date.toISOString().slice(0, 7);
}

/** Prefix shared by every Pro grant key of one user and calendar month. */
export function proMonthPrefix(userId: string, month: Date): string {
  return `pro_month:${userId}:${monthKey(month)}`;
}

/**
 * Ledger key of the Pro allowance one subscription gives for one calendar
 * month (UTC) of coverage. Every Pro grant (a paid invoice or an annual
 * anniversary) uses it, so a month is granted once per subscription however
 * many invoices of that subscription touch it (plan switches, proration
 * invoices, retries), while a new subscription paid in the same month (after
 * a cancellation) is a new paid month. (Keys without the subscription, from
 * before, are `proMonthPrefix` alone; lib/billing.ts treats them as covering.)
 */
export function proMonthKey(userId: string, month: Date, subscriptionId: string): string {
  return `${proMonthPrefix(userId, month)}:${subscriptionId}`;
}

/**
 * Grant one subscription's Pro allowance (PRO_MONTHLY_CREDITS) for the
 * calendar month containing `month`, once: on every paid monthly invoice,
 * and for annual plans on the paid invoice plus each monthly anniversary of
 * the paid year (see accrueProAllowance). Unused credits roll over (they add
 * to the balance; nothing resets it).
 */
export async function grantProMonth(
  userId: string,
  month: Date,
  subscriptionId: string,
): Promise<boolean> {
  const outcome = await grantCredits(
    userId,
    PRO_MONTHLY_CREDITS,
    "pro_monthly",
    proMonthKey(userId, month, subscriptionId),
  );
  return outcome === "granted";
}

const earliest = (...dates: (Date | null | undefined)[]): Date | null =>
  dates.reduce<Date | null>(
    (min, d) => (d && (!min || d.getTime() < min.getTime()) ? d : min),
    null,
  );

/**
 * Grant the monthly Pro allowances a yearly subscriber has reached by `now`
 * inside the allowance period, in order. Only for the subscription the
 * period belongs to, which must still be the one the row tracks. Does not
 * depend on the live status: months before the subscription's end (or a
 * refund or dispute) were paid for and are owed even after it ends. Also
 * called just before the period is replaced, so no paid month is dropped.
 * Returns true when it granted.
 */
export async function accrueProAllowance(
  userId: string,
  sub: AllowanceRow | null,
  now = new Date(),
): Promise<boolean> {
  if (!sub?.allowanceYearly) return false;
  const subscriptionId = sub.allowanceSubscriptionId;
  if (!subscriptionId || subscriptionId !== sub.stripeSubscriptionId) return false;
  const { allowancePeriodStart: start, allowancePeriodEnd: end } = sub;
  if (!start || !end) return false;
  const due = dueAllowanceMonths(start, end, now, earliest(sub.allowanceStopAt, sub.disputedAt));
  if (due.length === 0) return false;
  // Hot path: months are granted in order, so the newest due month existing
  // means every earlier one does too.
  const newest = await prisma.creditLedger.findUnique({
    where: { idempotencyKey: proMonthKey(userId, addMonthsUtc(start, due[due.length - 1]), subscriptionId) },
    select: { id: true },
  });
  if (newest) return false;
  let granted = false;
  for (const i of due) {
    if (await grantProMonth(userId, addMonthsUtc(start, i), subscriptionId)) granted = true;
  }
  return granted;
}

/** Current balance (creates + seeds the account on first call; 0 once deleted). */
export async function getCreditBalance(userId: string): Promise<number> {
  let account = await ensureAccount(userId);
  if (!account) return 0;
  // Credits held by a request that died are given back here at the latest.
  if ((await releaseExpiredHolds({ userId })) > 0) {
    account = (await prisma.creditAccount.findUnique({ where: { userId } })) ?? account;
  }
  const sub = await prisma.subscription.findUnique({
    where: { userId },
    select: ALLOWANCE_ROW_SELECT,
  });
  // Yearly Pro accrues its monthly allowances on a read. Nothing else is
  // ever granted here: Free is the one-time trial, with no monthly top-up.
  if (!(await accrueProAllowance(userId, sub))) return account.balance;
  const fresh = await prisma.creditAccount.findUnique({ where: { userId } });
  return fresh?.balance ?? account.balance;
}

/** True when the user has at least `min` credits (default 1). */
export async function hasCredits(userId: string, min = 1): Promise<boolean> {
  return (await getCreditBalance(userId)) >= min;
}

// ---- Grants and debits ------------------------------------------------------

/** What a grant did: wrote it, found it already written, or refused it. */
export type GrantOutcome = "granted" | "duplicate" | "deleted_account";

/**
 * Add credits inside a transaction that HOLDS THE USER LOCK (see
 * withUserCreditLock). Refused for a deleted account; idempotent per key.
 */
export async function grantCreditsTx(
  tx: CreditsDb,
  userId: string,
  amount: number,
  reason: string,
  idempotencyKey?: string,
): Promise<GrantOutcome> {
  if (await isTombstoned(tx, userId)) return "deleted_account";
  if (idempotencyKey) {
    const done = await tx.creditLedger.findUnique({
      where: { idempotencyKey },
      select: { id: true },
    });
    if (done) return "duplicate";
  }
  if (amount <= 0) return "granted";
  if (!(await ensureAccountTx(tx, userId))) return "deleted_account";
  await tx.creditLedger.create({
    data: { userId, delta: amount, reason, idempotencyKey },
  });
  await tx.creditAccount.update({
    where: { userId },
    data: { balance: { increment: amount } },
  });
  return "granted";
}

/**
 * Add credits. Idempotent when an `idempotencyKey` is given, so the Stripe
 * webhook and the success-redirect can both call it without double-granting.
 * Never grants to a deleted account ("deleted_account": the caller refunds
 * whatever paid for it).
 */
export async function grantCredits(
  userId: string,
  amount: number,
  reason: string,
  idempotencyKey?: string,
): Promise<GrantOutcome> {
  if (amount <= 0) return "granted";
  try {
    return await withUserCreditLock(userId, (tx) =>
      grantCreditsTx(tx, userId, amount, reason, idempotencyKey),
    );
  } catch (err) {
    // A duplicate idempotencyKey means this grant already happened.
    if (isUniqueViolation(err)) return "duplicate";
    throw err;
  }
}

async function lockBalance(tx: CreditsDb, userId: string): Promise<number | null> {
  const rows = await tx.$queryRaw<{ balance: number }[]>`
    SELECT "balance" FROM "CreditAccount"
    WHERE "userId" = ${userId}
    FOR UPDATE`;
  return rows[0]?.balance ?? null;
}

/**
 * Remove up to `amount` credits inside a transaction, flooring the balance at
 * zero. The account row is locked (SELECT … FOR UPDATE) for the
 * read-decide-write, so concurrent debits serialize and can never drive the
 * balance negative. Never creates an account. With an `idempotencyKey`, a
 * repeat is a no-op (returns 0), and the ledger row is written even when it
 * removes nothing, so a retry of the same event stays a no-op.
 */
export async function debitCreditsTx(
  tx: CreditsDb,
  userId: string,
  amount: number,
  reason: string,
  idempotencyKey?: string,
): Promise<number> {
  if (amount <= 0) return 0;
  const balance = (await lockBalance(tx, userId)) ?? 0;
  if (idempotencyKey) {
    const done = await tx.creditLedger.findUnique({
      where: { idempotencyKey },
      select: { id: true },
    });
    if (done) return 0;
  }
  const debit = Math.min(amount, balance);
  if (debit <= 0 && !idempotencyKey) return 0;
  await tx.creditLedger.create({
    data: { userId, delta: -Math.max(0, debit), reason, idempotencyKey },
  });
  if (debit <= 0) return 0;
  await tx.creditAccount.update({
    where: { userId },
    data: { balance: { decrement: debit } },
  });
  return debit;
}

/** Atomically remove up to `amount` credits (see debitCreditsTx). */
export async function debitCredits(
  userId: string,
  amount: number,
  reason: string,
  idempotencyKey?: string,
): Promise<number> {
  if (amount <= 0) return 0;
  try {
    return await prisma.$transaction((tx) =>
      debitCreditsTx(tx, userId, amount, reason, idempotencyKey),
    );
  } catch (err) {
    if (idempotencyKey && isUniqueViolation(err)) return 0;
    throw err;
  }
}

/**
 * Charge a request's credits. Never fails or blocks after the work is done —
 * it deducts what it can and floors the balance at zero, so a user is never
 * billed mid-stream. Atomic under concurrency (see debitCredits). Returns the
 * number actually charged. Prefer a hold (reserveCredits) for model work, so
 * the cost is reserved before the work starts.
 */
export async function chargeCredits(
  userId: string,
  amount: number,
  reason: string,
): Promise<number> {
  if (amount <= 0) return 0;
  if (!(await ensureAccount(userId))) return 0;
  return debitCredits(userId, amount, reason);
}

// ---- Holds: reserve before model work, settle after -------------------------

/**
 * How long a hold may stay open. Longer than any request's maxDuration
 * (generation: 300 s), so only a request that died leaves one behind.
 */
export const CREDIT_HOLD_TTL_MS = 15 * 60 * 1000;

/** Credits reserved for one request (see reserveCredits). */
export interface CreditHold {
  id: string;
  userId: string;
  /** Credits taken from the balance when the hold was made. */
  amount: number;
  reason: string;
}

/**
 * Reserve credits BEFORE model work. Takes min(balance, estimate) from the
 * balance at once, under the account row lock, so parallel requests cannot
 * all start on the same credits: when less than `min` (default 1) is
 * available, nothing is reserved and null is returned (refuse the request).
 *
 * Every hold must end in exactly one of:
 *  - settleCreditHold(hold, actual): the work ran; charge its real cost (the
 *    difference to the hold is returned, or taken, never below zero);
 *  - releaseCreditHold(hold): the policy says this outcome is free.
 * Both are idempotent and a release after a settle does nothing, so callers
 * can settle on success and always release in `finally`. A settle records
 * the charge it intends on the hold before it runs, so if the settle itself
 * fails, the later release (or the expiry sweep) completes that charge
 * instead of giving the work away. A hold that is neither settled nor
 * released (a crashed request) is released once CREDIT_HOLD_TTL_MS passes.
 */
export async function reserveCredits(
  userId: string,
  opts: { estimate: number; min?: number; reason: string; ttlMs?: number },
): Promise<CreditHold | null> {
  const min = Math.max(1, Math.ceil(opts.min ?? 1));
  const want = Math.max(min, Math.ceil(opts.estimate));
  if (!(await ensureAccount(userId))) return null;
  await releaseExpiredHolds({ userId });
  return prisma.$transaction(async (tx) => {
    const balance = (await lockBalance(tx, userId)) ?? 0;
    if (balance < min) return null;
    const amount = Math.min(balance, want);
    const hold = await tx.creditHold.create({
      data: {
        userId,
        amount,
        reason: opts.reason,
        expiresAt: new Date(Date.now() + (opts.ttlMs ?? CREDIT_HOLD_TTL_MS)),
      },
    });
    await tx.creditLedger.create({
      data: { userId, delta: -amount, reason: `${opts.reason}_hold`, idempotencyKey: `hold:${hold.id}` },
    });
    await tx.creditAccount.update({
      where: { userId },
      data: { balance: { decrement: amount } },
    });
    return { id: hold.id, userId, amount, reason: opts.reason };
  });
}

/**
 * The work behind a hold ran: charge `actualCredits` in total. Returns the
 * credits charged (at most the hold plus what is left in the balance). If
 * the hold had already expired and been given back, the cost is charged
 * from the balance now. Idempotent: settling twice charges once.
 *
 * The intended charge is written on the hold first (`pendingCharge`): when
 * the settle transaction then fails, the hold is not given back by the
 * caller's release; it is settled at that amount by the release, or later by
 * the expiry sweep (getCreditBalance, the maintenance job).
 */
export async function settleCreditHold(
  hold: CreditHold,
  actualCredits: number,
  opts: { reason?: string } = {},
): Promise<number> {
  const actual = Math.max(0, Math.ceil(actualCredits));
  await prisma.creditHold.updateMany({
    where: { id: hold.id, state: "held" },
    data: { pendingCharge: actual },
  });
  return settleHoldTx(hold, actual, opts.reason ?? hold.reason);
}

async function settleHoldTx(
  hold: Pick<CreditHold, "id" | "userId">,
  actual: number,
  reason: string,
): Promise<number> {
  return prisma.$transaction(async (tx) => {
    const balance = await lockBalance(tx, hold.userId);
    const row = await tx.creditHold.findUnique({ where: { id: hold.id } });
    if (!row) return 0; // erased with the account
    if (row.state === "settled") return row.charged ?? 0;
    const key = `hold_settle:${row.id}`;
    let charged: number;
    let delta: number;
    if (row.state === "held") {
      const diff = actual - row.amount;
      delta = diff < 0 ? -diff : -Math.min(balance ?? 0, diff);
      charged = row.amount - delta;
    } else {
      // Expired (or released) before the work finished: charge it now.
      delta = -Math.min(balance ?? 0, actual);
      charged = -delta;
    }
    if (delta !== 0 && balance !== null) {
      await tx.creditLedger.create({
        data: { userId: row.userId, delta, reason, idempotencyKey: key },
      });
      await tx.creditAccount.update({
        where: { userId: row.userId },
        data: { balance: { increment: delta } },
      });
    }
    await tx.creditHold.update({
      where: { id: row.id },
      data: { state: "settled", charged, settledAt: new Date() },
    });
    return charged;
  });
}

/** What closing a hold did. */
type HoldClose = "released" | "settled" | "none";

/**
 * Close a hold that was not settled: give it back in full, unless a settle
 * recorded the charge it intended (and then failed): that charge is
 * completed instead, never given away.
 */
async function closeHoldById(id: string, state: "released" | "expired"): Promise<HoldClose> {
  const seen = await prisma.creditHold.findUnique({ where: { id } });
  if (!seen || seen.state !== "held") return "none";
  if (seen.pendingCharge !== null) {
    await settleHoldTx(seen, seen.pendingCharge, seen.reason);
    return "settled";
  }
  return (await releaseHoldById(id, state)) ? "released" : "none";
}

async function releaseHoldById(id: string, state: "released" | "expired"): Promise<boolean> {
  return prisma.$transaction(async (tx) => {
    const seen = await tx.creditHold.findUnique({ where: { id } });
    if (!seen || seen.state !== "held" || seen.pendingCharge !== null) return false;
    // Same lock order as reserve and settle: the account row first.
    const balance = await lockBalance(tx, seen.userId);
    // A settle that recorded its charge meanwhile wins: no release then.
    const claimed = await tx.creditHold.updateMany({
      where: { id, state: "held", pendingCharge: null },
      data: { state, charged: 0, settledAt: new Date() },
    });
    if (claimed.count === 0) return false;
    if (balance !== null) {
      await tx.creditLedger.create({
        data: {
          userId: seen.userId,
          delta: seen.amount,
          reason: `${seen.reason}_release`,
          idempotencyKey: `hold_release:${id}`,
        },
      });
      await tx.creditAccount.update({
        where: { userId: seen.userId },
        data: { balance: { increment: seen.amount } },
      });
    }
    return true;
  });
}

/**
 * Give a hold back in full (the outcome is free). No-op once settled or
 * released. A hold whose settle failed after recording its charge is settled
 * now instead (and stays open for the expiry sweep if that fails again).
 * Returns true only when credits went back.
 */
export async function releaseCreditHold(hold: Pick<CreditHold, "id">): Promise<boolean> {
  return (await closeHoldById(hold.id, "released")) === "released";
}

/**
 * Close holds left open past their expiry (all users, or one): give them
 * back, or complete the charge a failed settle recorded. Returns how many
 * were closed. A hold that cannot be closed now stays for the next run.
 */
export async function releaseExpiredHolds(
  opts: { userId?: string; now?: Date; limit?: number } = {},
): Promise<number> {
  const stale = await prisma.creditHold.findMany({
    where: {
      state: "held",
      expiresAt: { lt: opts.now ?? new Date() },
      ...(opts.userId ? { userId: opts.userId } : {}),
    },
    select: { id: true },
    orderBy: { expiresAt: "asc" },
    take: opts.limit ?? 500,
  });
  let closed = 0;
  for (const h of stale) {
    try {
      if ((await closeHoldById(h.id, "expired")) !== "none") closed++;
    } catch {
      // The database refused this one now; the next read or run retries it.
    }
  }
  return closed;
}

/** Net credits moved by ledger rows whose key starts with `prefix`. */
export async function ledgerSumForKeyPrefix(
  userId: string,
  prefix: string,
  db: CreditsDb = prisma,
): Promise<number> {
  const agg = await db.creditLedger.aggregate({
    _sum: { delta: true },
    where: { userId, idempotencyKey: { startsWith: prefix } },
  });
  return agg._sum.delta ?? 0;
}

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: string }).code === "P2002"
  );
}
