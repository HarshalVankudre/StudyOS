import type Stripe from "stripe";
import {
  applyLiveSubscription,
  grantCreditPack,
  grantProInvoice,
  syncSubscription,
} from "@/lib/billing";
import { prisma } from "@/lib/db";
import { recordFunnelEvent } from "@/lib/usage-limits";
import { stripe, stripeId } from "@/lib/stripe";
import {
  handleChargeRefunded,
  handleDisputeClosed,
  handleDisputeCreated,
} from "./reversals";

// Stripe → us. Keeps subscription status in sync and grants credits only for
// money received. Register this URL in the Stripe dashboard with these events:
//   checkout.session.completed, checkout.session.async_payment_succeeded,
//   invoice.paid,
//   customer.subscription.created, customer.subscription.updated,
//   customer.subscription.deleted,
//   charge.refunded, charge.dispute.created, charge.dispute.closed
// Locally, forward with: stripe listen --forward-to
// localhost:3000/api/stripe/webhook
//
// Every handler is idempotent (Stripe retries and may deliver out of order):
// subscription status is always re-read from the LIVE subscription, credit
// grants are keyed in the ledger, and refunds/disputes are keyed by object id.
// Any thrown error returns 500 so Stripe retries with backoff.
export async function POST(req: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  const sig = req.headers.get("stripe-signature");
  if (!secret || !sig) {
    return new Response("Webhook not configured", { status: 400 });
  }

  const body = await req.text();
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(body, sig, secret);
  } catch {
    return new Response("Invalid signature", { status: 400 });
  }

  try {
    return await handleEvent(event);
  } catch (err) {
    console.error(`[stripe webhook] ${event.type} failed`, err);
    return new Response("Handler failed", { status: 500 });
  }
}

const ok = () => new Response("ok", { status: 200 });

async function handleEvent(event: Stripe.Event): Promise<Response> {
  switch (event.type) {
    case "checkout.session.completed":
    case "checkout.session.async_payment_succeeded": {
      const s = event.data.object;
      const userId = s.client_reference_id ?? s.metadata?.userId;
      if (!userId) return ok();
      if (s.mode === "subscription") {
        const subId = stripeId(s.subscription);
        if (!subId) return ok();
        const outcome = await syncSubscription(userId, subId);
        if (outcome === "ok" && event.type === "checkout.session.completed") {
          recordFunnelEvent(userId, "purchase_pro");
        }
      } else if (s.mode === "payment") {
        // Delayed payment methods complete as "unpaid" here and are granted
        // on async_payment_succeeded once the money has arrived.
        const outcome = await grantCreditPack(userId, s);
        if (outcome === "granted") recordFunnelEvent(userId, "purchase_credits");
      }
      return ok();
    }

    case "invoice.paid":
      return handleInvoicePaid(event.data.object);

    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted": {
      const sub = event.data.object;
      const userId =
        sub.metadata?.userId ||
        (await userForSubscription(sub.id)) ||
        (await userForCustomer(stripeId(sub.customer)));
      // Not one of ours (or not attributable): nothing to do.
      if (!userId) return ok();
      // Re-read the live subscription: the payload may be stale or delivered
      // out of order (e.g. an "updated: active" after "deleted").
      await syncSubscription(userId, sub.id);
      return ok();
    }

    case "charge.refunded":
      await handleChargeRefunded(event.data.object);
      return ok();

    case "charge.dispute.created":
      await handleDisputeCreated(event.data.object);
      return ok();

    case "charge.dispute.closed":
      await handleDisputeClosed(event.data.object);
      return ok();

    default:
      return ok();
  }
}

async function handleInvoicePaid(inv: Stripe.Invoice): Promise<Response> {
  // Basil (2025-03-31)+ nests this under invoice.parent.subscription_details;
  // older webhook API versions put it at the top level (invoice.subscription
  // / invoice.subscription_details). Read both so a pre-Basil webhook version
  // can't silently grant a paying Pro user 0 credits.
  const legacy = inv as unknown as {
    subscription?: string | { id: string };
    subscription_details?: { metadata?: { userId?: string } };
  };
  const details = inv.parent?.subscription_details;
  const subId = stripeId(details?.subscription ?? legacy.subscription ?? null);
  if (!subId) return ok(); // not a subscription invoice

  const live = await stripe.subscriptions.retrieve(subId);
  const userId =
    details?.metadata?.userId ??
    legacy.subscription_details?.metadata?.userId ??
    live.metadata?.userId ??
    (await userForSubscription(subId)) ??
    (await userForCustomer(stripeId(inv.customer)));
  if (!userId) {
    // Can't attribute this invoice yet. Non-2xx makes Stripe retry with
    // backoff until the subscription row exists.
    return new Response("Unknown subscription", { status: 500 });
  }

  // Status follows the live subscription (an invoice arriving after a
  // cancellation must not flip the user back to active). This also creates
  // the row when the invoice beats checkout.session.completed.
  const outcome = await applyLiveSubscription(userId, live);
  if (outcome === "deleted_account" || outcome === "duplicate") return ok();

  // Money arrived for a real period: grant that period's allowance.
  await grantProInvoice(userId, inv, subId);
  return ok();
}

async function userForSubscription(subId: string): Promise<string | null> {
  const row = await prisma.subscription.findFirst({
    where: { stripeSubscriptionId: subId },
    select: { userId: true },
  });
  return row?.userId ?? null;
}

async function userForCustomer(customerId: string | null): Promise<string | null> {
  if (!customerId) return null;
  const row = await prisma.subscription.findFirst({
    where: { stripeCustomerId: customerId },
    select: { userId: true },
  });
  return row?.userId ?? null;
}
