/**
 * Billing rules (server-only). Every money decision lives here so the
 * checkout actions, the checkout success redirect and the Stripe webhook all
 * apply the same rules:
 *
 *  - one Stripe customer per user, reused for every checkout;
 *  - at most one live Pro subscription per user (checkout is blocked while one
 *    exists; a duplicate that slips through anyway is canceled and refunded,
 *    through a BillingIntent written before the first Stripe call, so a
 *    failure part-way is finished by the next event, retry or maintenance run);
 *  - subscription status always comes from the LIVE Stripe subscription, never
 *    from a replayed or out-of-order event payload, and a write carrying an
 *    older fetch (or a live status for an ended subscription) never wins;
 *  - credits are granted only for money actually received, and a month of Pro
 *    coverage is granted once however many invoices touch it;
 *  - nothing is granted to an account that has been deleted, and a deleted
 *    account's billing is canceled durably (retried until Stripe confirms).
 */
import { auth } from "@clerk/nextjs/server";
import type Stripe from "stripe";
import { prisma } from "@/lib/db";
import type { BillingIntent } from "@/generated/prisma";
import { stripe, stripeId } from "@/lib/stripe";
import type { Plan } from "@/lib/ai/plans";
import { reportError } from "@/lib/ops/report-error";
import {
  accrueProAllowance,
  type AllowanceRow,
  CREDIT_PACK_PRICE_USD,
  CREDIT_PACK_SIZE,
  type CreditsDb,
  debitCreditsTx,
  grantCreditsTx,
  grantProMonth,
  isYearlyPeriod,
  releaseExpiredHolds,
  subscriptionGrantsPro,
  withUserCreditLock,
} from "@/lib/credits";

export { PRO_GRACE_MS } from "@/lib/credits";

const DAY_MS = 24 * 60 * 60 * 1000;

// ---- Plan -------------------------------------------------------------------

const PLAN_SELECT = { status: true, currentPeriodEnd: true, disputeId: true } as const;

/**
 * The current user's plan: "pro" while their subscription is active, its paid
 * period (plus a grace interval) has not run out, and no dispute is open on
 * the payment of that period.
 */
export async function getUserPlan(): Promise<Plan> {
  const { userId } = await auth();
  if (userId) {
    const sub = await prisma.subscription.findUnique({ where: { userId }, select: PLAN_SELECT });
    if (subscriptionGrantsPro(sub)) return "pro";
  }
  // Dev-only override (no subscription): act as a given plan while testing.
  // Never honoured in production, where it would hand out Pro for free.
  if (process.env.NODE_ENV !== "production") {
    const override = process.env.STUDYOS_PLAN;
    if (override === "pro" || override === "free") return override;
  }
  return "free";
}

/** Has the signed-in user got Pro right now? (See getUserPlan.) */
export async function isPro(): Promise<boolean> {
  const { userId } = await auth();
  if (!userId) return false;
  const sub = await prisma.subscription.findUnique({ where: { userId }, select: PLAN_SELECT });
  return subscriptionGrantsPro(sub);
}

// ---- Status mapping ---------------------------------------------------------

/** Stripe statuses that mean "Pro right now". */
const ACTIVE_STATUSES = new Set<string>(["active", "trialing"]);
/** Stripe statuses of a subscription that can never bill again. */
const ENDED_STATUSES = new Set<string>(["canceled", "incomplete_expired"]);

/** Our stored status: "active" while Pro, else Stripe's own status. */
export function planStatus(stripeStatus: string): string {
  return ACTIVE_STATUSES.has(stripeStatus) ? "active" : stripeStatus;
}

function currentPeriodEnd(sub: Stripe.Subscription): Date | null {
  const ends = (sub.items?.data ?? [])
    .map((item) => item.current_period_end)
    .filter((n): n is number => typeof n === "number");
  return ends.length ? new Date(Math.max(...ends) * 1000) : null;
}

const fromUnix = (n: number | null | undefined) => (typeof n === "number" ? new Date(n * 1000) : null);

/** When an ended subscription stopped (Stripe's ended_at, else canceled_at). */
function endedAt(sub: Stripe.Subscription): Date | null {
  return fromUnix(sub.ended_at) ?? fromUnix(sub.canceled_at);
}

const earliest = (...dates: (Date | null | undefined)[]): Date | null =>
  dates.reduce<Date | null>(
    (min, d) => (d && (!min || d.getTime() < min.getTime()) ? d : min),
    null,
  );

/**
 * True when a Stripe cancel error means the subscription is already gone
 * (canceled or never existed) — a non-transient client (4xx) error we can
 * safely treat as "billing stopped". Transient errors (network, 5xx, rate
 * limit) return false so callers abort rather than orphan live billing.
 */
export function isSubscriptionAlreadyGone(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const e = err as { code?: string; type?: string };
  return e.code === "resource_missing" || e.type === "StripeInvalidRequestError";
}

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    (err as { code?: string }).code === "P2002"
  );
}

/** A short, secret-free description of a failure for BillingIntent.lastError. */
function describeError(err: unknown): string {
  const e = err as { type?: string; code?: string; message?: string };
  return [e?.type, e?.code, e?.message].filter(Boolean).join(": ").slice(0, 300) || "error";
}

// ---- Audit + tombstones -----------------------------------------------------

/** Has this user deleted their account? (Late webhooks must not revive it.) */
export async function isDeletedAccount(userId: string): Promise<boolean> {
  const row = await prisma.deletedAccount.findUnique({ where: { userId } });
  return row !== null;
}

type BillingEventInput = {
  userId?: string | null;
  kind: string;
  stripeObjectId: string;
  paymentIntentId?: string | null;
  amountCents?: number | null;
  credits?: number | null;
  detail?: string | null;
};

