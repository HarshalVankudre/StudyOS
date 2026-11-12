/**
 * Refund and dispute handling for the Stripe webhook.
 *
 * Policy (proportionate, never punitive):
 *  - Every refund and dispute is recorded as a BillingEvent for the owner.
 *  - Credit pack refunded (fully or partly) or disputed: claw back the same
 *    share of the pack's credits, limited to what is left in the balance, so
 *    the balance never goes below zero and the app keeps working. Credits
 *    already spent are not chased.
 *  - Dispute on a pack closed in our favour ("won"): the clawed-back credits
 *    are restored.
 *  - Subscription charges refunded or disputed: recorded only. Pro access
 *    follows the subscription's status (a refund issued with a cancellation
 *    ends Pro through the customer.subscription.* events); monthly credits
 *    already granted are not clawed back.
 *
 * All steps are idempotent under webhook retries: events are keyed by
 * (kind, Stripe object id) and credit movements by ledger idempotency keys.
 */
import type Stripe from "stripe";
import { isDeletedAccount, recordBillingEvent } from "@/lib/billing";
import {
  CREDIT_PACK_PRICE_USD,
  CREDIT_PACK_SIZE,
  debitCredits,
  grantCredits,
  ledgerSumForKeyPrefix,
} from "@/lib/credits";
import { prisma } from "@/lib/db";
import { stripe, stripeId } from "@/lib/stripe";

type PackInfo = {
  userId: string;
  credits: number;
  amountCents: number;
  sessionId: string;
};

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

const reversalPrefix = (pi: string) => `pack_reversal:${pi}:`;

/**
 * Claw back `fraction` of a pack's credits (cumulative across events for the
 * same payment), limited to the current balance. Only when the pack was
 * actually granted. Returns the credits removed.
 */
async function clawBackPack(
  pack: PackInfo,
  pi: string,
  fraction: number,
  tag: string,
): Promise<number> {
  if (await isDeletedAccount(pack.userId)) return 0;
  const granted = await prisma.creditLedger.findUnique({
    where: { idempotencyKey: `credit_purchase:${pack.sessionId}` },
    select: { id: true },
  });
  if (!granted) return 0; // never granted: nothing to take back
  const share = Math.max(0, Math.min(1, fraction));
  const target = Math.floor(pack.credits * share);
  const already = -(await ledgerSumForKeyPrefix(pack.userId, reversalPrefix(pi)));
  const toClaw = target - already;
  if (toClaw <= 0) return 0;
  return debitCredits(
    pack.userId,
    toClaw,
    "credit_reversal",
    `${reversalPrefix(pi)}${tag}`,
  );
}

export async function handleChargeRefunded(charge: Stripe.Charge): Promise<void> {
  const pi = stripeId(charge.payment_intent);
  const pack = pi ? await packForPaymentIntent(pi) : null;
  const userId =
    pack?.userId ?? (await userForCustomer(stripeId(charge.customer)));
  let clawed = 0;
  if (pack && pi && charge.amount > 0) {
    clawed = await clawBackPack(
      pack,
      pi,
      charge.amount_refunded / charge.amount,
      `refund:${charge.amount_refunded}`,
    );
  }
  await recordBillingEvent({
    userId,
    kind: "refund",
    // One row per cumulative refunded amount (each partial refund).
    stripeObjectId: `${charge.id}:${charge.amount_refunded}`,
    paymentIntentId: pi,
    amountCents: charge.amount_refunded,
    credits: clawed ? -clawed : null,
    detail: pack ? "credit_pack" : "subscription_or_other",
  });
}

export async function handleDisputeCreated(dispute: Stripe.Dispute): Promise<void> {
  const pi = stripeId(dispute.payment_intent);
  const pack = pi ? await packForPaymentIntent(pi) : null;
  let userId = pack?.userId ?? null;
  if (!userId) {
    const chargeId = stripeId(dispute.charge);
    if (chargeId) {
      const charge = await stripe.charges.retrieve(chargeId);
      userId = await userForCustomer(stripeId(charge.customer));
    }
  }
  let clawed = 0;
  if (pack && pi) {
    clawed = await clawBackPack(
      pack,
      pi,
      dispute.amount / pack.amountCents,
      `dispute:${dispute.id}`,
    );
  }
  await recordBillingEvent({
    userId,
    kind: "dispute",
    stripeObjectId: dispute.id,
    paymentIntentId: pi,
    amountCents: dispute.amount,
    credits: clawed ? -clawed : null,
    detail: `${pack ? "credit_pack" : "subscription_or_other"}; reason ${dispute.reason}`,
  });
}

export async function handleDisputeClosed(dispute: Stripe.Dispute): Promise<void> {
  const pi = stripeId(dispute.payment_intent);
  const pack = pi ? await packForPaymentIntent(pi) : null;
  let restored = 0;
  if (dispute.status === "won" && pack && pi) {
    const clawed = -(await ledgerSumForKeyPrefix(
      pack.userId,
      `${reversalPrefix(pi)}dispute:${dispute.id}`,
    ));
    if (clawed > 0 && !(await isDeletedAccount(pack.userId))) {
      await grantCredits(
        pack.userId,
        clawed,
        "credit_reversal_restored",
        `${reversalPrefix(pi)}restore:${dispute.id}`,
      );
      restored = clawed;
    }
  }
  await recordBillingEvent({
    userId: pack?.userId ?? null,
    kind: "dispute_closed",
    stripeObjectId: dispute.id,
    paymentIntentId: pi,
    amountCents: dispute.amount,
    credits: restored || null,
    detail: `status ${dispute.status}`,
  });
}
