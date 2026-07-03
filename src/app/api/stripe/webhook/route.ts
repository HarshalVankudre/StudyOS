import type Stripe from "stripe";
import { setSubscription } from "@/lib/billing";
import { prisma } from "@/lib/db";
import {
  CREDIT_PACK_SIZE,
  grantCredits,
  PRO_MONTHLY_CREDITS,
} from "@/lib/credits";
import { recordFunnelEvent } from "@/lib/usage-limits";
import { stripe } from "@/lib/stripe";

// Stripe → us. Keeps subscription status in sync (renewals, cancellations)
// and grants credits. In production, register this URL in the Stripe
// dashboard with these events enabled:
//   checkout.session.completed, invoice.paid,
//   customer.subscription.created/updated/deleted
// Locally, forward with: stripe listen --forward-to
// localhost:3000/api/stripe/webhook
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

  if (event.type === "checkout.session.completed") {
    const s = event.data.object as Stripe.Checkout.Session;
    const userId = s.client_reference_id ?? s.metadata?.userId;
    if (userId && s.mode === "subscription") {
      // Status only — the Pro credit grant rides on invoice.paid, which fires
      // for the first invoice AND every renewal (that's what keeps a
      // subscriber's monthly credits refreshing).
      await setSubscription(userId, {
        status: "active",
        stripeCustomerId: typeof s.customer === "string" ? s.customer : null,
        stripeSubscriptionId:
          typeof s.subscription === "string" ? s.subscription : null,
      });
      recordFunnelEvent(userId, "purchase_pro");
    } else if (userId && s.mode === "payment" && s.metadata?.kind === "credits") {
      const amount = Number(s.metadata.credits) || CREDIT_PACK_SIZE;
      await grantCredits(userId, amount, "credit_purchase", `credit_purchase:${s.id}`);
      recordFunnelEvent(userId, "purchase_credits");
    }
  } else if (event.type === "invoice.paid") {
    const inv = event.data.object as Stripe.Invoice;
    // Basil (2025-03-31)+ nests this under invoice.parent.subscription_details;
    // older webhook API versions put it at the top level (invoice.subscription
    // / invoice.subscription_details). Read both so a pre-Basil webhook version
    // can't silently grant a paying Pro user 0 credits.
    const legacy = inv as unknown as {
      subscription?: string | { id: string };
      subscription_details?: { metadata?: { userId?: string } };
    };
    const details = inv.parent?.subscription_details;
    const rawSub = details?.subscription ?? legacy.subscription;
    const metaUserId =
      details?.metadata?.userId ??
      legacy.subscription_details?.metadata?.userId ??
      null;
    if (rawSub) {
      const subId = typeof rawSub === "string" ? rawSub : rawSub?.id;
      let userId = metaUserId;
      if (!userId && subId) {
        const row = await prisma.subscription.findFirst({
          where: { stripeSubscriptionId: subId },
        });
        userId = row?.userId ?? null;
      }
      if (!userId) {
        // A subscription invoice we can't attribute yet (e.g. this event beat
        // checkout.session.completed). Non-2xx makes Stripe retry with backoff
        // until the subscription row exists.
        return new Response("Unknown subscription", { status: 500 });
      }
      await grantCredits(
        userId,
        PRO_MONTHLY_CREDITS,
        "pro_monthly",
        `pro_grant:${inv.id}`,
      );
      await setSubscription(userId, {
        status: "active",
        stripeSubscriptionId: subId ?? null,
      });
    }
  } else if (
    event.type === "customer.subscription.created" ||
    event.type === "customer.subscription.updated" ||
    event.type === "customer.subscription.deleted"
  ) {
    const sub = event.data.object as Stripe.Subscription;
    let userId: string | null = sub.metadata?.userId ?? null;
    if (!userId) {
      const row = await prisma.subscription.findFirst({
        where: { stripeSubscriptionId: sub.id },
      });
      userId = row?.userId ?? null;
    }
    if (userId) {
      const active = sub.status === "active" || sub.status === "trialing";
      await setSubscription(userId, {
        status: active ? "active" : "canceled",
        stripeSubscriptionId: sub.id,
      });
    }
  }

  return new Response("ok", { status: 200 });
}
