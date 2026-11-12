"use server";

import { auth, clerkClient } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import {
  isPro,
  markAccountDeleted,
  stopBillingForDeletedAccount,
  unmarkAccountDeleted,
} from "@/lib/billing";
import { getCreditBalance } from "@/lib/credits";
import { isBillingConfigured } from "@/lib/stripe";
import { eraseUserData } from "@/lib/account/erase-user-data";

/**
 * Lightweight plan + credit snapshot for the sidebar profile menu. `billing`
 * says whether payments are switched on here: without it the menu offers no
 * purchase links.
 */
export async function getAccountSummaryAction(): Promise<{
  pro: boolean;
  credits: number;
  billing: boolean;
}> {
  const billing = isBillingConfigured();
  const { userId } = await auth();
  if (!userId) return { pro: false, credits: 0, billing };
  const [pro, credits] = await Promise.all([
    isPro(),
    getCreditBalance(userId),
  ]);
  return { pro, credits, billing };
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

  // Tombstone first: from here on no credit account can be recreated and no
  // credits granted (a pack paid now is refunded), so nothing slips in while
  // the data is erased. It also queues the durable cancellation job with the
  // Stripe ids captured before they are erased.
  await markAccountDeleted(userId);

  // Stop billing now: every subscription the user has on Stripe (not just
  // the tracked one), plus open checkouts. If Stripe cannot be reached, a
  // subscription may still be live: withdraw the tombstone, keep everything,
  // and let the user retry (they are still signed in to do so).
  if (!(await stopBillingForDeletedAccount(userId))) {
    await unmarkAccountDeleted(userId);
    return { error: "billing_cancel_failed" };
  }

  await eraseUserData(userId);

  try {
    const client = await clerkClient();
    await client.users.deleteUser(userId);
  } catch {
    // The Clerk user may already be gone; local data is what matters most.
  }

  redirect("/");
}
