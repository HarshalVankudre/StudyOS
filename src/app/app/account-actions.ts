"use server";

import { auth } from "@clerk/nextjs/server";
import { isPro } from "@/lib/billing";
import { getCreditBalance } from "@/lib/credits";

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