/** Record a billing event once; returns false when it was already recorded. */
export async function recordBillingEvent(
  data: BillingEventInput,
): Promise<boolean> {
  try {
    await prisma.billingEvent.create({ data });
    return true;
  } catch (err) {
    if (isUniqueViolation(err)) return false;
    throw err;
  }
}

async function hasBillingEvent(kind: string, stripeObjectId: string) {
  const row = await prisma.billingEvent.findUnique({
    where: { kind_stripeObjectId: { kind, stripeObjectId } },
    select: { id: true },
  });
  return row !== null;
}

// ---- Durable billing jobs (BillingIntent) ------------------------------------

const REFUND_SUBSCRIPTION = "refund_subscription";
const CANCEL_ACCOUNT_BILLING = "cancel_account_billing";
type RefundReason = "duplicate_subscription" | "deleted_account_subscription";

async function findIntent(kind: string, key: string) {
  return prisma.billingIntent.findUnique({ where: { kind_key: { kind, key } } });
}

/** Write an intent once (before any Stripe call); returns the stored one. */
async function recordIntent(data: {
  kind: string;
  key: string;
  userId: string;
  reason?: string;
}): Promise<BillingIntent> {
  try {
    return await prisma.billingIntent.create({ data });
  } catch (err) {
    if (!isUniqueViolation(err)) throw err;
    const existing = await findIntent(data.kind, data.key);
    if (!existing) throw err;
    return existing;
  }
}

/** Run an intent's (idempotent) work; mark it done, or count the failure and rethrow. */
async function runIntent(intent: BillingIntent, work: () => Promise<void>): Promise<void> {
  try {
    await work();
  } catch (err) {
    await prisma.billingIntent
      .update({
        where: { id: intent.id },
        data: { attempts: { increment: 1 }, lastError: describeError(err) },
      })
      .catch(() => undefined);
    throw err;
  }
  await prisma.billingIntent.update({
    where: { id: intent.id },
    data: { state: "done", completedAt: new Date(), attempts: { increment: 1 }, lastError: null },
  });
}

/**
 * Refund what is left of a payment, idempotently: money already refunded
 * (by an earlier attempt or by hand) is never refunded twice. A refund Stripe
 * refuses as a client error is reported, not thrown, so a webhook does not
 * retry forever; transient errors throw so the caller retries.
 */
async function refundRemaining(
  paymentIntentId: string,
  paidCents: number | null,
  reason: "duplicate" | "requested_by_customer",
): Promise<{ refunded: number; error?: string }> {
  const existing = await stripe.refunds.list({ payment_intent: paymentIntentId, limit: 100 });
  const already = existing.data
    .filter((r) => r.status !== "failed" && r.status !== "canceled")
    .reduce((sum, r) => sum + r.amount, 0);
  if (paidCents !== null && already >= paidCents) return { refunded: already };
  try {
    const refund = await stripe.refunds.create(
      { payment_intent: paymentIntentId, reason },
      { idempotencyKey: `studyos-refund-${reason}-${paymentIntentId}-${already}` },
    );
    return { refunded: already + refund.amount };
  } catch (err) {
    const e = err as { type?: string; code?: string };
    if (e?.type === "StripeInvalidRequestError") {
      return { refunded: already, error: e.code ?? "invalid_request" };
    }
    throw err;
  }
}

/**
 * Cancel a subscription that must not exist (a duplicate, or one created for
 * a deleted account) and refund its latest invoice. The intent is recorded
 * BEFORE the cancel, so from that moment its invoices never grant credits,
 * and a failure at any later step is completed by the next event for the
 * subscription (whatever its live status), a webhook retry, or the
 * maintenance job.
 */
async function cancelAndRefund(
  userId: string,
  subscriptionId: string,
  reason: RefundReason,
): Promise<void> {
  const intent = await recordIntent({ kind: REFUND_SUBSCRIPTION, key: subscriptionId, userId, reason });
  if (intent.state !== "done") await completeRefundIntent(intent);
}

async function completeRefundIntent(intent: BillingIntent): Promise<void> {
  await runIntent(intent, async () => {
    const subscriptionId = intent.key;
    try {
      await stripe.subscriptions.cancel(subscriptionId);
    } catch (err) {
      if (!isSubscriptionAlreadyGone(err)) throw err;
    }
    const sub = await retrieveSubscriptionOrNull(subscriptionId);
    const invoiceId = stripeId(sub?.latest_invoice ?? null);
    let refunded = 0;
    const notes: string[] = [];
    if (invoiceId) {
      const payments = await stripe.invoicePayments.list({ invoice: invoiceId, limit: 10 });
      for (const p of payments.data) {
        if (p.status !== "paid") continue;
        const pi = stripeId(p.payment?.payment_intent ?? null);
        if (!pi) {
          notes.push(`manual refund needed: ${p.id}`);
          continue;
        }
        const r = await refundRemaining(
          pi,
          p.amount_paid ?? null,
          intent.reason === "duplicate_subscription" ? "duplicate" : "requested_by_customer",
        );
        refunded += r.refunded;
        if (r.error) notes.push(`refund ${pi} failed: ${r.error}`);
      }
    }
    await recordBillingEvent({
      userId: intent.userId,
      kind: intent.reason ?? "duplicate_subscription",
      stripeObjectId: subscriptionId,
      amountCents: refunded,
      detail: [invoiceId && `invoice ${invoiceId}`, ...notes].filter(Boolean).join("; ") || null,
    });
  });
}

/** Does this subscription belong to a cancel-and-refund job (so it must never grant)? */
async function subscriptionMustNotGrant(subscriptionId: string): Promise<boolean> {
  if (await findIntent(REFUND_SUBSCRIPTION, subscriptionId)) return true;
  // Rows written before intents existed.
  return (
    (await hasBillingEvent("duplicate_subscription", subscriptionId)) ||
    (await hasBillingEvent("deleted_account_subscription", subscriptionId))
  );
}

