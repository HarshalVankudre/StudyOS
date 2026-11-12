import Stripe from "stripe";

if (!process.env.STRIPE_SECRET_KEY) {
  console.warn("[StudyOS] STRIPE_SECRET_KEY is not set — billing is disabled.");
}

/**
 * Server-side Stripe client. Never import this into a client component.
 *
 * The Stripe constructor throws on an empty key, which would crash `next build`
 * page-data collection in environments where the secret is injected at runtime
 * only (e.g. the Cloud Run Docker build, where secrets are not build args). Fall
 * back to a placeholder so the module loads; real API calls still require the
 * real key (set at runtime), and any call made without it fails as intended.
 */
export const stripe = new Stripe(
  process.env.STRIPE_SECRET_KEY || "sk_placeholder_billing_disabled",
);

/** Pro billing cadence. Annual is offered only when its price id is set. */
export type BillingInterval = "month" | "year";

/** True when Stripe checkout can run at all (secret key + monthly Pro price). */
export function isBillingConfigured(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY && process.env.STRIPE_PRICE_PRO);
}

/** The Stripe price id for a Pro interval, or null when not configured. */
export function proPriceId(interval: BillingInterval): string | null {
  const id =
    interval === "year"
      ? process.env.STRIPE_PRICE_PRO_ANNUAL
      : process.env.STRIPE_PRICE_PRO;
  return id || null;
}

/** Is annual Pro billing offered in this environment? */
export function isAnnualBillingAvailable(): boolean {
  return isBillingConfigured() && proPriceId("year") !== null;
}

/** The id of an expandable Stripe field (string id or expanded object). */
export function stripeId(
  value: string | { id: string } | null | undefined,
): string | null {
  if (!value) return null;
  return typeof value === "string" ? value : value.id;
}
