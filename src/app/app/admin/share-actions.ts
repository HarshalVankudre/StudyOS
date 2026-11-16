"use server";

/**
 * Operator console: moderation of shared pages. Like the console's other
 * actions they re-check the admin allow-list (lib/ops/admin.ts) and do
 * nothing at all for anyone else.
 */
import { auth } from "@clerk/nextjs/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { isAdmin } from "@/lib/ops/admin";
import { disableReportedShare, dismissShareReports } from "@/lib/share/moderation";

const shareInput = z.object({ shareId: z.string().min(1).max(64) });

/** The share id of an admin's form, or null for anyone else or a bad form. */
async function adminShareId(formData: FormData): Promise<string | null> {
  const { userId } = await auth();
  if (!isAdmin(userId)) return null;
  const parsed = shareInput.safeParse({ shareId: formData.get("shareId") });
  return parsed.success ? parsed.data.shareId : null;
}

/**
 * "Disable link": turn a reported page's link off for good (the student
 * cannot share that page again) and mark its reports done (a form action).
 */
export async function disableSharedPageAction(formData: FormData): Promise<void> {
  const shareId = await adminShareId(formData);
  if (!shareId) return;
  await disableReportedShare(shareId);
  revalidatePath("/app/admin");
}

/** "Dismiss reports": mark a share's open reports done and keep its link (a form action). */
export async function dismissShareReportsAction(formData: FormData): Promise<void> {
  const shareId = await adminShareId(formData);
  if (!shareId) return;
  await dismissShareReports(shareId);
  revalidatePath("/app/admin");
}