// ---- Subscription state -----------------------------------------------------

export type ApplyOutcome =
  /** Written to the user's row. */
  | "ok"
  /** Nothing written: an old subscription ended, or a newer state is stored. */
  | "stale"
  /** Not active and the user has no billing row; nothing written. */
  | "untracked"
  /** A second live subscription: canceled and refunded. */
  | "duplicate"
  /** The account was deleted: nothing written, live billing stopped. */
  | "deleted_account";

/** Allowance fields reset when the row moves to another subscription. */
const CLEARED_ALLOWANCE = {
  allowanceSubscriptionId: null,
  allowancePaymentIntentId: null,
  allowancePeriodStart: null,
  allowancePeriodEnd: null,
  allowanceYearly: false,
  allowanceStopAt: null,
  disputeId: null,
  disputedAt: null,
};

/**
 * Bring the user's row in line with a LIVE Stripe subscription (retrieved
 * from Stripe, not taken from an event payload, so replays and out-of-order
 * delivery cannot resurrect or kill Pro). `fetchedAt` is when that live state
 * was read (take it just before the Stripe call): the write is conditional,
 * so a state fetched earlier never overwrites one fetched later, and a
 * subscription that ended never becomes live again. Safe to call repeatedly
 * and concurrently.
 */
export async function applyLiveSubscription(
  userId: string,
  sub: Stripe.Subscription,
  fetchedAt: Date = new Date(),
): Promise<ApplyOutcome> {
  // A subscription already judged one that must not exist: finish that job
  // (cancel + refund + audit), whatever its live status is by now.
  const intent = await findIntent(REFUND_SUBSCRIPTION, sub.id);
  if (intent) {
    if (intent.state !== "done") await completeRefundIntent(intent);
    return intent.reason === "duplicate_subscription" ? "duplicate" : "deleted_account";
  }

  if (await isDeletedAccount(userId)) {
    if (!ENDED_STATUSES.has(sub.status)) {
      await cancelAndRefund(userId, sub.id, "deleted_account_subscription");
    }
    return "deleted_account";
  }

  const status = planStatus(sub.status);
  const ended = ENDED_STATUSES.has(sub.status);
  const fields = {
    status,
    stripeSubscriptionId: sub.id,
    currentPeriodEnd: currentPeriodEnd(sub),
    stripeSyncedAt: fetchedAt,
  };

  // Optimistic: each write is conditional on what was read; on a lost race
  // the decision is taken again from the new row.
  for (let attempt = 0; attempt < 5; attempt++) {
    const row = await prisma.subscription.findUnique({ where: { userId } });
    const customer = stripeId(sub.customer) ?? row?.stripeCustomerId ?? null;

    if (row?.stripeSubscriptionId === sub.id) {
      // The subscription we track. An end caps its allowance accrual.
      const stopAt = ended && row.allowanceSubscriptionId === sub.id
        ? earliest(row.allowanceStopAt, endedAt(sub) ?? fetchedAt)
        : undefined;
      const written = await prisma.subscription.updateMany({
        where: {
          userId,
          stripeSubscriptionId: sub.id,
          OR: [{ stripeSyncedAt: null }, { stripeSyncedAt: { lte: fetchedAt } }],
          // An ended subscription can never come back: a live status for it is stale.
          ...(ended ? {} : { status: { notIn: [...ENDED_STATUSES] } }),
        },
        data: { ...fields, stripeCustomerId: customer, ...(stopAt ? { allowanceStopAt: stopAt } : {}) },
      });
      return written.count > 0 ? "ok" : "stale";
    }

    if (row?.stripeSubscriptionId) {
      // Not the subscription we track. An ending one never downgrades the user.
      if (status !== "active") return "stale";
      const tracked = await retrieveSubscriptionOrNull(row.stripeSubscriptionId);
      if (tracked && ACTIVE_STATUSES.has(tracked.status)) {
        // Two live subscriptions: keep the one we already track.
        await cancelAndRefund(userId, sub.id, "duplicate_subscription");
        return "duplicate";
      }
      let trackedEnd = tracked ? endedAt(tracked) : null;
      if (tracked && !ENDED_STATUSES.has(tracked.status)) {
        // The tracked one is failing (past_due/unpaid/…) and this one replaced
        // it: stop the old one so a later retry cannot charge the card again.
        try {
          await stripe.subscriptions.cancel(tracked.id);
        } catch (err) {
          if (!isSubscriptionAlreadyGone(err)) throw err;
        }
        trackedEnd = new Date();
        await recordBillingEvent({
          userId,
          kind: "replaced_subscription",
          stripeObjectId: tracked.id,
          detail: `replaced by ${sub.id}`,
        });
      }
      // Months the old subscription paid for (up to its end) are granted
      // before its allowance is cleared; the new one starts from nothing.
      await accrueProAllowance(userId, {
        ...row,
        allowanceStopAt: earliest(row.allowanceStopAt, trackedEnd ?? new Date()),
      });
      const adopted = await prisma.subscription.updateMany({
        where: { userId, stripeSubscriptionId: row.stripeSubscriptionId },
        data: { ...fields, stripeCustomerId: customer, ...CLEARED_ALLOWANCE },
      });
      if (adopted.count > 0) return "ok";
      continue;
    }

    if (!row) {
      if (status !== "active") return "untracked";
      try {
        await prisma.subscription.create({
          data: { userId, ...fields, stripeCustomerId: customer },
        });
        return "ok";
      } catch (err) {
        if (isUniqueViolation(err)) continue;
        throw err;
      }
    }

    // A row with a customer but no subscription yet (checkout started).
    const adopted = await prisma.subscription.updateMany({
      where: { userId, stripeSubscriptionId: null },
      data: { ...fields, stripeCustomerId: customer, ...CLEARED_ALLOWANCE },
    });
    if (adopted.count > 0) return "ok";
  }
  throw new Error("Subscription row kept changing under concurrent updates");
}

