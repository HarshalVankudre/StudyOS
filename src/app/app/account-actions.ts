"use server";

import { auth, clerkClient } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { isPro } from "@/lib/billing";
import { getCreditBalance } from "@/lib/credits";
import { prisma } from "@/lib/db";
import { stripe } from "@/lib/stripe";
import { gcsAssetStore } from "@/lib/assets/storage";

/** Lightweight plan + credit snapshot for the sidebar profile menu. */
export async function getAccountSummaryAction(): Promise<{
  pro: boolean;
  credits: number;
}> {
  const { userId } = await auth();
  if (!userId) return { pro: false, credits: 0 };
  const [pro, credits] = await Promise.all([
    isPro(),
    getCreditBalance(userId),
  ]);
  return { pro, credits };
}

/**
 * Permanently delete the signed-in user's account: cancel any Stripe
 * subscription, purge all owned rows (workspaces cascade their change
 * history), best-effort remove stored asset bytes, then delete the Clerk
 * user. GDPR/CCPA erasure in one click.
 */
export async function deleteAccountAction(): Promise<void> {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  // Stop billing first so nothing renews if a later step fails.
  const sub = await prisma.subscription.findUnique({ where: { userId } });
  if (sub?.stripeSubscriptionId) {
    try {
      await stripe.subscriptions.cancel(sub.stripeSubscriptionId);
    } catch {
      // Already canceled / test data — deletion proceeds regardless.
    }
  }

  // Asset bytes live in object storage; collect keys before rows disappear.
  const assets = await prisma.asset.findMany({
    where: { ownerId: userId },
    select: { storageKey: true },
  });
  if (assets.length > 0) {
    try {
      const store = gcsAssetStore();
      await Promise.allSettled(assets.map((a) => store.delete(a.storageKey)));
    } catch {
      // Storage not configured (e.g. local dev) — rows still go.
    }
  }

  await prisma.$transaction([
    prisma.workspace.deleteMany({ where: { ownerId: userId } }),
    prisma.workspaceChange.deleteMany({ where: { ownerId: userId } }),
    prisma.agentTask.deleteMany({ where: { userId } }),
    prisma.asset.deleteMany({ where: { ownerId: userId } }),
    prisma.creditLedger.deleteMany({ where: { userId } }),
    prisma.creditAccount.deleteMany({ where: { userId } }),
    prisma.usageEvent.deleteMany({ where: { userId } }),
    prisma.subscription.deleteMany({ where: { userId } }),
  ]);

  try {
    const client = await clerkClient();
    await client.users.deleteUser(userId);
  } catch {
    // The Clerk user may already be gone; local data is what matters most.
  }

  redirect("/");
}
