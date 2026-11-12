/**
 * Refund and dispute handling for the Stripe webhook.
 *
 * Every refund and dispute is recorded as facts (BillingEvent rows: one per
 * refund, a "refund_failed" row when a refund fails, one per dispute and per
 * dispute closure, each with the time it happened on Stripe), and what they
 * mean is recomputed from all the facts of the payment, so the outcome does
 * not depend on the order the webhooks arrive in. Refunds are always re-read
 * from Stripe (the payment's refund list), so a pending refund that later
 * fails is seen as failed.
 *
 * Policy (proportionate, never punitive):
 *  - Credit pack: the share of the pack clawed back follows the total money
 *    returned on its payment (refunds that did not fail, plus disputes not
 *    closed in our favour), limited to what is left in the balance, so the
 *    balance never goes below zero and the app keeps working. Credits already
 *    spent are not chased, then or later. A dispute closed in our favour
 *    ("won", or an inquiry "warning_closed") or a refund that failed gives
 *    back what it took. A refund or dispute that arrives before the pack was
 *    granted applies at the grant: the pack lands at its net share.
 *    (lib/billing.ts reconcilePackTx.)
 *  - Subscription payment (lib/billing.ts refreshAllowanceState): monthly
 *    credits already granted are never clawed back. Refunded in full: the
 *    allowance it paid for stops accruing further months (until the refund
 *    fails, if it does). Disputed while it pays the current period (whether
 *    or not its invoice was processed yet): Pro and accrual pause until the
 *    dispute closes; closed in our favour, both resume. Lost: the user's
 *    subscription is canceled (whichever payment it was on), so a customer
 *    who took the money back is not charged again.
 *
 * All steps are idempotent under webhook retries: events are keyed by
 * (kind, Stripe object id) and credit movements by ledger idempotency keys.
 */
import type Stripe from "stripe";
import {
  type PackInfo,
  recordBillingEvent,
  recordPackEvents,
  refreshAllowanceState,
  stopBillingAfterLostDispute,
  userForCustomer,
} from "@/lib/billing";
import { CREDIT_PACK_PRICE_USD, CREDIT_PACK_SIZE } from "@/lib/credits";
import { prisma } from "@/lib/db";
import { stripe, stripeId } from "@/lib/stripe";

/** The credit pack a PaymentIntent paid for, or null when it is not a pack. */
async function packForPaymentIntent(pi: string): Promise<PackInfo | null> {
  const sessions = await stripe.checkout.sessions.list({
    payment_intent: pi,
    limit: 1,
  });
  const s = sessions.data[0];
  if (!s || s.mode !== "payment" || s.metadata?.kind !== "credits") return null;
  const userId = s.client_reference_id ?? s.metadata.userId;
  if (!userId) return null;
  return {
    userId,
    credits: Number(s.metadata.credits) || CREDIT_PACK_SIZE,
    amountCents: s.amount_total || CREDIT_PACK_PRICE_USD * 100,
    sessionId: s.id,
  };
}

/** The user a (non-pack) payment belongs to: the row it pays for, else the charge's customer. */
async function userForPayment(pi: string, chargeId: string | null, customerId: string | null) {
  const row = await prisma.subscription.findFirst({
    where: { allowancePaymentIntentId: pi },
    select: { userId: true },
  });
  if (row) return row.userId;
  let customer = customerId;
  if (!customer && chargeId) customer = stripeId((await stripe.charges.retrieve(chargeId)).customer);
  return userForCustomer(customer);
}

const fromUnix = (n: number | null | undefined) => (typeof n === "number" ? new Date(n * 1000) : null);
const REFUND_FAILED = new Set<string>(["failed", "canceled"]);

/**
 * Record every refund of a payment as Stripe has it now (re-read, never
 * taken from the payload), then apply them: to the pack it bought, or to the
 * subscription allowance it paid for.
 */
async function applyRefunds(pi: string, chargeId: string | null, customerId: string | null): Promise<void> {
  const refunds = await stripe.refunds.list({ payment_intent: pi, limit: 100 });
  const ordered = [...refunds.data].sort((a, b) => (a.created ?? 0) - (b.created ?? 0));
  const facts = ordered.flatMap((r) => [
    {
      kind: "refund",
      stripeObjectId: r.id,
      amountCents: r.amount,
      occurredAt: fromUnix(r.created),
      detail: `status ${r.status}`,
    },
    ...(REFUND_FAILED.has(r.status ?? "")
      ? [
          {
            kind: "refund_failed",
            stripeObjectId: r.id,
            amountCents: r.amount,
            occurredAt: new Date(),
            detail: `status ${r.status}${r.failure_reason ? `; ${r.failure_reason}` : ""}`,
          },
        ]
      : []),
  ]);

  const pack = await packForPaymentIntent(pi);
  if (pack) {
    await recordPackEvents(
      pack,
      pi,
      facts.map((f) => ({ ...f, detail: `credit_pack; ${f.detail}` })),
    );
    return;
  }

  const userId = await userForPayment(pi, chargeId, customerId);
  for (const f of facts) {
    await recordBillingEvent({ ...f, userId, paymentIntentId: pi, detail: `subscription_or_other; ${f.detail}` });
  }
  if (userId) await refreshAllowanceState(userId);
}