async function retrieveSubscriptionOrNull(
  id: string,
): Promise<Stripe.Subscription | null> {
  try {
    return await stripe.subscriptions.retrieve(id);
  } catch (err) {
    if (isSubscriptionAlreadyGone(err)) return null;
    throw err;
  }
}

/** Retrieve a subscription by id and apply its live state. */
export async function syncSubscription(
  userId: string,
  subscriptionId: string,
): Promise<ApplyOutcome> {
  const fetchedAt = new Date();
  const live = await stripe.subscriptions.retrieve(subscriptionId);
  return applyLiveSubscription(userId, live, fetchedAt);
}

// ---- Pro invoice credits ----------------------------------------------------

type LegacyLine = { type?: string; proration?: boolean };

/**
 * A line that pays for a full subscription period: a subscription line that
 * is not a proration and costs more than zero after discounts. Excludes $0
 * invoices (100% coupons, trials) and plan-change proration adjustments.
 */
function isPaidPeriodLine(line: Stripe.InvoiceLineItem): boolean {
  const details = line.parent?.subscription_item_details ?? null;
  const legacy = line as unknown as LegacyLine; // pre-Basil webhook shape
  if (!details && legacy.type !== "subscription") return false;
  const proration = details ? details.proration : Boolean(legacy.proration);
  if (proration) return false;
  const discount = (line.discount_amounts ?? []).reduce(
    (sum, d) => sum + d.amount,
    0,
  );
  return line.amount - discount > 0;
}

/** The subscription period an invoice covers, or null when it covers none. */
export async function paidPeriodOfInvoice(
  inv: Stripe.Invoice,
): Promise<{ start: Date; end: Date } | null> {
  let line = inv.lines?.data?.find(isPaidPeriodLine);
  if (!line && (!inv.lines || inv.lines.has_more)) {
    const all = await stripe.invoices.listLineItems(inv.id, { limit: 100 });
    line = all.data.find(isPaidPeriodLine);
  }
  if (!line) return null;
  return {
    start: new Date(line.period.start * 1000),
    end: new Date(line.period.end * 1000),
  };
}

/**
 * Money the invoice brought in: its total after discounts and after the
 * proration credits on the same invoice (a plan switch paid by unused time
 * is worth nothing new). Settled from the card or from the customer's
 * credit balance, which was money received before.
 */
function invoiceValueCents(inv: Stripe.Invoice): number {
  if (typeof inv.total === "number") return inv.total;
  return typeof inv.amount_paid === "number" ? inv.amount_paid : 0;
}

/** The card payments of an invoice: payment intent and amount. */
async function invoicePaymentIntents(
  invoiceId: string,
): Promise<{ pi: string; amount: number }[]> {
  const payments = await stripe.invoicePayments.list({ invoice: invoiceId, limit: 10 });
  return payments.data
    .filter((p) => p.status === "paid")
    .map((p) => ({ pi: stripeId(p.payment?.payment_intent ?? null), amount: p.amount_paid ?? 0 }))
    .filter((p): p is { pi: string; amount: number } => p.pi !== null);
}

const IN_OUR_FAVOUR = new Set(["won", "warning_closed", "prevented"]);

/** Did a dispute close without the money leaving us? (BillingEvent detail "status …".) */
export function disputeClosedInOurFavour(detail: string | null | undefined): boolean {
  const status = /status (\w+)/.exec(detail ?? "")?.[1];
  return status !== undefined && IN_OUR_FAVOUR.has(status);
}

/** Has any of these payments been refunded in full, or is it disputed? */
async function paymentsReversed(payments: { pi: string; amount: number }[]): Promise<boolean> {
  for (const { pi, amount } of payments) {
    const events = await prisma.billingEvent.findMany({
      where: { paymentIntentId: pi, kind: { in: ["refund", "dispute", "dispute_closed"] } },
    });
    const refunded = Math.max(0, ...events.filter((e) => e.kind === "refund").map((e) => e.amountCents ?? 0));
    if (amount > 0 && refunded >= amount) return true;
    const closedForUs = new Set(
      events.filter((e) => e.kind === "dispute_closed" && disputeClosedInOurFavour(e.detail)).map((e) => e.stripeObjectId),
    );
    if (events.some((e) => e.kind === "dispute" && !closedForUs.has(e.stripeObjectId))) return true;
  }
  return false;
}

/**
 * Apply a paid subscription invoice to the Pro allowance:
 *  - grant the allowance of the calendar month its period starts in, once
 *    per user-month (so plan switches and proration invoices never grant a
 *    month twice), and only for money received and not refunded or disputed;
 *  - before the allowance period moves on, grant every month of the old one
 *    that has come due, so an annual subscriber who never opened the app
 *    loses nothing at renewal;
 *  - record the new period for the subscription the row tracks (a yearly one
 *    then accrues one monthly allowance per anniversary, at most eleven).
 * Idempotent. Returns whether credits were granted for this invoice.
 */
