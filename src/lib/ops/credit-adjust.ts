/**
 * Operator credit adjustments, for the Support tools of the operator console
 * (/app/admin): a grant or a deduction on one student's balance (a
 * withdrawal, where the unused Pro credits of that period are removed, or
 * support goodwill), and the read-only account lookup shown beside it.
 *
 * An adjustment moves credits only through the credits module, under the
 * user's credit lock (lib/credits.ts): grantCreditsTx for a grant,
 * debitCreditsTx for a deduction, which floors the balance at zero (a
 * deduction larger than the balance takes it to zero, and the result says
 * so). Its ledger row has reason ADMIN_ADJUST_REASON and an idempotency key
 * made from the form's nonce, so a double submit applies once; an audit row
 * (BillingEvent of the same kind) records who made it, why, and the credits
 * it moved. Unknown users (no CreditAccount: an adjustment never creates an
 * account, or its trial grant) and deleted accounts are refused.
 *
 * Server-only. Callers check the admin allow-list (lib/ops/admin.ts) first.
 */
import "server-only";

import { prisma } from "@/lib/db";
import {
  debitCreditsTx,
  grantCreditsTx,
  subscriptionGrantsPro,
  withUserCreditLock,
} from "@/lib/credits";

/** The ledger reason (and audit kind) of an operator adjustment; never counted as AI spending. */
export const ADMIN_ADJUST_REASON = "admin_adjust";
/** The largest grant or deduction one adjustment may make. */
export const ADMIN_ADJUST_MAX = 100_000;
/** The longest note an adjustment may carry. */
export const ADMIN_NOTE_MAX_CHARS = 200;
/** Ledger rows the lookup shows, newest first. */
export const LOOKUP_LEDGER_ROWS = 10;

/** The ledger key of the adjustment submitted with `nonce`. */
export const adjustmentKey = (nonce: string) => `${ADMIN_ADJUST_REASON}:${nonce}`;

/** A Clerk user id as the console accepts it ([A-Za-z0-9_], at most 64), else null. */
export function parseUserId(value: unknown): string | null {
  const text = (Array.isArray(value) ? value[0] : value) as unknown;
  if (typeof text !== "string") return null;
  const id = text.trim();
  return /^[A-Za-z0-9_]{1,64}$/.test(id) ? id : null;
}

export type CreditAdjustment =
  /** Written: `delta` is what moved (a deduction can be less than asked, see `before`). */
  | { outcome: "applied"; userId: string; requested: number; delta: number; before: number; after: number }
  /** This nonce was applied already (a double submit): nothing more moved. */
  | { outcome: "duplicate"; userId: string; delta: number }
  /** Refused, nothing written. */
  | { outcome: "unknown_user" | "deleted_account"; userId: string };

function isUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: string }).code === "P2002";
}

/**
 * Grant (`amount` > 0) or deduct (`amount` < 0) credits for one user, once per
 * `nonce`. `amount` must be a non-zero integer of at most ADMIN_ADJUST_MAX;
 * `note` is stored with the operator's id on the audit row.
 */
