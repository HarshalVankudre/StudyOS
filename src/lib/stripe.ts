import Stripe from "stripe";

if (!process.env.STRIPE_SECRET_KEY) {
  console.warn("[StudyOS] STRIPE_SECRET_KEY is not set — billing is disabled.");
}

/** Server-side Stripe client. Never import this into a client component. */
export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY ?? "");