/** charge.refunded: a refund was created (full or partial). */
export async function handleChargeRefunded(charge: Stripe.Charge): Promise<void> {
  const pi = stripeId(charge.payment_intent);
  if (!pi) {
    // Not a PaymentIntent charge (nothing of ours): keep an audit row only.
    await recordBillingEvent({
      userId: await userForCustomer(stripeId(charge.customer)),
      kind: "refund",
      stripeObjectId: `${charge.id}:${charge.amount_refunded}`,
      amountCents: charge.amount_refunded,
      detail: "charge without a payment intent",
    });
    return;
  }
  await applyRefunds(pi, charge.id, stripeId(charge.customer));
}

/**
 * charge.refund.updated / refund.updated / refund.failed: a refund changed
 * status, e.g. a pending refund failed and the money stayed with us.
 */
export async function handleRefundUpdated(refund: Stripe.Refund): Promise<void> {
  const pi = stripeId(refund.payment_intent);
  if (!pi) return;
  await applyRefunds(pi, stripeId(refund.charge), null);
}

/** The user behind a disputed charge (the row its payment pays for, else the charge's customer). */
async function userForDispute(dispute: Stripe.Dispute, pi: string | null): Promise<string | null> {
  const chargeId = stripeId(dispute.charge);
  if (pi) return userForPayment(pi, chargeId, null);
  if (!chargeId) return null;
  const charge = await stripe.charges.retrieve(chargeId);
  return userForCustomer(stripeId(charge.customer));
}

function disputeFact(dispute: Stripe.Dispute, detail: string) {
  return {
    kind: "dispute",
    stripeObjectId: dispute.id,
    amountCents: dispute.amount,
    occurredAt: fromUnix(dispute.created),
    detail,
  };
}

export async function handleDisputeCreated(dispute: Stripe.Dispute): Promise<void> {
  const pi = stripeId(dispute.payment_intent);
  const pack = pi ? await packForPaymentIntent(pi) : null;
  if (pack && pi) {
    await recordPackEvents(pack, pi, [disputeFact(dispute, `credit_pack; reason ${dispute.reason}`)]);
    return;
  }

  const userId = await userForDispute(dispute, pi);
  await recordBillingEvent({
    ...disputeFact(dispute, `subscription_or_other; reason ${dispute.reason}`),
    userId,
    paymentIntentId: pi,
  });
  // Pauses Pro and accrual when it is on the payment of the current period
  // (or will be, once that invoice is processed).
  if (userId) await refreshAllowanceState(userId);
}

export async function handleDisputeClosed(dispute: Stripe.Dispute): Promise<void> {
  const pi = stripeId(dispute.payment_intent);
  const pack = pi ? await packForPaymentIntent(pi) : null;
  const closed = {
    kind: "dispute_closed",
    stripeObjectId: dispute.id,
    amountCents: dispute.amount,
    occurredAt: new Date(),
    detail: `status ${dispute.status}`,
  };
  if (pack && pi) {
    await recordPackEvents(pack, pi, [
      // A dispute whose "created" event never arrived still counts.
      disputeFact(dispute, `credit_pack; reason ${dispute.reason}`),
      closed,
    ]);
    return;
  }

  const userId = await userForDispute(dispute, pi);
  // A dispute whose "created" event never arrived still counts.
  await recordBillingEvent({
    ...disputeFact(dispute, `subscription_or_other; reason ${dispute.reason}`),
    userId,
    paymentIntentId: pi,
  });
  await recordBillingEvent({ ...closed, userId, paymentIntentId: pi });
  if (!userId) return;
  // Won: Pro and accrual resume. Lost: they stay stopped from the dispute on...
  await refreshAllowanceState(userId);
  // ...and the customer who took the money back is not billed again,
  // whichever of their payments the dispute was on.
  if (dispute.status === "lost") await stopBillingAfterLostDispute(userId, dispute.id);
}