export async function grantProInvoice(
  userId: string,
  inv: Stripe.Invoice,
  subscriptionId: string,
): Promise<boolean> {
  // An invoice of a subscription we cancel and refund never grants.
  if (await subscriptionMustNotGrant(subscriptionId)) return false;
  const period = await paidPeriodOfInvoice(inv);
  if (!period) return false;

  const payments = await invoicePaymentIntents(inv.id);
  const reversed = await paymentsReversed(payments);
  const row = await prisma.subscription.findUnique({ where: { userId } });
  // The period moves forward only (a late invoice for an older period never
  // rewinds it), and only for the subscription the row tracks.
  const advances =
    row !== null &&
    row.stripeSubscriptionId === subscriptionId &&
    (row.allowancePeriodStart === null ||
      row.allowancePeriodStart.getTime() < period.start.getTime());

  if (advances && row) await accrueProAllowance(userId, row as AllowanceRow);

  // Granted under the per-invoice key used before coverage months existed.
  const legacy = await prisma.creditLedger.findUnique({
    where: { idempotencyKey: `pro_grant:${inv.id}` },
    select: { id: true },
  });
  const granted =
    !reversed && !legacy && invoiceValueCents(inv) > 0
      ? await grantProMonth(userId, period.start)
      : false;

  if (advances && row) {
    const ended = ENDED_STATUSES.has(row.status);
    await prisma.subscription.updateMany({
      where: {
        userId,
        stripeSubscriptionId: subscriptionId,
        OR: [{ allowancePeriodStart: null }, { allowancePeriodStart: { lt: period.start } }],
      },
      data: {
        allowanceSubscriptionId: subscriptionId,
        allowancePaymentIntentId: payments[0]?.pi ?? null,
        allowancePeriodStart: period.start,
        allowancePeriodEnd: period.end,
        allowanceYearly: isYearlyPeriod(period.start, period.end),
        // A refunded or disputed payment buys no further months.
        allowanceStopAt: reversed ? period.start : ended ? row.allowanceStopAt : null,
        // A dispute on an earlier period no longer holds Pro back.
        disputeId: null,
        disputedAt: null,
      },
    });
  }
  return granted;
}

// ---- Credit packs -----------------------------------------------------------

export type PackOutcome =
  | "granted"
  | "not_pack"
  | "unpaid"
  | "reversed"
  | "deleted_account";

export type PackInfo = {
  userId: string;
  credits: number;
  amountCents: number;
  sessionId: string;
};

const reversalKey = (pi: string, suffix: string) => `pack_reversal:${pi}:${suffix}`;

/**
 * Bring a credit pack's clawbacks in line with every refund and dispute
 * recorded for its payment, replaying them in the order they arrived. Must
 * run inside withUserCreditLock. Policy:
 *  - the share clawed back follows the TOTAL money returned (refunds plus
 *    disputes not closed in our favour), so a 50% refund and a lost dispute
 *    on the other 50% take the whole pack;
 *  - each event takes only its own increment, limited to the balance: credits
 *    already spent are forgiven, never taken out of a later purchase;
 *  - a dispute closed in our favour (won, inquiry closed) gives back exactly
 *    what that dispute took;
 *  - events that arrived before the pack was granted apply at the grant, so
 *    the pack lands at its net share.
 * Idempotent (every movement has its own ledger key). Returns the credits of
 * the pack currently reversed.
 */