export async function adjustCredits(input: {
  userId: string;
  amount: number;
  note: string;
  nonce: string;
  adminId: string;
}): Promise<CreditAdjustment> {
  const { userId, amount } = input;
  if (!Number.isInteger(amount) || amount === 0 || Math.abs(amount) > ADMIN_ADJUST_MAX) {
    throw new Error("adjustCredits: amount must be a non-zero integer within the limit");
  }
  const key = adjustmentKey(input.nonce);
  const note = input.note.replace(/\s+/g, " ").trim().slice(0, ADMIN_NOTE_MAX_CHARS);
  const earlier = async (db: Pick<typeof prisma, "creditLedger">) =>
    db.creditLedger.findUnique({ where: { idempotencyKey: key }, select: { userId: true, delta: true } });

  try {
    return await withUserCreditLock(userId, async (tx): Promise<CreditAdjustment> => {
      const done = await earlier(tx);
      if (done) return { outcome: "duplicate", userId: done.userId, delta: done.delta };
      if (await tx.deletedAccount.findUnique({ where: { userId }, select: { userId: true } })) {
        return { outcome: "deleted_account", userId };
      }
      // The account row, locked for the read-decide-write (lock order: the
      // user lock, then this row, as everywhere in lib/credits.ts).
      const rows = await tx.$queryRaw<{ balance: number }[]>`
        SELECT "balance" FROM "CreditAccount"
        WHERE "userId" = ${userId}
        FOR UPDATE`;
      if (!rows[0]) return { outcome: "unknown_user", userId };
      const before = rows[0].balance;
      let delta: number;
      if (amount > 0) {
        const granted = await grantCreditsTx(tx, userId, amount, ADMIN_ADJUST_REASON, key);
        if (granted === "deleted_account") return { outcome: "deleted_account", userId };
        delta = amount;
      } else {
        // 0 - n, not -n: nothing taken is 0, never -0.
        delta = 0 - (await debitCreditsTx(tx, userId, -amount, ADMIN_ADJUST_REASON, key));
      }
      await tx.billingEvent.create({
        data: {
          userId,
          kind: ADMIN_ADJUST_REASON,
          stripeObjectId: key,
          credits: delta,
          detail: `by ${input.adminId}: ${note}`,
        },
      });
      return { outcome: "applied", userId, requested: amount, delta, before, after: before + delta };
    });
  } catch (err) {
    // The same form submitted at once for another user id: the first one won.
    if (isUniqueViolation(err)) {
      const done = await earlier(prisma);
      if (done) return { outcome: "duplicate", userId: done.userId, delta: done.delta };
    }
    throw err;
  }
}

export interface AccountLookup {
  userId: string;
  /** Has a CreditAccount (StudyOS has seen this user). */
  exists: boolean;
  /** The account was deleted (tombstone). */
  deleted: boolean;
  balance: number | null;
  /** What the plan check (lib/credits.ts subscriptionGrantsPro) says right now. */
  pro: boolean;
  subscription: {
    status: string;
    currentPeriodEnd: Date | null;
    stripeCustomerId: string | null;
    stripeSubscriptionId: string | null;
    disputeId: string | null;
    allowanceYearly: boolean;
  } | null;
  /** The latest ledger rows, newest first; an operator adjustment carries its note. */
  ledger: { delta: number; reason: string; key: string | null; createdAt: Date; note: string | null }[];
}

/** Everything the console shows about one user's credits and plan. Reads only (never creates an account). */
export async function lookupAccount(userId: string): Promise<AccountLookup> {
  const [account, tombstone, subscription, ledger] = await Promise.all([
    prisma.creditAccount.findUnique({ where: { userId }, select: { balance: true } }),
    prisma.deletedAccount.findUnique({ where: { userId }, select: { userId: true } }),
    prisma.subscription.findUnique({
      where: { userId },
      select: {
        status: true,
        currentPeriodEnd: true,
        stripeCustomerId: true,
        stripeSubscriptionId: true,
        disputeId: true,
        allowanceYearly: true,
      },
    }),
    prisma.creditLedger.findMany({
      where: { userId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: LOOKUP_LEDGER_ROWS,
      select: { delta: true, reason: true, idempotencyKey: true, createdAt: true },
    }),
  ]);
  const adjustmentKeys = ledger
    .filter((row) => row.reason === ADMIN_ADJUST_REASON && row.idempotencyKey)
    .map((row) => row.idempotencyKey!);
  const notes = adjustmentKeys.length
    ? await prisma.billingEvent.findMany({
        where: { kind: ADMIN_ADJUST_REASON, stripeObjectId: { in: adjustmentKeys } },
        select: { stripeObjectId: true, detail: true },
      })
    : [];
  const noteOf = new Map(notes.map((row) => [row.stripeObjectId, row.detail]));
  return {
    userId,
    exists: account !== null,
    deleted: tombstone !== null,
    balance: account?.balance ?? null,
    pro: subscriptionGrantsPro(subscription),
    subscription,
    ledger: ledger.map((row) => ({
      delta: row.delta,
      reason: row.reason,
      key: row.idempotencyKey,
      createdAt: row.createdAt,
      note: row.idempotencyKey ? (noteOf.get(row.idempotencyKey) ?? null) : null,
    })),
  };
}
