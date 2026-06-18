"use server";

import { auth, currentUser } from "@clerk/nextjs/server";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { stripe } from "@/lib/stripe";

async function originUrl(): Promise<string> {
  const h = await headers();
  const host = h.get("host") ?? "localhost:3000";
  const proto = host.startsWith("localhost") ? "http" : "https";
  return `${proto}://${host}`;
}

/** Start a Stripe Checkout for the Pro subscription and redirect to it. */
export async function startCheckoutAction(): Promise<void> {
  const { userId } = await auth();
  if (!userId) throw new Error("Not authenticated");

  const priceId = process.env.STRIPE_PRICE_PRO;
  if (!priceId) throw new Error("STRIPE_PRICE_PRO is not set");

  const user = await currentUser();
  const email = user?.emailAddresses?.[0]?.emailAddress;
  const origin = await originUrl();

  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    line_items: [{ price: priceId, quantity: 1 }],
    customer_email: email,
    client_reference_id: userId,
    subscription_data: { metadata: { userId } },
    allow_promotion_codes: true,
    success_url: `${origin}/app?upgraded=1&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${origin}/pricing`,
  });

  if (session.url) redirect(session.url);
  throw new Error("Could not start checkout");
}

/** Open the Stripe billing portal so the user can manage/cancel. */
export async function manageBillingAction(): Promise<void> {
  const { userId } = await auth();
  if (!userId) throw new Error("Not authenticated");

  const sub = await prisma.subscription.findUnique({ where: { userId } });
  if (!sub?.stripeCustomerId) throw new Error("No billing account yet");

  const origin = await originUrl();
  const session = await stripe.billingPortal.sessions.create({
    customer: sub.stripeCustomerId,
    return_url: `${origin}/app`,
  });
  redirect(session.url);
}