export async function reconcilePackTx(
  tx: CreditsDb,
  pack: PackInfo,
  pi: string,
): Promise<number> {
  const granted = await tx.creditLedger.findUnique({
    where: { idempotencyKey: `credit_purchase:${pack.sessionId}` },
    select: { id: true },
  });
  if (!granted) return 0;
  const events = await tx.billingEvent.findMany({
    where: { paymentIntentId: pi, kind: { in: ["refund", "dispute", "dispute_closed"] } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  let refunded = 0;
  const disputed = new Map<string, number>();
  const target = () => {
    const returned = refunded + [...disputed.values()].reduce((a, b) => a + b, 0);
    if (pack.amountCents <= 0) return 0;
    return Math.floor(pack.credits * Math.min(1, returned / pack.amountCents));
  };
  for (const ev of events) {
    const before = target();
    if (ev.kind === "refund") {
      refunded = Math.max(refunded, ev.amountCents ?? 0);
      const take = target() - before;
      if (take > 0) {
        await debitCreditsTx(tx, pack.userId, take, "credit_reversal", reversalKey(pi, `refund:${ev.amountCents}`));
      }
    } else if (ev.kind === "dispute") {
      disputed.set(ev.stripeObjectId, ev.amountCents ?? 0);
      const take = target() - before;
      if (take > 0) {
        await debitCreditsTx(tx, pack.userId, take, "credit_reversal", reversalKey(pi, `dispute:${ev.stripeObjectId}`));
      }
    } else if (disputeClosedInOurFavour(ev.detail) && disputed.delete(ev.stripeObjectId)) {
      const taken = await tx.creditLedger.findUnique({
        where: { idempotencyKey: reversalKey(pi, `dispute:${ev.stripeObjectId}`) },
        select: { delta: true },
      });
      const restore = -(taken?.delta ?? 0);
      if (restore > 0) {
        await grantCreditsTx(tx, pack.userId, restore, "credit_reversal_restored", reversalKey(pi, `restore:${ev.stripeObjectId}`));
      }
    }
  }
  return target();
}

/** The ledger key of the credit movement a pack event causes. */
function packEventKey(pi: string, ev: { kind: string; stripeObjectId: string; amountCents?: number | null }) {
  if (ev.kind === "refund") return reversalKey(pi, `refund:${ev.amountCents}`);
  if (ev.kind === "dispute") return reversalKey(pi, `dispute:${ev.stripeObjectId}`);
  return reversalKey(pi, `restore:${ev.stripeObjectId}`);
}

/**
 * Record refund or dispute events of a credit pack and apply them (see
 * reconcilePackTx), atomically under the user's lock. Each event is recorded
 * once (retries are no-ops) with the credits it moved, for the audit trail.
 */
export async function recordPackEvents(
  pack: PackInfo,
  pi: string,
  events: Omit<BillingEventInput, "userId" | "paymentIntentId">[],
): Promise<void> {
  await withUserCreditLock(pack.userId, async (tx) => {
    const created: { id: string; key: string }[] = [];
    for (const ev of events) {
      const exists = await tx.billingEvent.findUnique({
        where: { kind_stripeObjectId: { kind: ev.kind, stripeObjectId: ev.stripeObjectId } },
        select: { id: true },
      });
      if (exists) continue;
      const row = await tx.billingEvent.create({
        data: { ...ev, userId: pack.userId, paymentIntentId: pi },
      });
      created.push({ id: row.id, key: packEventKey(pi, ev) });
    }
    await reconcilePackTx(tx, pack, pi);
    for (const { id, key } of created) {
      const moved = await tx.creditLedger.findUnique({
        where: { idempotencyKey: key },
        select: { delta: true },
      });
      if (moved?.delta) {
        await tx.billingEvent.update({ where: { id }, data: { credits: moved.delta } });
      }
    }
  });
}

/**
 * Grant a purchased credit pack once the money has actually arrived
 * (payment_status "paid": delayed methods such as bank debits complete later
 * via checkout.session.async_payment_succeeded). Idempotent per session.
 * Refunds or disputes that arrived first are applied at once (the pack lands
 * at its net share). A pack paid for a deleted account is refunded.
 */
export async function grantCreditPack(
  userId: string,
  session: Stripe.Checkout.Session,
): Promise<PackOutcome> {
  if (session.mode !== "payment" || session.metadata?.kind !== "credits") {
    return "not_pack";
  }
  if (session.payment_status !== "paid") return "unpaid";
  const pi = stripeId(session.payment_intent);
  const pack: PackInfo = {
    userId,
    credits: Number(session.metadata.credits) || CREDIT_PACK_SIZE,
    amountCents: session.amount_total || CREDIT_PACK_PRICE_USD * 100,
    sessionId: session.id,
  };

  const outcome = await withUserCreditLock(userId, async (tx): Promise<PackOutcome> => {
    const grant = await grantCreditsTx(tx, userId, pack.credits, "credit_purchase", `credit_purchase:${session.id}`);
    if (grant === "deleted_account") return "deleted_account";
    const reversed = pi ? await reconcilePackTx(tx, pack, pi) : 0;
    return reversed >= pack.credits ? "reversed" : "granted";
  });

  if (outcome === "deleted_account" && pi) {
    // Paid after deleting the account (a checkout left open in another tab,
    // or during the deletion itself): nobody to credit, so give it back.
    const r = await refundRemaining(pi, pack.amountCents, "requested_by_customer");
    await recordBillingEvent({
      userId,
      kind: "deleted_account_payment",
      stripeObjectId: session.id,
      paymentIntentId: pi,
      amountCents: r.refunded,
      detail: r.error ? `refund failed: ${r.error}` : null,
    });
  }
  return outcome;
}

// ---- Checkout ---------------------------------------------------------------

/**
 * The user's Stripe customer id, creating (and storing) one on first use so
 * every checkout — subscription or credit pack — lands on the same customer.
 * The idempotency key makes a double submit create one customer, not two.
 */
export async function ensureStripeCustomer(
  userId: string,
  email: string | null | undefined,
): Promise<string> {
  const row = await prisma.subscription.findUnique({ where: { userId } });
  if (row?.stripeCustomerId) return row.stripeCustomerId;

  const params: Stripe.CustomerCreateParams = {
    metadata: { userId },
    ...(email ? { email } : {}),
  };
  const opts = { idempotencyKey: `studyos-customer-${userId}` };
  let customer: Stripe.Customer;
  try {
    customer = await stripe.customers.create(params, opts);
  } catch (err) {
    // A concurrent request holding the same key: wait for it, then replay.
    if ((err as { type?: string })?.type !== "StripeIdempotencyError") throw err;
    await new Promise((r) => setTimeout(r, 750));
    customer = await stripe.customers.create(params, opts);
  }

  // Fill the slot only if still empty, then read back the winner.
  await prisma.subscription.upsert({
    where: { userId },
    create: { userId, stripeCustomerId: customer.id },
    update: {},
  });
  await prisma.subscription.updateMany({
    where: { userId, stripeCustomerId: null },
    data: { stripeCustomerId: customer.id },
  });
  const stored = await prisma.subscription.findUnique({ where: { userId } });
  return stored?.stripeCustomerId ?? customer.id;
}

export type ProCheckoutResult =
  | { url: string }
  | { blocked: "already_subscribed" };

/**
 * Start a Pro subscription checkout, unless the user already has a live
 * subscription (checked in our database AND on Stripe, since the webhook may
 * not have landed yet). Older open subscription checkouts for the same
 * customer are expired so two tabs cannot both complete.
 */
export async function createProCheckout(opts: {
  userId: string;
  email: string | null | undefined;
  priceId: string;
  origin: string;
}): Promise<ProCheckoutResult> {
  const { userId, priceId, origin } = opts;
  const row = await prisma.subscription.findUnique({ where: { userId } });
  if (row?.status === "active") {
    // Trust but verify: a missed cancellation webhook must not lock a
    // former subscriber out of resubscribing.
    const fetchedAt = new Date();
    const tracked = row.stripeSubscriptionId
      ? await retrieveSubscriptionOrNull(row.stripeSubscriptionId)
      : null;
    if (!tracked || ACTIVE_STATUSES.has(tracked.status)) {
      return { blocked: "already_subscribed" };
    }
    await applyLiveSubscription(userId, tracked, fetchedAt);
  }

  const customer = await ensureStripeCustomer(userId, opts.email);
  const listedAt = new Date();
  const existing = await stripe.subscriptions.list({
    customer,
    status: "all",
    limit: 100,
  });
  const live = existing.data.find((s) => !ENDED_STATUSES.has(s.status));
  if (live) {
    // Heal a missed webhook so the app shows Pro immediately.
    if (ACTIVE_STATUSES.has(live.status)) {
      await applyLiveSubscription(userId, live, listedAt).catch(() => undefined);
    }
    return { blocked: "already_subscribed" };
  }

  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer,
    line_items: [{ price: priceId, quantity: 1 }],
    client_reference_id: userId,
    subscription_data: { metadata: { userId } },
    metadata: { userId, kind: "pro" },
    allow_promotion_codes: true,
    success_url: `${origin}/app?upgraded=1&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${origin}/pricing`,
  });

  await expireOlderSubscriptionCheckouts(customer, session).catch(
    () => undefined,
  );

  if (!session.url) throw new Error("Stripe returned no checkout URL");
  return { url: session.url };
}

/**
 * Expire every open subscription checkout for this customer that is older
 * than `mine` (ties broken by id), so exactly one stays payable even when two
 * tabs start checkout at once.
 */
async function expireOlderSubscriptionCheckouts(
  customer: string,
  mine: Stripe.Checkout.Session,
): Promise<void> {
  const open = await stripe.checkout.sessions.list({
    customer,
    status: "open",
    limit: 100,
  });
  for (const s of open.data) {
    if (s.id === mine.id || s.mode !== "subscription") continue;
    const older =
      s.created < mine.created || (s.created === mine.created && s.id < mine.id);
    if (!older) continue;
    await stripe.checkout.sessions.expire(s.id).catch(() => undefined);
  }
}

/** Start a one-time credit pack checkout on the user's Stripe customer. */
export async function createCreditPackCheckout(opts: {
  userId: string;
  email: string | null | undefined;
  origin: string;
}): Promise<{ url: string }> {
  const { userId, origin } = opts;
  const customer = await ensureStripeCustomer(userId, opts.email);
  const metadata = {
    userId,
    kind: "credits",
    credits: String(CREDIT_PACK_SIZE),
  };
  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    customer,
    line_items: [
      {
        price_data: {
          currency: "usd",
          product_data: {
            name: `${CREDIT_PACK_SIZE.toLocaleString("en-US")} StudyOS credits`,
          },
          unit_amount: CREDIT_PACK_PRICE_USD * 100,
        },
        quantity: 1,
      },
    ],
    client_reference_id: userId,
    metadata,
    // Also on the PaymentIntent, so refunds/disputes are traceable to the pack.
    payment_intent_data: { metadata },
    success_url: `${origin}/app?credits=${CREDIT_PACK_SIZE}&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${origin}/app/credits`,
  });
  if (!session.url) throw new Error("Stripe returned no checkout URL");
  return { url: session.url };
}

