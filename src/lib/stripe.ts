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
