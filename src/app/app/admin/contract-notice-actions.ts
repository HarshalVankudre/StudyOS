"use server";

/**
 * Operator console: withdrawal and cancellation notices (lib/contract-notices).
 * Like the console's other actions it re-checks the admin allow-list
 * (lib/ops/admin.ts) and does nothing at all for anyone else.
 */
import { auth } from "@clerk/nextjs/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { markContractNoticeDone } from "@/lib/contract-notices/store";
import { isAdmin } from "@/lib/ops/admin";

const noticeInput = z.object({ id: z.string().min(1).max(64) });

/** "Mark done": the operator processed an open notice (a form action). */
export async function markContractNoticeDoneAction(formData: FormData): Promise<void> {
  const { userId } = await auth();
  if (!isAdmin(userId)) return;
  const parsed = noticeInput.safeParse({ id: formData.get("id") });
  if (!parsed.success) return;
  await markContractNoticeDone(parsed.data.id);
  revalidatePath("/app/admin");
}