// ---- Checkout success redirect ----------------------------------------------

/**
 * After Stripe Checkout returns, verify the session and apply its effect:
 *   - a subscription → apply the subscription's LIVE status (so replaying an
 *     old success URL after cancelling cannot restore Pro);
 *   - a credit pack → grant it only if paid.
 * Best-effort and idempotent (the webhook reconciles if this misses).
 */
export async function reconcileCheckoutSession(sessionId: string): Promise<void> {
  const { userId } = await auth();
  if (!userId) return;
  try {
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    if (session.client_reference_id !== userId) return;
    if (session.mode === "subscription") {
      const subId = stripeId(session.subscription);
      if (subId) await syncSubscription(userId, subId);
    } else if (session.mode === "payment") {
      await grantCreditPack(userId, session);
    }
  } catch {
    // The webhook will reconcile if this best-effort path fails.
  }
}

// ---- Account deletion -------------------------------------------------------

/**
 * Tombstone an account that is being deleted. Call this FIRST, before
 * cancelling billing or erasing anything: from the moment it commits, no
 * credit account can be created and no credits granted for this user
 * (credits.ts checks it under the same per-user lock), late webhooks recreate
 * nothing, and any subscription or pack paid afterwards is canceled and
 * refunded. It also records the durable job that cancels the account's
 * billing, with the Stripe ids captured now, before erasure removes them.
 */
export async function markAccountDeleted(userId: string): Promise<void> {
  await withUserCreditLock(userId, async (tx) => {
    const row = await tx.subscription.findUnique({ where: { userId } });
    await tx.deletedAccount.upsert({ where: { userId }, create: { userId }, update: {} });
    const intent = await tx.billingIntent.findUnique({
      where: { kind_key: { kind: CANCEL_ACCOUNT_BILLING, key: userId } },
    });
    if (!intent) {
      await tx.billingIntent.create({
        data: {
          kind: CANCEL_ACCOUNT_BILLING,
          key: userId,
          userId,
          stripeCustomerId: row?.stripeCustomerId ?? null,
          stripeSubscriptionId: row?.stripeSubscriptionId ?? null,
        },
      });
    } else if (row && (!intent.stripeCustomerId || !intent.stripeSubscriptionId)) {
      await tx.billingIntent.update({
        where: { id: intent.id },
        data: {
          stripeCustomerId: intent.stripeCustomerId ?? row.stripeCustomerId,
          stripeSubscriptionId: intent.stripeSubscriptionId ?? row.stripeSubscriptionId,
        },
      });
    }
  });
}

/**
 * Undo markAccountDeleted for a deletion abandoned before anything was
 * erased (the in-app delete could not reach Stripe and asks to retry).
 */
export async function unmarkAccountDeleted(userId: string): Promise<void> {
  await withUserCreditLock(userId, async (tx) => {
    await tx.billingIntent.deleteMany({
      where: { kind: CANCEL_ACCOUNT_BILLING, key: userId, state: "pending" },
    });
    await tx.deletedAccount.deleteMany({ where: { userId } });
  });
}

