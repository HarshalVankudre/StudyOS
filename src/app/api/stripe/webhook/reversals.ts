/**
 * Refund and dispute handling for the Stripe webhook.
 *
 * Policy (proportionate, never punitive):
 *  - Every refund and dispute is recorded as a BillingEvent for the owner.
 *  - Credit pack: the share of the pack clawed back follows the total money
 *    returned on its payment (refunds plus disputes not closed in our
 *    favour), limited to what is left in the balance, so the balance never
 *    goes below zero and the app keeps working. Credits already spent are not
 *    chased, then or later. A dispute closed in our favour ("won", or an
 *    inquiry "warning_closed") gives back what it took. A refund or dispute
 *    that arrives before the pack was granted applies at the grant: the pack
 *    lands at its net share. (lib/billing.ts reconcilePackTx.)
 *  - Subscription payment refunded in full: the allowance it paid for stops
 *    accruing further months. Pro follows the subscription's status (a refund
 *    issued with a cancellation ends Pro through customer.subscription.*);
 *    monthly credits already granted are not clawed back.
 *  - Subscription payment disputed (inquiry or chargeback) while it pays the
 *    current period: Pro and accrual pause until the dispute closes. Closed
 *    in our favour: both resume. Lost: the subscription is canceled, so a
 *    customer who took the money back is not charged again.
 *
 * All steps are idempotent under webhook retries: events are keyed by
 * (kind, Stripe object id) and credit movements by ledger idempotency keys.
 */
import type Stripe from "stripe";
import {
  disputeClosedInOurFavour,
  isSubscriptionAlreadyGone,
  type PackInfo,
  recordBillingEvent,
  recordPackEvents,
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

async function userForCustomer(customerId: string | null): Promise<string | null> {
  if (!customerId) return null;
  const row = await prisma.subscription.findFirst({
    where: { stripeCustomerId: customerId },
    select: { userId: true },
  });
  return row?.userId ?? null;
}

/** The user behind a disputed charge (by its customer). */
async function userForDispute(dispute: Stripe.Dispute): Promise<string | null> {
  const chargeId = stripeId(dispute.charge);
  if (!chargeId) return null;
  const charge = await stripe.charges.retrieve(chargeId);
  return userForCustomer(stripeId(charge.customer));
}

export async function handleChargeRefunded(charge: Stripe.Charge): Promise<void> {
  const pi = stripeId(charge.payment_intent);
  const pack = pi ? await packForPaymentIntent(pi) : null;
  // One row per cumulative refunded amount (each partial refund).
  const stripeObjectId = `${charge.id}:${charge.amount_refunded}`;
  if (pack && pi) {
    await recordPackEvents(pack, pi, [
      { kind: "refund", stripeObjectId, amountCents: charge.amount_refunded, detail: "credit_pack" },
    ]);
    return;
  }

  const userId = await userForCustomer(stripeId(charge.customer));
  if (userId && pi && charge.amount > 0 && charge.amount_refunded >= charge.amount) {
    // The payment of the current allowance period came back in full: no
    // further months accrue from it.
    const now = new Date();
    await prisma.subscription.updateMany({
      where: {
        userId,
        allowancePaymentIntentId: pi,
        OR: [{ allowanceStopAt: null }, { allowanceStopAt: { gt: now } }],
      },
      data: { allowanceStopAt: now },
    });
  }
  await recordBillingEvent({
    userId,
    kind: "refund",
    stripeObjectId,
    paymentIntentId: pi,
    amountCents: charge.amount_refunded,
    detail: "subscription_or_other",
  });
}

export async function handleDisputeCreated(dispute: Stripe.Dispute): Promise<void> {
  const pi = stripeId(dispute.payment_intent);
  const pack = pi ? await packForPaymentIntent(pi) : null;
  if (pack && pi) {
    await recordPackEvents(pack, pi, [
      {
        kind: "dispute",
        stripeObjectId: dispute.id,
        amountCents: dispute.amount,
        detail: `credit_pack; reason ${dispute.reason}`,
      },
    ]);
    return;
  }

  const userId = await userForDispute(dispute);
  let held = false;
  if (userId && pi) {
    // Only when the disputed payment pays the current period: an old
    // month's dispute does not take away a period paid for since.
    const result = await prisma.subscription.updateMany({
      where: { userId, allowancePaymentIntentId: pi },
      data: { disputeId: dispute.id, disputedAt: new Date() },
    });
    held = result.count > 0;
  }
  await recordBillingEvent({
    userId,
    kind: "dispute",
    stripeObjectId: dispute.id,
    paymentIntentId: pi,
    amountCents: dispute.amount,
    detail: `subscription_or_other; reason ${dispute.reason}${held ? "; pro paused" : ""}`,
  });
}

export async function handleDisputeClosed(dispute: Stripe.Dispute): Promise<void> {
  const pi = stripeId(dispute.payment_intent);
  const pack = pi ? await packForPaymentIntent(pi) : null;
  const closed = `status ${dispute.status}`;
  if (pack && pi) {
    await recordPackEvents(pack, pi, [
      // A dispute whose "created" event never arrived still counts.
      {
        kind: "dispute",
        stripeObjectId: dispute.id,
        amountCents: dispute.amount,
        detail: `credit_pack; reason ${dispute.reason}`,
      },
      { kind: "dispute_closed", stripeObjectId: dispute.id, amountCents: dispute.amount, detail: closed },
    ]);
    return;
  }

  const row =
    (await prisma.subscription.findFirst({ where: { disputeId: dispute.id } })) ??
    (pi ? await prisma.subscription.findFirst({ where: { allowancePaymentIntentId: pi } }) : null);
  const userId = row?.userId ?? (await userForDispute(dispute));
  const notes: string[] = [closed];
  if (row && disputeClosedInOurFavour(closed)) {
    await prisma.subscription.updateMany({
      where: { userId: row.userId, disputeId: dispute.id },
      data: { disputeId: null, disputedAt: null },
    });
    notes.push("pro resumed");
  } else if (row && dispute.status === "lost") {
    // The money for this period is gone: keep Pro paused and stop billing.
    await prisma.subscription.updateMany({
      where: { userId: row.userId, disputeId: null },
      data: { disputeId: dispute.id, disputedAt: new Date() },
    });
    if (row.stripeSubscriptionId) {
      try {
        await stripe.subscriptions.cancel(row.stripeSubscriptionId);
        notes.push("subscription canceled");
      } catch (err) {
        if (!isSubscriptionAlreadyGone(err)) throw err;
      }
    }
  }
  await recordBillingEvent({
    userId,
    kind: "dispute_closed",
    stripeObjectId: dispute.id,
    paymentIntentId: pi,
    amountCents: dispute.amount,
    detail: notes.join("; "),
  });
}
