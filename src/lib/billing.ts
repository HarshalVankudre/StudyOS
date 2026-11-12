/**
 * Billing rules (server-only). Every money decision lives here so the
 * checkout actions, the checkout success redirect and the Stripe webhook all
 * apply the same rules:
 *
 *  - one Stripe customer per user, reused for every checkout;
 *  - at most one live Pro subscription per user (checkout is blocked while one
 *    exists; a duplicate that slips through anyway is canceled and every paid
 *    invoice of it refunded, through a BillingIntent written before the first
 *    Stripe call, so a failure part-way is finished by the next event, retry
 *    or maintenance run);
 *  - subscription status always comes from the LIVE Stripe subscription, never
 *    from a replayed or out-of-order event payload, and a write carrying an
 *    older fetch never wins. A subscription this code saw ended on a live read
 *    (Subscription.endedSubscriptionId) never becomes live again; a status
 *    written by the code before this one is never trusted that way (it stored
 *    "canceled" for past_due too), and those rows are re-read from Stripe;
 *  - each paid invoice grants the calendar month it pays for, once per
 *    subscription (plan switches never grant a month twice; a resubscription
 *    after a cancellation is a new paid month, unless the earlier one was
 *    refunded in full). Refunds and disputes never take a granted month back
 *    (the terms: "credits already added stay"), so a grant does not depend on
 *    the order in which the invoice, refund and dispute events arrive;
 *  - Pro and a yearly allowance pause while the payment of the current period
 *    has an open dispute, resume when it is won, and stop for good when it is
 *    lost or refunded in full: recomputed from the recorded facts after every
 *    event (refreshAllowanceState), never written one event at a time;
 *  - a lost dispute cancels the user's subscription, whichever payment it was;
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
  addMonthsUtc,
  type AllowanceRow,
  CREDIT_PACK_PRICE_USD,
  CREDIT_PACK_SIZE,
  type CreditsDb,
  debitCreditsTx,
  grantCreditsTx,
  isYearlyPeriod,
  monthKey,
  PRO_MONTHLY_CREDITS,
  proMonthKey,
  proMonthPrefix,
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

const sameInstant = (a: Date | null, b: Date | null) =>
  a === null || b === null ? a === b : a.getTime() === b.getTime();

/** Stripe says the object does not exist (the only error that proves "gone"). */
export function isMissingResource(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: string }).code === "resource_missing";
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

async function retrieveSubscriptionOrNull(
  id: string,
): Promise<Stripe.Subscription | null> {
  try {
    return await stripe.subscriptions.retrieve(id);
  } catch (err) {
    if (isMissingResource(err)) return null;
    throw err;
  }
}

/**
 * Cancel a subscription so it can never bill again. It counts as stopped
 * only when the cancel succeeds, when Stripe says the subscription does not
 * exist, or when Stripe refused the cancel and a fresh read shows it ended.
 * Anything else throws, so the caller (a webhook, a recorded job) retries.
 */
export async function cancelSubscription(id: string): Promise<void> {
  try {
    await stripe.subscriptions.cancel(id);
  } catch (err) {
    if (isMissingResource(err)) return;
    const live = await retrieveSubscriptionOrNull(id);
    if (!live || ENDED_STATUSES.has(live.status)) return;
    throw err;
  }
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
  /** When it happened on Stripe (a refund's or dispute's own timestamp). */
  occurredAt?: Date | null;
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

/**
 * The StudyOS user behind a Stripe customer: the row that stores it, else
 * the userId every customer this app creates carries (ensureStripeCustomer).
 */
export async function userForCustomer(customerId: string | null): Promise<string | null> {
  if (!customerId) return null;
  const row = await prisma.subscription.findFirst({
    where: { stripeCustomerId: customerId },
    select: { userId: true },
  });
  if (row) return row.userId;
  try {
    const customer = await stripe.customers.retrieve(customerId);
    if ("deleted" in customer && customer.deleted) return null;
    return (customer as Stripe.Customer).metadata?.userId || null;
  } catch (err) {
    if (isMissingResource(err)) return null;
    throw err;
  }
}

// ---- Durable billing jobs (BillingIntent) ------------------------------------

const REFUND_SUBSCRIPTION = "refund_subscription";
const CANCEL_ACCOUNT_BILLING = "cancel_account_billing";
/** Stop a user's billing after they won a chargeback against us (key: dispute id). */
const CANCEL_LOST_DISPUTE = "cancel_lost_dispute";
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
  stripeCustomerId?: string | null;
  stripeSubscriptionId?: string | null;
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

/** Refund statuses that mean the money did not go back. */
const REFUND_FAILED_STATUSES = new Set<string>(["failed", "canceled"]);

/**
 * Refund what is left of a payment, idempotently: money already refunded or
 * on its way back (by an earlier attempt or by hand) is never refunded twice.
 * A refund Stripe refuses as a client error will not succeed on a retry: it
 * is reported (reportError) for the owner to settle by hand and returned as
 * `error`. Transient errors throw so the caller retries.
 */
async function refundRemaining(
  paymentIntentId: string,
  paidCents: number | null,
  reason: "duplicate" | "requested_by_customer",
  userId: string | null,
): Promise<{ refunded: number; error?: string }> {
  const existing = await stripe.refunds.list({ payment_intent: paymentIntentId, limit: 100 });
  const already = existing.data
    .filter((r) => !REFUND_FAILED_STATUSES.has(r.status ?? ""))
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
      reportError(err, { source: "billing", route: "refundRemaining (refund refused, refund by hand)", userId });
      return { refunded: already, error: e.code ?? "invalid_request" };
    }
    throw err;
  }
}

