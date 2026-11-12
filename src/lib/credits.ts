/**
 * StudyOS credit system (server-only).
 *
 * Every AI request spends credits in proportion to the GLM 5.2 tokens it
 * actually used. The peg the product is priced around:
 *
 *     1000 credits === $3.00 of GLM 5.2 token spend   →   1 credit = $0.003
 *
 * So a request that cost $0.03 of tokens spends ~10 credits, and a big,
 * complex request that cost $0.12 spends ~40 — "based on how complex it is"
 * falls out naturally from real token usage.
 */
import { prisma } from "@/lib/db";
import type { TokenUsage } from "@/lib/ai/usage-meter";

// GLM 5.2 list price on OpenRouter, USD per 1,000,000 tokens.
// (Switch to the rolling weighted-average rate if you prefer: 0.429 / 4.41.)
export const GLM_INPUT_USD_PER_MTOK = 1.4;
export const GLM_OUTPUT_USD_PER_MTOK = 4.4;

/** The peg: 1000 credits buys $3.00 of token spend. */
export const USD_PER_1000_CREDITS = 3;
const USD_PER_CREDIT = USD_PER_1000_CREDITS / 1000; // $0.003

/** Credits granted automatically the first time a user is seen (free tier). */
export const FREE_SIGNUP_CREDITS = 300;
/**
 * Free users refresh to at least this many credits each calendar month (only
 * granted when the balance has dropped below it — no stockpiling). Keeps free
 * users alive to return at exam season instead of dying at zero forever.
 */
export const FREE_MONTHLY_CREDITS = 150;
/**
 * Credits granted for each paid month of Pro: on every paid monthly invoice,
 * and for annual plans on the paid invoice plus each monthly anniversary of
 * the paid year (see accrueProAllowance). Unused credits roll over (they add
 * to the balance; nothing resets it).
 */
export const PRO_MONTHLY_CREDITS = 1000;
/** The buyable credit pack. */
export const CREDIT_PACK_SIZE = 1000;
export const CREDIT_PACK_PRICE_USD = 10;
/** Flat credit price of one sandbox render run (covers Daytona compute). */
export const SANDBOX_RUN_CREDITS = 2;

/** Dollar cost of a request's tokens at GLM 5.2 list price. */
export function usageToUsd(usage: TokenUsage): number {
  return (
    (usage.promptTokens / 1_000_000) * GLM_INPUT_USD_PER_MTOK +
    (usage.completionTokens / 1_000_000) * GLM_OUTPUT_USD_PER_MTOK
  );
}

/** Credits a request costs. 0 when nothing ran (e.g. the local mock); else ≥ 1. */
export function usageToCredits(usage: TokenUsage): number {
  if (usage.promptTokens <= 0 && usage.completionTokens <= 0) return 0;
  return Math.max(1, Math.ceil(usageToUsd(usage) / USD_PER_CREDIT));
}

/** Create the account on first sight, seeding the free starter grant once. */
async function ensureAccount(userId: string): Promise<{ balance: number }> {
  const existing = await prisma.creditAccount.findUnique({ where: { userId } });
  if (existing) return existing;
  try {
    await prisma.$transaction([
      prisma.creditAccount.create({
        data: { userId, balance: FREE_SIGNUP_CREDITS },
      }),
      prisma.creditLedger.create({
        data: {
          userId,
          delta: FREE_SIGNUP_CREDITS,
          reason: "free_signup",
          idempotencyKey: `free_signup:${userId}`,
        },
      }),
    ]);
  } catch {
    // Lost a race to create the account — fine, it now exists.
  }
  const account = await prisma.creditAccount.findUnique({ where: { userId } });
  return account ?? { balance: 0 };
}

type AllowanceSub = {
  status: string;
  allowancePeriodStart: Date | null;
  allowancePeriodEnd: Date | null;
} | null;

/**
 * Monthly free-tier refresh, applied lazily on any balance read: when a
 * non-Pro user's balance has fallen below FREE_MONTHLY_CREDITS, grant the
 * month's refresh once (idempotent per calendar month). Pro users get their
 * monthly credits from paid invoices instead. Returns true when it granted.
 */
async function maybeMonthlyRefresh(
  userId: string,
  balance: number,
  sub: AllowanceSub,
): Promise<boolean> {
  if (balance >= FREE_MONTHLY_CREDITS) return false;
  if (sub?.status === "active") return false;
  const monthKey = new Date().toISOString().slice(0, 7); // YYYY-MM
  const idempotencyKey = `free_monthly:${userId}:${monthKey}`;
  // Hot path: getCreditBalance runs on every credit gate, agent charge, and
  // meter render. Once this month's refresh exists, skip the doomed grant
  // (which would otherwise open a transaction that always fails P2002).
  const already = await prisma.creditLedger.findUnique({
    where: { idempotencyKey },
    select: { id: true },
  });
  if (already) return false;
  await grantCredits(userId, FREE_MONTHLY_CREDITS, "free_monthly", idempotencyKey);
  return true;
}

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

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Which monthly allowances (index ≥ 1) are due inside a paid billing period.
 * Allowance 0 is granted by the paid invoice itself; allowance i falls on
 * the i-th monthly anniversary of the period start. Anniversaries within a
 * day of the period end belong to the next invoice, so a monthly period
 * yields none and an annual period yields up to 11.
 */
