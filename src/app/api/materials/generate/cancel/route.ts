import { rejectCrossSite } from "@/lib/http/same-origin";
import { auth } from "@clerk/nextjs/server";
import { z } from "zod";
import { abortActiveTask } from "@/lib/ai/tasks/cancellation";
import { allowMaterialWrite, readJsonBody } from "@/lib/materials/guard";
import { studyKitTaskKey } from "@/lib/materials/task-key";

export const runtime = "nodejs";

const requestSchema = z.object({
  generationId: z.string().regex(/^[A-Za-z0-9-]{8,64}$/),
});

/**
 * Stop a running study kit: aborts its model calls; nothing is delivered.
 * Complements the client aborting its fetch, for proxies that don't pass a
 * disconnect through promptly. Keyed by the signed-in user, so a user can
 * only ever cancel their own run.
 */
export async function POST(request: Request) {
  const crossSite = rejectCrossSite(request);
  if (crossSite) return crossSite;
  const { userId } = await auth();
  if (!userId) return Response.json({ cancelled: false }, { status: 401 });
  if (!allowMaterialWrite(userId)) return Response.json({ cancelled: false }, { status: 429 });
  const body = await readJsonBody(request, 1024);
  const parsed = requestSchema.safeParse(body.ok ? body.value : null);
  if (!parsed.success) return Response.json({ cancelled: false }, { status: 400 });
  return Response.json({ cancelled: abortActiveTask(studyKitTaskKey(userId, parsed.data.generationId)) });
}
