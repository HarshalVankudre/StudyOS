"use server";

/**
 * Operator console actions. Each one re-checks the admin allow-list
 * (lib/ops/admin.ts) and does nothing at all for anyone else, so calling it
 * directly reveals nothing.
 */
import { auth } from "@clerk/nextjs/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { FEEDBACK_STATUSES } from "@/lib/feedback";
import { isAdmin } from "@/lib/ops/admin";

const statusInput = z.object({
  id: z.string().min(1).max(64),
  status: z.enum(FEEDBACK_STATUSES),
});

/** Mark one feedback message new, read or done (a form action in the inbox). */
export async function setFeedbackStatusAction(formData: FormData): Promise<void> {
  const { userId } = await auth();
  if (!isAdmin(userId)) return;
  const parsed = statusInput.safeParse({ id: formData.get("id"), status: formData.get("status") });
  if (!parsed.success) return;
  await prisma.feedback.updateMany({ where: { id: parsed.data.id }, data: { status: parsed.data.status } });
  revalidatePath("/app/admin");
}