/**
 * Stop all billing of a tombstoned account now. Returns false when Stripe
 * could not be reached or refused: the job stays pending and the maintenance
 * job retries it until it succeeds (any renewal charged meanwhile is refunded
 * by the webhook, since the account is tombstoned).
 */
export async function stopBillingForDeletedAccount(userId: string): Promise<boolean> {
  const intent = await findIntent(CANCEL_ACCOUNT_BILLING, userId);
  if (!intent) throw new Error("stopBillingForDeletedAccount: markAccountDeleted first");
  if (intent.state === "done") return true;
  try {
    await completeCancelAccountIntent(intent);
    return true;
  } catch (err) {
    reportError(err, { source: "billing", route: "stopBillingForDeletedAccount", userId });
    return false;
  }
}

async function completeCancelAccountIntent(intent: BillingIntent): Promise<void> {
  await runIntent(intent, () =>
    cancelAllBillingForUser(intent.key, {
      customerId: intent.stripeCustomerId,
      subscriptionId: intent.stripeSubscriptionId,
    }),
  );
}

/**
 * Stop all billing for a user: cancel every subscription that could still
 * bill — the tracked one, every one on their Stripe customer, and any other
 * carrying their userId metadata (legacy duplicates created on separate
 * customers) — and expire open checkouts. `known` adds ids captured before
 * the user's rows were erased. Throws when a cancellation fails for a reason
 * other than "already gone", so the caller can retry.
 */
export async function cancelAllBillingForUser(
  userId: string,
  known: { customerId?: string | null; subscriptionId?: string | null } = {},
): Promise<void> {
  const row = await prisma.subscription.findUnique({ where: { userId } });
  const customers = new Set(
    [row?.stripeCustomerId, known.customerId].filter((c): c is string => Boolean(c)),
  );
  const ids = new Set(
    [row?.stripeSubscriptionId, known.subscriptionId].filter((s): s is string => Boolean(s)),
  );

  for (const customer of customers) {
    const list = await stripe.subscriptions.list({ customer, status: "all", limit: 100 });
    for (const s of list.data) if (!ENDED_STATUSES.has(s.status)) ids.add(s.id);
  }

  // Clerk ids are [A-Za-z0-9_]; anything else is never interpolated.
  if (/^[A-Za-z0-9_]+$/.test(userId)) {
    try {
      const found = await stripe.subscriptions.search({
        query: `metadata['userId']:'${userId}'`,
        limit: 100,
      });
      for (const s of found.data) {
        if (!ENDED_STATUSES.has(s.status)) ids.add(s.id);
      }
    } catch {
      // Search is unavailable in some regions and lags ~1 minute; the
      // customer listing above already covers every checkout made since
      // customers were reused.
    }
  }

  for (const id of ids) {
    try {
      await stripe.subscriptions.cancel(id);
    } catch (err) {
      if (!isSubscriptionAlreadyGone(err)) throw err;
    }
  }

  for (const customer of customers) {
    try {
      const open = await stripe.checkout.sessions.list({ customer, status: "open", limit: 100 });
      await Promise.allSettled(open.data.map((s) => stripe.checkout.sessions.expire(s.id)));
    } catch {
      // Best effort: a checkout completed after deletion is refunded by the
      // webhook (the account is tombstoned).
    }
  }
}

// ---- Maintenance --------------------------------------------------------------

export interface BillingMaintenanceResult {
  /** Pending billing jobs completed this run (refunds, deleted-account cancels). */
  jobsCompleted: number;
  /** Pending billing jobs that failed again (still pending). */
  jobsFailed: number;
  /** Credit holds of crashed requests given back. */
  holdsReleased: number;
  /** "Active" rows past their paid period re-read from Stripe. */
  subscriptionsResynced: number;
}

/**
 * The daily billing sweep (run by the maintenance job): finish every pending
 * billing job (a refund or a deleted account's cancellation that Stripe
 * failed part-way and stopped retrying), give back abandoned credit holds,
 * and re-read rows still "active" a day past their paid period (a missed
 * renewal or cancellation webhook). Failures are reported and retried on the
 * next run.
 */
export async function runBillingMaintenance(
  now = new Date(),
  limit = 50,
): Promise<BillingMaintenanceResult> {
  const result: BillingMaintenanceResult = {
    jobsCompleted: 0,
    jobsFailed: 0,
    holdsReleased: 0,
    subscriptionsResynced: 0,
  };
  const pending = await prisma.billingIntent.findMany({
    where: { state: "pending" },
    orderBy: { updatedAt: "asc" },
    take: limit,
  });
  for (const intent of pending) {
    try {
      if (intent.kind === REFUND_SUBSCRIPTION) await completeRefundIntent(intent);
      else if (intent.kind === CANCEL_ACCOUNT_BILLING) await completeCancelAccountIntent(intent);
      else continue;
      result.jobsCompleted++;
    } catch (err) {
      result.jobsFailed++;
      reportError(err, { source: "billing", route: "runBillingMaintenance", userId: intent.userId });
    }
  }

  result.holdsReleased = await releaseExpiredHolds({ now });

  const lapsed = await prisma.subscription.findMany({
    where: {
      status: "active",
      stripeSubscriptionId: { not: null },
      currentPeriodEnd: { lt: new Date(now.getTime() - DAY_MS) },
    },
    select: { userId: true, stripeSubscriptionId: true },
    take: limit,
  });
  for (const row of lapsed) {
    try {
      await syncSubscription(row.userId, row.stripeSubscriptionId!);
      result.subscriptionsResynced++;
    } catch (err) {
      reportError(err, { source: "billing", route: "runBillingMaintenance", userId: row.userId });
    }
  }
  return result;
}
