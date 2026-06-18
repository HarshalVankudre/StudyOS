import type Stripe from "stripe";
import { setSubscription } from "@/lib/billing";
import { stripe } from "@/lib/stripe";

// Stripe → us. Keeps subscription status in sync (renewals, cancellations).
// In production, register this URL in the Stripe dashboard and set
// STRIPE_WEBHOOK_SECRET. Locally, forward with: stripe listen --forward-to
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
    if (userId) {
      await setSubscription(userId, {
        status: "active",
        stripeCustomerId: typeof s.customer === "string" ? s.customer : null,
        stripeSubscriptionId:
          typeof s.subscription === "string" ? s.subscription : null,
      });
    }
  } else if (
    event.type === "customer.subscription.updated" ||
    event.type === "customer.subscription.deleted"
  ) {
    const sub = event.data.object as Stripe.Subscription;
    const userId = sub.metadata?.userId;
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
