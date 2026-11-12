"use server";

import { auth, clerkClient } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import {
  cancelAllBillingForUser,
  isPro,
  markAccountDeleted,
} from "@/lib/billing";
import { getCreditBalance } from "@/lib/credits";
import { eraseUserData } from "@/lib/account/erase-user-data";

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
export async function deleteAccountAction(): Promise<{ error: string } | void> {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  // Stop billing first so nothing renews: every subscription the user has on
  // Stripe (not just the tracked one), plus open checkouts. Crucially, only
  // proceed to purge the local record if we KNOW billing is stopped. On a
  // transient Stripe failure a subscription may still be active and charging
  // the card — deleting the row that maps to it would orphan live billing with
  // no way to reconcile. Abort instead; the user can retry.
  try {
    await cancelAllBillingForUser(userId);
  } catch {
    return { error: "billing_cancel_failed" };
  }

  await eraseUserData(userId);
  // Tombstone so a late Stripe webhook cannot recreate billing rows or credits.
  await markAccountDeleted(userId);

  try {
    const client = await clerkClient();
    await client.users.deleteUser(userId);
  } catch {
    // The Clerk user may already be gone; local data is what matters most.
  }

  redirect("/");
}
