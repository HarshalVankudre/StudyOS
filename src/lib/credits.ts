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
/** Credits granted on every paid Pro invoice (signup and each renewal). */
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

/**
 * Monthly free-tier refresh, applied lazily on any balance read: when a
 * non-Pro user's balance has fallen below FREE_MONTHLY_CREDITS, grant the
 * month's refresh once (idempotent per calendar month). Pro users get their
 * monthly credits from the paid-invoice webhook instead.
 */
async function maybeMonthlyRefresh(
  userId: string,
  balance: number,
): Promise<number> {
  if (balance >= FREE_MONTHLY_CREDITS) return 0;
  const sub = await prisma.subscription.findUnique({ where: { userId } });
  if (sub?.status === "active") return 0;
  const monthKey = new Date().toISOString().slice(0, 7); // YYYY-MM
  await grantCredits(
    userId,
    FREE_MONTHLY_CREDITS,
    "free_monthly",
    `free_monthly:${userId}:${monthKey}`,
  );
  const account = await prisma.creditAccount.findUnique({ where: { userId } });
  return account ? account.balance - balance : 0;
}

/** Current balance (creates + seeds the account on first call). */
export async function getCreditBalance(userId: string): Promise<number> {
  const account = await ensureAccount(userId);
  const refreshed = await maybeMonthlyRefresh(userId, account.balance);
  return account.balance + refreshed;
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
 * Charge a request's credits. Never fails or blocks after the work is done —
 * it deducts what it can and floors the balance at zero, so a user is never
 * billed mid-stream. Returns the number actually charged.
 */
export async function chargeCredits(
  userId: string,
  amount: number,
  reason: string,
): Promise<number> {
  if (amount <= 0) return 0;
  const account = await ensureAccount(userId);
  const charge = Math.min(amount, account.balance);
  if (charge <= 0) return 0;
  await prisma.$transaction([
    prisma.creditLedger.create({
      data: { userId, delta: -charge, reason },
    }),
    prisma.creditAccount.update({
      where: { userId },
      data: { balance: { decrement: charge } },
    }),
  ]);
  return charge;
}

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: string }).code === "P2002"
  );
}
