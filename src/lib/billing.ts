/**
 * Billing helpers (server-only). Maps Stripe subscriptions to the app's plan.
 */
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/db";
import { stripe } from "@/lib/stripe";
import type { Plan } from "@/lib/ai/plans";
import { CREDIT_PACK_SIZE, grantCredits, PRO_SIGNUP_CREDITS } from "@/lib/credits";

/** The current user's plan — "pro" when they have an active subscription. */
export async function getUserPlan(): Promise<Plan> {
  const { userId } = await auth();
  if (userId) {
    const sub = await prisma.subscription.findUnique({ where: { userId } });
    if (sub?.status === "active") return "pro";
  }
  // Dev override (no subscription): act as a given plan while testing.
  const override = process.env.STUDYOS_PLAN;
  if (override === "pro" || override === "free") return override;
  return "free";
}

/** Has the signed-in user got an active Pro subscription? */
export async function isPro(): Promise<boolean> {
  const { userId } = await auth();
  if (!userId) return false;
  const sub = await prisma.subscription.findUnique({ where: { userId } });
  return sub?.status === "active";
}

type SubFields = {
  status: string;
  stripeCustomerId?: string | null;
  stripeSubscriptionId?: string | null;
};

/** Upsert a user's subscription record (used by the webhook + success handler). */
export async function setSubscription(
  userId: string,
  fields: SubFields,
): Promise<void> {
  await prisma.subscription.upsert({
    where: { userId },
    create: { userId, ...fields },
    update: fields,
  });
}

/**
 * After Stripe Checkout returns, verify the session and apply its effect:
 *   - a subscription → activate Pro and grant the Pro signup credits;
 *   - a one-time credit-pack payment → grant the purchased credits.
 * Best-effort and idempotent (the webhook reconciles if this misses).
 */
export async function reconcileCheckoutSession(sessionId: string): Promise<void> {
  const { userId } = await auth();
  if (!userId) return;
  try {
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    if (session.client_reference_id !== userId) return;
    const paid =
      session.status === "complete" || session.payment_status === "paid";
    if (!paid) return;

    if (session.mode === "subscription") {
      await setSubscription(userId, {
        status: "active",
        stripeCustomerId:
          typeof session.customer === "string" ? session.customer : null,
        stripeSubscriptionId:
          typeof session.subscription === "string" ? session.subscription : null,
      });
      const key =
        typeof session.subscription === "string"
          ? session.subscription
          : sessionId;
      await grantCredits(userId, PRO_SIGNUP_CREDITS, "pro_signup", `pro_grant:${key}`);
    } else if (
      session.mode === "payment" &&
      session.metadata?.kind === "credits"
    ) {
      const amount = Number(session.metadata.credits) || CREDIT_PACK_SIZE;
      await grantCredits(
        userId,
        amount,
        "credit_purchase",
        `credit_purchase:${sessionId}`,
      );
    }
  } catch {
    // The webhook will reconcile if this best-effort path fails.
  }
}