export function dueAllowanceMonths(
  periodStart: Date,
  periodEnd: Date,
  now: Date,
): number[] {
  const due: number[] = [];
  for (let i = 1; i < 24; i++) {
    const anniversary = addMonthsUtc(periodStart, i);
    if (anniversary.getTime() > periodEnd.getTime() - DAY_MS) break;
    if (anniversary.getTime() > now.getTime()) break;
    due.push(i);
  }
  return due;
}

/** Ledger key of the i-th monthly allowance inside a paid period. */
export function allowanceKey(userId: string, periodStart: Date, i: number) {
  return `pro_grant:${userId}:${Math.floor(periodStart.getTime() / 1000)}:m${i}`;
}

/**
 * Lazily grant the monthly Pro allowances an annual (or any multi-month)
 * subscriber has reached since their paid period began. Idempotent per
 * (period, month) via the ledger key, granted in order so that the newest
 * due month existing means every earlier one does. Returns true when it granted.
 */
async function accrueProAllowance(
  userId: string,
  sub: AllowanceSub,
): Promise<boolean> {
  if (sub?.status !== "active") return false;
  const { allowancePeriodStart: start, allowancePeriodEnd: end } = sub;
  if (!start || !end) return false;
  const due = dueAllowanceMonths(start, end, new Date());
  if (due.length === 0) return false;
  const newest = await prisma.creditLedger.findUnique({
    where: { idempotencyKey: allowanceKey(userId, start, due[due.length - 1]) },
    select: { id: true },
  });
  if (newest) return false;
  for (const i of due) {
    await grantCredits(
      userId,
      PRO_MONTHLY_CREDITS,
      "pro_monthly",
      allowanceKey(userId, start, i),
    );
  }
  return true;
}

/** Current balance (creates + seeds the account on first call). */
export async function getCreditBalance(userId: string): Promise<number> {
  const account = await ensureAccount(userId);
  const sub = await prisma.subscription.findUnique({
    where: { userId },
    select: {
      status: true,
      allowancePeriodStart: true,
      allowancePeriodEnd: true,
    },
  });
  const accrued = await accrueProAllowance(userId, sub);
  const refreshed =
    !accrued && (await maybeMonthlyRefresh(userId, account.balance, sub));
  if (!accrued && !refreshed) return account.balance;
  const fresh = await prisma.creditAccount.findUnique({ where: { userId } });
  return fresh?.balance ?? account.balance;
}

/** True when the user has at least `min` credits (default 1). */
export async function hasCredits(userId: string, min = 1): Promise<boolean> {
  return (await getCreditBalance(userId)) >= min;
}

/**
 * Add credits. Idempotent when an `idempotencyKey` is given, so the Stripe
 * webhook and the success-redirect can both call it without double-granting.
 */
export async function grantCredits(
  userId: string,
  amount: number,
  reason: string,
  idempotencyKey?: string,
): Promise<void> {
  if (amount <= 0) return;
  await ensureAccount(userId);
  try {
    await prisma.$transaction([
      prisma.creditLedger.create({
        data: { userId, delta: amount, reason, idempotencyKey },
      }),
      prisma.creditAccount.update({
        where: { userId },
        data: { balance: { increment: amount } },
      }),
    ]);
  } catch (err) {
    // A duplicate idempotencyKey means this grant already happened — ignore.
    if (isUniqueViolation(err)) return;
    throw err;
  }
}

/**
 * Atomically remove up to `amount` credits, flooring the balance at zero.
 * The account row is locked (SELECT … FOR UPDATE) for the read-decide-write,
 * so concurrent debits serialize and can never drive the balance negative.
 * Never creates an account. With an `idempotencyKey`, a repeat is a no-op
 * (returns 0). Returns the number actually removed.
 */
export async function debitCredits(
  userId: string,
  amount: number,
  reason: string,
  idempotencyKey?: string,
): Promise<number> {
  if (amount <= 0) return 0;
  try {
    return await prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<{ balance: number }[]>`
        SELECT "balance" FROM "CreditAccount"
        WHERE "userId" = ${userId}
        FOR UPDATE`;
      const balance = rows[0]?.balance ?? 0;
      const debit = Math.min(amount, balance);
      if (debit <= 0 && !idempotencyKey) return 0;
      // A keyed debit records its ledger row even when it removes nothing,
      // so a retry of the same event stays a no-op.
      await tx.creditLedger.create({
        data: { userId, delta: -Math.max(0, debit), reason, idempotencyKey },
      });
      if (debit <= 0) return 0;
      await tx.creditAccount.update({
        where: { userId },
        data: { balance: { decrement: debit } },
      });
      return debit;
    });
  } catch (err) {
    if (idempotencyKey && isUniqueViolation(err)) return 0;
    throw err;
  }
}

/**
 * Charge a request's credits. Never fails or blocks after the work is done —
 * it deducts what it can and floors the balance at zero, so a user is never
 * billed mid-stream. Atomic under concurrency (see debitCredits). Returns the
 * number actually charged.
 */
export async function chargeCredits(
  userId: string,
  amount: number,
  reason: string,
): Promise<number> {
  if (amount <= 0) return 0;
  await ensureAccount(userId);
  return debitCredits(userId, amount, reason);
}

/** Net credits moved by ledger rows whose key starts with `prefix`. */
export async function ledgerSumForKeyPrefix(
  userId: string,
  prefix: string,
): Promise<number> {
  const agg = await prisma.creditLedger.aggregate({
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