/**
 * Cancel a subscription that must not exist (a duplicate, or one billing a
 * deleted account) and refund it: every paid invoice of a duplicate, every
 * payment taken after the deletion for a deleted account. The intent is
 * recorded BEFORE the cancel, so from that moment its invoices never grant
 * credits, and a failure at any later step is completed by the next event
 * for the subscription (whatever its live status), a webhook retry, or the
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

/** When Stripe took an invoice's payment (unix seconds), if it says. */
function paidAtSec(inv: Stripe.Invoice): number | null {
  const paidAt = inv.status_transitions?.paid_at;
  if (typeof paidAt === "number") return paidAt;
  return typeof inv.created === "number" ? inv.created : null;
}

async function completeRefundIntent(intent: BillingIntent): Promise<void> {
  await runIntent(intent, async () => {
    const subscriptionId = intent.key;
    await cancelSubscription(subscriptionId);
    const duplicate = intent.reason === "duplicate_subscription";
    const reason = duplicate ? "duplicate" : "requested_by_customer";
    // Which payments go back: for a mistaken second subscription, every paid
    // invoice of it (the terms promise it is refunded); for a deleted
    // account, every payment taken from the second the account was deleted
    // (months paid before it were used).
    let refundFromSec: number | null = null;
    if (!duplicate && intent.userId) {
      const tombstone = await prisma.deletedAccount.findUnique({ where: { userId: intent.userId } });
      refundFromSec = Math.floor((tombstone?.deletedAt ?? intent.createdAt).getTime() / 1000);
    }
    const invoices = await stripe.invoices.list({ subscription: subscriptionId, status: "paid", limit: 100 });
    let refunded = 0;
    const notes: string[] = [];
    for (const inv of invoices.data) {
      const paidAt = paidAtSec(inv);
      if (refundFromSec !== null && paidAt !== null && paidAt < refundFromSec) continue;
      const payments = await stripe.invoicePayments.list({ invoice: inv.id, limit: 10 });
      for (const p of payments.data) {
        if (p.status !== "paid") continue;
        const pi = stripeId(p.payment?.payment_intent ?? null);
        if (!pi) {
          notes.push(`manual refund needed: ${p.id}`);
          reportError(new Error(`Invoice payment ${p.id} has no payment intent: refund it by hand`), {
            source: "billing",
            route: "completeRefundIntent",
            userId: intent.userId,
          });
          continue;
        }
        const r = await refundRemaining(pi, p.amount_paid ?? null, reason, intent.userId);
        refunded += r.refunded;
        if (r.error) notes.push(`refund ${pi} refused: ${r.error}`);
      }
    }
    await recordBillingEvent({
      userId: intent.userId,
      kind: intent.reason ?? "duplicate_subscription",
      stripeObjectId: subscriptionId,
      amountCents: refunded,
      detail: [`${invoices.data.length} paid invoice(s)`, ...notes].join("; "),
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

/**
 * A chargeback was lost (the customer took the money back): stop billing
 * them, whichever of their payments it was on (a renewal since then
 * changes nothing). Durable: recorded first, retried by later events and
 * the maintenance job until Stripe confirms.
 */
export async function stopBillingAfterLostDispute(userId: string, disputeId: string): Promise<void> {
  const row = await prisma.subscription.findUnique({ where: { userId } });
  const intent = await recordIntent({
    kind: CANCEL_LOST_DISPUTE,
    key: disputeId,
    userId,
    stripeCustomerId: row?.stripeCustomerId ?? null,
    stripeSubscriptionId: row?.stripeSubscriptionId ?? null,
  });
  if (intent.state !== "done") await completeLostDisputeIntent(intent);
}

async function completeLostDisputeIntent(intent: BillingIntent): Promise<void> {
  await runIntent(intent, async () => {
    if (!intent.userId) return;
    await cancelAllBillingForUser(intent.userId, {
      customerId: intent.stripeCustomerId,
      subscriptionId: intent.stripeSubscriptionId,
    });
    // Pro ends now, not when the deletion webhook arrives.
    const row = await prisma.subscription.findUnique({ where: { userId: intent.userId } });
    if (row?.stripeSubscriptionId) await syncSubscription(intent.userId, row.stripeSubscriptionId);
    await recordBillingEvent({
      userId: intent.userId,
      kind: "lost_dispute_cancel",
      stripeObjectId: intent.key,
      detail: "subscriptions canceled after a lost dispute",
    });
  });
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

/** Allowance (and ended-subscription) fields reset when the row moves to another subscription. */
const CLEARED_ALLOWANCE = {
  allowanceSubscriptionId: null,
  allowancePaymentIntentId: null,
  allowancePaymentCents: null,
  allowancePeriodStart: null,
  allowancePeriodEnd: null,
  allowanceYearly: false,
  allowanceStopAt: null,
  disputeId: null,
  disputedAt: null,
  endedSubscriptionId: null,
  endedAt: null,
};

/** A read fetched at `fetchedAt` is the newest one written (or none was). */
const newestRead = (fetchedAt: Date) => ({
  OR: [{ stripeSyncedAt: null }, { stripeSyncedAt: { lte: fetchedAt } }],
});
/** The row does not record `subscriptionId` as ended. */
const notRecordedEnded = (subscriptionId: string) => ({
  OR: [{ endedSubscriptionId: null }, { endedSubscriptionId: { not: subscriptionId } }],
});

/**
 * When a live read of `subscriptionId` may be written over the row:
 *  - a live (not ended) status: when it is the newest read AND this code has
 *    not seen the subscription ended (Stripe never revives one, so a live
 *    status for it is stale whatever the clocks say). The stored status is
 *    not consulted: older code wrote "canceled" for past_due subscriptions;
 *  - an ended status: when it is the newest read, or when the row does not
 *    yet record that this subscription ended (an end is never stale).
 */
function writeAllowed(subscriptionId: string, ended: boolean, fetchedAt: Date) {
  return ended
    ? { OR: [...newestRead(fetchedAt).OR, ...notRecordedEnded(subscriptionId).OR] }
    : { AND: [newestRead(fetchedAt), notRecordedEnded(subscriptionId)] };
}

/**
 * Bring the user's row in line with a LIVE Stripe subscription (retrieved
 * from Stripe, not taken from an event payload, so replays and out-of-order
 * delivery cannot resurrect or kill Pro). `fetchedAt` is when that live state
 * was read (take it just before the Stripe call): the write is conditional
 * (see writeAllowed). Safe to call repeatedly and concurrently.
 */
export async function applyLiveSubscription(
  userId: string,
  sub: Stripe.Subscription,
  fetchedAt: Date = new Date(),
): Promise<ApplyOutcome> {
  const ended = ENDED_STATUSES.has(sub.status);

  // A subscription already judged one that must not exist: finish that job
  // (cancel + refund + audit), whatever its live status is by now. A job
  // marked done whose subscription Stripe still shows live did not really
  // stop it: it runs again (every step is idempotent).
  const intent = await findIntent(REFUND_SUBSCRIPTION, sub.id);
  if (intent) {
    if (intent.state === "done" && !ended) {
      await prisma.billingIntent.update({
        where: { id: intent.id },
        data: { state: "pending", completedAt: null },
      });
    }
    if (intent.state !== "done" || !ended) await completeRefundIntent(intent);
    return intent.reason === "duplicate_subscription" ? "duplicate" : "deleted_account";
  }

  if (await isDeletedAccount(userId)) {
    if (!ended) await cancelAndRefund(userId, sub.id, "deleted_account_subscription");
    return "deleted_account";
  }

  const status = planStatus(sub.status);
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
    const endFields = ended
      ? {
          endedSubscriptionId: sub.id,
          endedAt:
            endedAt(sub) ??
            (row?.endedSubscriptionId === sub.id ? row.endedAt : null) ??
            fetchedAt,
        }
      : {};

    if (row?.stripeSubscriptionId === sub.id) {
      // The subscription we track.
      const written = await prisma.subscription.updateMany({
        where: { userId, stripeSubscriptionId: sub.id, ...writeAllowed(sub.id, ended, fetchedAt) },
        data: { ...fields, ...endFields, stripeCustomerId: customer },
      });
      if (written.count === 0) return "stale";
      // An end caps the allowance accrual of that subscription.
      if (ended) await refreshAllowanceState(userId);
      return "ok";
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
        await cancelSubscription(tracked.id);
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

    // A row with a customer but no subscription yet (checkout started, or a
    // row the previous code wrote without one).
    const adopted = await prisma.subscription.updateMany({
      where: { userId, stripeSubscriptionId: null },
      data: { ...fields, stripeCustomerId: customer, ...CLEARED_ALLOWANCE, ...endFields },
    });
    if (adopted.count > 0) return "ok";
  }
  throw new Error("Subscription row kept changing under concurrent updates");
}

/**
 * The subscription the row tracks does not exist on Stripe (resource_missing):
 * it can never bill, so record it as ended.
 */
async function applyMissingSubscription(
  userId: string,
  subscriptionId: string,
  fetchedAt: Date,
): Promise<ApplyOutcome> {
  const row = await prisma.subscription.findUnique({ where: { userId } });
  if (row?.stripeSubscriptionId !== subscriptionId) return "stale";
  const written = await prisma.subscription.updateMany({
    where: { userId, stripeSubscriptionId: subscriptionId, ...writeAllowed(subscriptionId, true, fetchedAt) },
    data: {
      status: "canceled",
      stripeSyncedAt: fetchedAt,
      endedSubscriptionId: subscriptionId,
      endedAt: row.endedSubscriptionId === subscriptionId && row.endedAt ? row.endedAt : fetchedAt,
    },
  });
  if (written.count === 0) return "stale";
  await refreshAllowanceState(userId);
  return "ok";
}

/** Read a subscription from Stripe and apply its live state (missing = ended). */
export async function syncSubscription(
  userId: string,
  subscriptionId: string,
): Promise<ApplyOutcome> {
  const fetchedAt = new Date();
  const live = await retrieveSubscriptionOrNull(subscriptionId);
  return live
    ? applyLiveSubscription(userId, live, fetchedAt)
    : applyMissingSubscription(userId, subscriptionId, fetchedAt);
}

// ---- Refunds and disputes of a payment (the facts) -----------------------------

const IN_OUR_FAVOUR = new Set(["won", "warning_closed", "prevented"]);

/** Did a dispute close without the money leaving us? (BillingEvent detail "status …".) */
export function disputeClosedInOurFavour(detail: string | null | undefined): boolean {
  const status = /status (\w+)/.exec(detail ?? "")?.[1];
  return status !== undefined && IN_OUR_FAVOUR.has(status);
}

/** What the recorded events say about one payment. */
export interface PaymentFacts {
  /** Cents refunded (refunds that failed or were canceled do not count). */
  refundedCents: number;
  /** When the payment became refunded in full (its latest counted refund), else null. */
  refundedInFullAt: Date | null;
  /** The earliest dispute that is open or was lost, and when it was opened. */
  heldBy: { disputeId: string; at: Date } | null;
}

const PAYMENT_FACT_KINDS = ["refund", "refund_failed", "dispute", "dispute_closed"];

/**
 * The state of a payment from its recorded refunds and disputes. Depends
 * only on WHICH events are recorded, never on the order they arrived in.
 * `amountCents` is what the payment was (null: unknown, never "in full").
 */
export async function paymentFacts(
  db: CreditsDb,
  paymentIntentId: string,
  amountCents: number | null,
): Promise<PaymentFacts> {
  const events = await db.billingEvent.findMany({
    where: { paymentIntentId, kind: { in: PAYMENT_FACT_KINDS } },
  });
  const when = (e: { occurredAt: Date | null; createdAt: Date }) => e.occurredAt ?? e.createdAt;
  const failed = new Set(events.filter((e) => e.kind === "refund_failed").map((e) => e.stripeObjectId));
  const refunds = events.filter((e) => e.kind === "refund" && !failed.has(e.stripeObjectId));
  const refundedCents = refunds.reduce((sum, e) => sum + (e.amountCents ?? 0), 0);
  const inFull = amountCents !== null && amountCents > 0 && refundedCents >= amountCents;
  const refundedInFullAt = inFull
    ? refunds.map(when).reduce((a, b) => (b.getTime() > a.getTime() ? b : a))
    : null;
  const closedForUs = new Set(
    events
      .filter((e) => e.kind === "dispute_closed" && disputeClosedInOurFavour(e.detail))
      .map((e) => e.stripeObjectId),
  );
  const holding = events
    .filter((e) => e.kind === "dispute" && !closedForUs.has(e.stripeObjectId))
    .sort((a, b) => when(a).getTime() - when(b).getTime() || a.stripeObjectId.localeCompare(b.stripeObjectId))[0];
  return {
    refundedCents,
    refundedInFullAt,
    heldBy: holding ? { disputeId: holding.stripeObjectId, at: when(holding) } : null,
  };
}

/**
 * Recompute the row's derived money state from the facts: the end of the
 * subscription its allowance belongs to, and the refunds and disputes of the
 * payment of that period. The ONLY writer of allowanceStopAt, disputeId and
 * disputedAt, run after every event that can change them, under the user's
 * lock (so the last one to run saw every fact recorded before it). Nothing is
 * written for good while it can still change: an open dispute pauses, a won
 * one resumes, a refund that failed restores.
 */
export async function refreshAllowanceState(userId: string): Promise<void> {
  await withUserCreditLock(userId, async (tx) => {
    const row = await tx.subscription.findUnique({ where: { userId } });
    if (!row) return;
    const pi = row.allowancePaymentIntentId;
    const facts = pi ? await paymentFacts(tx, pi, row.allowancePaymentCents) : null;
    const subscriptionEnd =
      row.allowanceSubscriptionId !== null && row.endedSubscriptionId === row.allowanceSubscriptionId
        ? row.endedAt
        : null;
    const next = {
      allowanceStopAt: earliest(subscriptionEnd, facts?.refundedInFullAt),
      disputeId: facts?.heldBy?.disputeId ?? null,
      disputedAt: facts?.heldBy?.at ?? null,
    };
    if (
      sameInstant(row.allowanceStopAt, next.allowanceStopAt) &&
      row.disputeId === next.disputeId &&
      sameInstant(row.disputedAt, next.disputedAt)
    ) {
      return;
    }
    await tx.subscription.update({ where: { userId }, data: next });
  });
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

/** BillingEvent kind recording which payment paid for a granted Pro month. */
const PRO_MONTH_FACT = "pro_month";
/** Ledger key prefix of the Pro grants written before coverage months (one per invoice). */
const PER_INVOICE_GRANT = "pro_grant:";

const monthStartUtc = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));

/**
 * The calendar month a grant of the per-invoice era covered: the month its
 * invoice's paid period starts in (read from Stripe), or the month the grant
 * was written when the invoice paid for no period (a proration) or is gone.
 */
async function perInvoiceGrantMonth(invoiceId: string, createdAt: Date): Promise<string> {
  let inv: Stripe.Invoice;
  try {
    inv = await stripe.invoices.retrieve(invoiceId);
  } catch (err) {
    if (isMissingResource(err)) return monthKey(createdAt);
    throw err;
  }
  const period = await paidPeriodOfInvoice(inv);
  return monthKey(period?.start ?? createdAt);
}

/**
 * Is `month` already paid for by a Pro grant that is not this subscription's
 * own grant for it?
 *  - a grant from before grants were keyed by subscription
 *    (`pro_month:<user>:<YYYY-MM>`), or from before coverage months
 *    (`pro_grant:<invoice>`, for an invoice of this month): the deploy must
 *    not hand an existing subscriber the month a second time;
 *  - another subscription's grant for the month whose payment was then
 *    refunded in full: its credits stayed, so the month is covered and a
 *    resubscription after a refund does not get a second one (after a
 *    cancellation without a refund it does: that is a second paid month).
 */
async function monthCoveredElsewhere(
  userId: string,
  month: Date,
  subscriptionId: string,
  invoiceId: string,
): Promise<boolean> {
  const prefix = proMonthPrefix(userId, month);
  const hasKey = async (idempotencyKey: string) =>
    (await prisma.creditLedger.findUnique({ where: { idempotencyKey }, select: { id: true } })) !== null;
  if (await hasKey(prefix)) return true;
  if (await hasKey(`${PER_INVOICE_GRANT}${invoiceId}`)) return true;

  const start = monthStartUtc(month);
  const perInvoice = await prisma.creditLedger.findMany({
    where: {
      userId,
      idempotencyKey: { startsWith: PER_INVOICE_GRANT },
      createdAt: {
        gte: new Date(start.getTime() - 2 * DAY_MS),
        lt: new Date(addMonthsUtc(start, 1).getTime() + 2 * DAY_MS),
      },
    },
    select: { idempotencyKey: true, createdAt: true },
  });
  for (const grant of perInvoice) {
    const invoice = grant.idempotencyKey!.slice(PER_INVOICE_GRANT.length);
    if ((await perInvoiceGrantMonth(invoice, grant.createdAt)) === monthKey(month)) return true;
  }

  const own = proMonthKey(userId, month, subscriptionId);
  const others = await prisma.billingEvent.findMany({
    where: { userId, kind: PRO_MONTH_FACT, stripeObjectId: { startsWith: `${prefix}:` } },
  });
  for (const other of others) {
    if (other.stripeObjectId === own || !other.paymentIntentId) continue;
    const facts = await paymentFacts(prisma, other.paymentIntentId, other.amountCents);
    if (facts.refundedInFullAt) return true;
  }
  return false;
}

/**
 * Grant one subscription's month and record which payment paid for it, in
 * one transaction under the user's lock. False when it already exists (or
 * the account was deleted).
 */
async function grantInvoiceMonth(
  userId: string,
  month: Date,
  subscriptionId: string,
  payment: { pi: string; amount: number } | null,
): Promise<boolean> {
  const key = proMonthKey(userId, month, subscriptionId);
  try {
    return await withUserCreditLock(userId, async (tx) => {
      const outcome = await grantCreditsTx(tx, userId, PRO_MONTHLY_CREDITS, "pro_monthly", key);
      if (outcome !== "granted") return false;
      await tx.billingEvent.create({
        data: {
          userId,
          kind: PRO_MONTH_FACT,
          stripeObjectId: key,
          paymentIntentId: payment?.pi ?? null,
          amountCents: payment?.amount ?? null,
          credits: PRO_MONTHLY_CREDITS,
        },
      });
      return true;
    });
  } catch (err) {
    if (isUniqueViolation(err)) return false;
    throw err;
  }
}

/**
 * Apply a paid subscription invoice:
 *  - grant the allowance of the calendar month its period starts in, once
 *    per subscription and month (see monthCoveredElsewhere), for any invoice
 *    that brought in money, whatever has happened to its payment before or
 *    since (refunds and disputes never take a granted month back, so the
 *    outcome does not depend on event order);
 *  - before the allowance period moves on, grant every month of the old one
 *    that has come due, so an annual subscriber who never opened the app
 *    loses nothing at renewal;
 *  - record the new period and its payment for the subscription the row
 *    tracks (a yearly one then accrues one monthly allowance per
 *    anniversary, at most eleven), and recompute pause/stop from what is
 *    already known about that payment (a dispute that arrived first pauses).
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
  const payment = payments[0] ?? null;
  const row = await prisma.subscription.findUnique({ where: { userId } });
  // The period moves forward only (a late invoice for an older period never
  // rewinds it), and only for the subscription the row tracks.
  const advances =
    row !== null &&
    row.stripeSubscriptionId === subscriptionId &&
    (row.allowancePeriodStart === null ||
      row.allowancePeriodStart.getTime() < period.start.getTime());

  if (advances && row) await accrueProAllowance(userId, row as AllowanceRow);

  const granted =
    invoiceValueCents(inv) > 0 &&
    !(await monthCoveredElsewhere(userId, period.start, subscriptionId, inv.id)) &&
    (await grantInvoiceMonth(userId, period.start, subscriptionId, payment));

  if (advances && row) {
    await prisma.subscription.updateMany({
      where: {
        userId,
        stripeSubscriptionId: subscriptionId,
        OR: [{ allowancePeriodStart: null }, { allowancePeriodStart: { lt: period.start } }],
      },
      data: {
        allowanceSubscriptionId: subscriptionId,
        allowancePaymentIntentId: payment?.pi ?? null,
        allowancePaymentCents: payment?.amount ?? null,
        allowancePeriodStart: period.start,
        allowancePeriodEnd: period.end,
        allowanceYearly: isYearlyPeriod(period.start, period.end),
      },
    });
    await refreshAllowanceState(userId);
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
 *  - the share clawed back follows the TOTAL money returned (refunds that
 *    did not fail, plus disputes not closed in our favour), so a 50% refund
 *    and a lost dispute on the other 50% take the whole pack;
 *  - each event takes only its own increment, limited to the balance: credits
 *    already spent are forgiven, never taken out of a later purchase;
 *  - a dispute closed in our favour (won, inquiry closed) or a refund that
 *    failed gives back exactly what it took;
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
    where: { paymentIntentId: pi, kind: { in: PAYMENT_FACT_KINDS } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  let refunded = 0;
  const counted = new Map<string, number>(); // refunds replayed so far
  const failedFirst = new Set<string>(); // a failure seen before its refund
  const disputed = new Map<string, number>();
  const target = () => {
    const returned = refunded + [...disputed.values()].reduce((a, b) => a + b, 0);
    if (pack.amountCents <= 0) return 0;
    return Math.floor(pack.credits * Math.min(1, returned / pack.amountCents));
  };
  const giveBack = async (takenKey: string, restoreKey: string) => {
    const taken = await tx.creditLedger.findUnique({ where: { idempotencyKey: takenKey }, select: { delta: true } });
    const restore = -(taken?.delta ?? 0);
    if (restore > 0) {
      await grantCreditsTx(tx, pack.userId, restore, "credit_reversal_restored", restoreKey);
    }
  };
  for (const ev of events) {
    const before = target();
    if (ev.kind === "refund") {
      if (failedFirst.has(ev.stripeObjectId) || counted.has(ev.stripeObjectId)) continue;
      counted.set(ev.stripeObjectId, ev.amountCents ?? 0);
      refunded += ev.amountCents ?? 0;
      const take = target() - before;
      if (take > 0) {
        await debitCreditsTx(tx, pack.userId, take, "credit_reversal", packEventKey(pi, ev));
      }
    } else if (ev.kind === "refund_failed") {
      const amount = counted.get(ev.stripeObjectId);
      if (amount === undefined) {
        failedFirst.add(ev.stripeObjectId);
        continue;
      }
      counted.delete(ev.stripeObjectId);
      refunded -= amount;
      await giveBack(reversalKey(pi, `refund:${ev.stripeObjectId}`), packEventKey(pi, ev));
    } else if (ev.kind === "dispute") {
      disputed.set(ev.stripeObjectId, ev.amountCents ?? 0);
      const take = target() - before;
      if (take > 0) {
        await debitCreditsTx(tx, pack.userId, take, "credit_reversal", packEventKey(pi, ev));
      }
    } else if (disputeClosedInOurFavour(ev.detail) && disputed.delete(ev.stripeObjectId)) {
      await giveBack(reversalKey(pi, `dispute:${ev.stripeObjectId}`), packEventKey(pi, ev));
    }
  }
  return target();
}

/** The ledger key of the credit movement a pack event causes. */
function packEventKey(pi: string, ev: { kind: string; stripeObjectId: string }) {
  if (ev.kind === "refund") return reversalKey(pi, `refund:${ev.stripeObjectId}`);
  if (ev.kind === "refund_failed") return reversalKey(pi, `refund_restore:${ev.stripeObjectId}`);
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
    const r = await refundRemaining(pi, pack.amountCents, "requested_by_customer", userId);
    await recordBillingEvent({
      userId,
      kind: "deleted_account_payment",
      stripeObjectId: session.id,
      paymentIntentId: pi,
      amountCents: r.refunded,
      detail: r.error ? `refund refused: ${r.error}` : null,
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
    // It still bills: no second one. Record its real state at once (Pro when
    // it is active again, a failing one tracked as such), healing a missed
    // webhook or a status the previous code wrote.
    await applyLiveSubscription(userId, live, listedAt).catch((err) =>
      reportError(err, { source: "billing", route: "createProCheckout", userId }),
    );
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
 * the user's rows were erased. Throws when a cancellation fails (see
 * cancelSubscription), so the caller can retry.
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

  for (const id of ids) await cancelSubscription(id);

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

// ---- Rows written by the previous code --------------------------------------

/** A status this job changed, for its report (and a BillingEvent "legacy_resync"). */
export interface UnsyncedChange {
  userId: string;
  subscriptionId: string | null;
  from: string;
  to: string;
}

export interface UnsyncedReport {
  /** Rows re-read from Stripe in this run. */
  checked: number;
  /** Rows whose stored status changed. */
  changed: UnsyncedChange[];
  /** Rows that failed this run (reported, retried next run). */
  failed: number;
  /** Rows still to do after this run (0 = the repair is complete). */
  remaining: number;
}

/**
 * Rows never written by this code (stripeSyncedAt null) that may follow a
 * subscription: the code before it wrote status "active" or "canceled"
 * ("canceled" for EVERY status that was not active, past_due included), no
 * period end and no sync time. A plain "free" row without a subscription
 * (a customer created for a checkout) has nothing to repair.
 */
const UNSYNCED_ROWS = {
  stripeSyncedAt: null,
  OR: [{ stripeSubscriptionId: { not: null } }, { status: { not: "free" } }],
};

const LEAST_RECENTLY_CHECKED = [
  { stripeCheckedAt: { sort: "asc" as const, nulls: "first" as const } },
  { userId: "asc" as const },
];

/** Remember that maintenance looked at this row now (it moves to the back of the queue). */
async function markChecked(userId: string): Promise<void> {
  await prisma.subscription.updateMany({ where: { userId }, data: { stripeCheckedAt: new Date() } });
}

/** Re-read one unsynced row from Stripe and write its live state. */
async function resyncUnsyncedRow(row: {
  userId: string;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
}): Promise<void> {
  const fetchedAt = new Date();
  if (row.stripeSubscriptionId) {
    await syncSubscription(row.userId, row.stripeSubscriptionId);
  } else if (row.stripeCustomerId) {
    // No subscription id stored: follow the customer's live subscription,
    // else its most recent one.
    const list = await stripe.subscriptions.list({ customer: row.stripeCustomerId, status: "all", limit: 100 });
    const pick =
      list.data.find((s) => !ENDED_STATUSES.has(s.status)) ??
      [...list.data].sort((a, b) => (b.created ?? 0) - (a.created ?? 0))[0];
    if (pick) await applyLiveSubscription(row.userId, pick, fetchedAt);
  }
  // Nothing on Stripe to follow (or nothing more to write, e.g. a deleted
  // account): not Pro, and done.
  await prisma.subscription.updateMany({
    where: { userId: row.userId, stripeSyncedAt: null },
    data: row.stripeSubscriptionId ? { stripeSyncedAt: fetchedAt } : { stripeSyncedAt: fetchedAt, status: "free" },
  });
}

/**
 * One-off repair of the rows the previous code wrote (see UNSYNCED_ROWS),
 * run by the maintenance job in small batches until none is left: re-read
 * each from Stripe and write its live status and period end. Safe and
 * idempotent: the same conditional writes as every webhook, so it can run
 * alongside them, and a row leaves the set the moment anything (this job or
 * a webhook) has synced it, so an interrupted run resumes where it stopped.
 * Least recently checked first, so a row that keeps failing never blocks
 * the rest. Every status it changes is recorded (BillingEvent
 * "legacy_resync", one per user) and returned.
 */
export async function reconcileUnsyncedSubscriptions(
  opts: {
    limit?: number;
    deadline?: number;
    /** Only these users (a manual re-run for chosen accounts; tests on a shared database). */
    userIds?: string[];
  } = {},
): Promise<UnsyncedReport> {
  const report: UnsyncedReport = { checked: 0, changed: [], failed: 0, remaining: 0 };
  const where = opts.userIds ? { ...UNSYNCED_ROWS, userId: { in: opts.userIds } } : UNSYNCED_ROWS;
  const rows = await prisma.subscription.findMany({
    where,
    orderBy: LEAST_RECENTLY_CHECKED,
    take: opts.limit ?? 100,
  });
  for (const row of rows) {
    if (opts.deadline !== undefined && Date.now() > opts.deadline) break;
    report.checked++;
    try {
      await markChecked(row.userId);
      await resyncUnsyncedRow(row);
      const after = await prisma.subscription.findUnique({ where: { userId: row.userId } });
      if (after && after.status !== row.status) {
        const change = {
          userId: row.userId,
          subscriptionId: after.stripeSubscriptionId,
          from: row.status,
          to: after.status,
        };
        report.changed.push(change);
        await recordBillingEvent({
          userId: row.userId,
          kind: "legacy_resync",
          stripeObjectId: row.userId,
          detail: `status ${change.from} -> ${change.to}; subscription ${change.subscriptionId ?? "none"}`,
        });
      }
    } catch (err) {
      report.failed++;
      reportError(err, { source: "billing", route: "reconcileUnsyncedSubscriptions", userId: row.userId });
    }
  }
  report.remaining = await prisma.subscription.count({ where });
  return report;
}

// ---- Maintenance --------------------------------------------------------------

/**
 * Longest a maintenance run keeps starting Stripe work (each Stripe call is
 * itself bounded by the client's timeout, lib/stripe.ts). What is left is
 * done by the next run.
 */
export const BILLING_MAINTENANCE_BUDGET_MS = 90_000;

export interface BillingMaintenanceResult {
  /** Pending billing jobs completed this run (refunds, cancellations). */
  jobsCompleted: number;
  /** Pending billing jobs that failed again (still pending). */
  jobsFailed: number;
  /** Credit holds of crashed requests closed (given back, or a failed settle completed). */
  holdsReleased: number;
  /** "Active" rows past their paid period, or with none, re-read from Stripe. */
  subscriptionsResynced: number;
  /** The one-off repair of rows the previous code wrote (remaining 0 = complete). */
  unsynced: UnsyncedReport;
  /** The run hit its time budget; the next run continues. */
  stoppedEarly: boolean;
}

/**
 * The billing sweep (run by the maintenance job): finish every pending
 * billing job (a refund, a cancellation for a deleted account or a lost
 * dispute, that Stripe failed part-way and stopped retrying), close
 * abandoned credit holds, repair rows the previous code wrote, and re-read
 * rows still "active" a day past their paid period or with no period at all
 * (a missed renewal or cancellation webhook). Each queue is taken oldest /
 * least recently checked first and the run stops starting work after
 * `budgetMs`, so no row can block the others. Failures are reported and
 * retried on the next run.
 */
export async function runBillingMaintenance(
  now = new Date(),
  limit = 50,
  budgetMs = BILLING_MAINTENANCE_BUDGET_MS,
): Promise<BillingMaintenanceResult> {
  const deadline = Date.now() + budgetMs;
  const overBudget = () => Date.now() > deadline;
  const result: BillingMaintenanceResult = {
    jobsCompleted: 0,
    jobsFailed: 0,
    holdsReleased: 0,
    subscriptionsResynced: 0,
    unsynced: { checked: 0, changed: [], failed: 0, remaining: 0 },
    stoppedEarly: false,
  };
  const pending = await prisma.billingIntent.findMany({
    where: { state: "pending" },
    orderBy: { updatedAt: "asc" },
    take: limit,
  });
  for (const intent of pending) {
    if (overBudget()) break;
    try {
      if (intent.kind === REFUND_SUBSCRIPTION) await completeRefundIntent(intent);
      else if (intent.kind === CANCEL_ACCOUNT_BILLING) await completeCancelAccountIntent(intent);
      else if (intent.kind === CANCEL_LOST_DISPUTE) await completeLostDisputeIntent(intent);
      else continue;
      result.jobsCompleted++;
    } catch (err) {
      result.jobsFailed++;
      reportError(err, { source: "billing", route: "runBillingMaintenance", userId: intent.userId });
    }
  }

  result.holdsReleased = await releaseExpiredHolds({ now });

  result.unsynced = await reconcileUnsyncedSubscriptions({ limit: limit * 2, deadline });

  const lapsed = await prisma.subscription.findMany({
    where: {
      status: "active",
      stripeSubscriptionId: { not: null },
      OR: [{ currentPeriodEnd: null }, { currentPeriodEnd: { lt: new Date(now.getTime() - DAY_MS) } }],
    },
    orderBy: LEAST_RECENTLY_CHECKED,
    select: { userId: true, stripeSubscriptionId: true },
    take: limit,
  });
  for (const row of lapsed) {
    if (overBudget()) break;
    try {
      await markChecked(row.userId);
      await syncSubscription(row.userId, row.stripeSubscriptionId!);
      result.subscriptionsResynced++;
    } catch (err) {
      reportError(err, { source: "billing", route: "runBillingMaintenance", userId: row.userId });
    }
  }
  result.stoppedEarly = overBudget();
  return result;
}
