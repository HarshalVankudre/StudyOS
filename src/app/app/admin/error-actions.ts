"use server";

/**
 * Operator console: the "Errors" panel's "Clear" button. Like the console's
 * other actions it re-checks the admin allow-list (lib/ops/admin.ts) and does
 * nothing at all for anyone else.
 */
import { auth } from "@clerk/nextjs/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { isAdmin } from "@/lib/ops/admin";
import { FINGERPRINT_PATTERN } from "@/lib/ops/error-events";
import { clearErrorEvent } from "@/lib/ops/error-overview";

const clearInput = z.object({ fingerprint: z.string().regex(FINGERPRINT_PATTERN) });

/** Remove one kind of error from the panel, for a fixed issue (a form action). */
export async function clearErrorEventAction(formData: FormData): Promise<void> {
  const { userId } = await auth();
  if (!isAdmin(userId)) return;
  const parsed = clearInput.safeParse({ fingerprint: formData.get("fingerprint") });
  if (!parsed.success) return;
  await clearErrorEvent(parsed.data.fingerprint);
  revalidatePath("/app/admin");
}
