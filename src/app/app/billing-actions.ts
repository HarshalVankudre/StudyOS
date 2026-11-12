"use server";

import { auth, currentUser } from "@clerk/nextjs/server";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { reportError } from "@/lib/ops/report-error";
import {
  createCreditPackCheckout,
  createProCheckout,
} from "@/lib/billing";
import {
  isBillingConfigured,
  proPriceId,
  stripe,
  type BillingInterval,
} from "@/lib/stripe";

async function originUrl(): Promise<string> {
  const h = await headers();
  const host = h.get("host") ?? "localhost:3000";
  const proto = host.startsWith("localhost") ? "http" : "https";
  return `${proto}://${host}`;
}

async function primaryEmail(): Promise<string | null> {
  const user = await currentUser();
  return (
    user?.primaryEmailAddress?.emailAddress ??
    user?.emailAddresses?.[0]?.emailAddress ??
    null
  );
}

/**
 * Start a Stripe Checkout for Pro and redirect to it. The form may send
 * `interval=year` for annual billing (only when STRIPE_PRICE_PRO_ANNUAL is
 * set); anything else is monthly. Every failure lands on the pricing page
 * with a translated notice (`?billing=…`) instead of an error page.
 */
export async function startCheckoutAction(formData?: FormData): Promise<void> {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const interval: BillingInterval =
    formData?.get("interval") === "year" ? "year" : "month";
  const priceId = proPriceId(interval);
  // Billing (or the requested interval) not configured in this environment.
  if (!isBillingConfigured() || !priceId) {
    redirect("/pricing?billing=unavailable");
  }

  let target: string;
  try {
    const result = await createProCheckout({
      userId,
      email: await primaryEmail(),
      priceId,
      origin: await originUrl(),
    });
    target =
      "url" in result ? result.url : "/pricing?billing=already_subscribed";
  } catch (err) {
    reportError(err, { source: "billing", route: "startCheckoutAction", userId });
    target = "/pricing?billing=error";
  }
  redirect(target);
}

/**
 * Start a one-time Stripe Checkout to buy a credit pack and redirect to it.
 * Uses inline price_data so no pre-created Stripe price is required.
 */
export async function buyCreditsAction(): Promise<void> {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  if (!isBillingConfigured()) redirect("/app/credits?billing=unavailable");

  let target: string;
  try {
    const { url } = await createCreditPackCheckout({
      userId,
      email: await primaryEmail(),
      origin: await originUrl(),
    });
    target = url;
  } catch (err) {
    reportError(err, { source: "billing", route: "buyCreditsAction", userId });
    target = "/app/credits?billing=error";
  }
  redirect(target);
}

/** Open the Stripe billing portal so the user can manage/cancel. */
export async function manageBillingAction(): Promise<void> {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");
  if (!isBillingConfigured()) redirect("/pricing?billing=unavailable");

  const sub = await prisma.subscription.findUnique({ where: { userId } });
  if (!sub?.stripeCustomerId) redirect("/pricing");

  let target: string;
  try {
    const origin = await originUrl();
    const session = await stripe.billingPortal.sessions.create({
      customer: sub.stripeCustomerId,
      return_url: `${origin}/app`,
    });
    target = session.url;
  } catch (err) {
    reportError(err, { source: "billing", route: "manageBillingAction", userId });
    target = "/pricing?billing=error";
  }
  redirect(target);
}
