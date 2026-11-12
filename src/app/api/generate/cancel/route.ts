import { rejectCrossSite } from "@/lib/http/same-origin";
import { auth } from "@clerk/nextjs/server";
import { z } from "zod";
import { generationTaskKey } from "@/lib/ai/generate";
import { abortActiveTask } from "@/lib/ai/tasks/cancellation";

export const runtime = "nodejs";

const requestSchema = z.object({
  generationId: z.string().regex(/^[A-Za-z0-9-]{8,64}$/),
});

/**
 * Stop a running workspace generation: aborts its model calls and guarantees
 * nothing is saved. Complements the client aborting its fetch, for proxies
 * that don't pass a disconnect through promptly. Keyed by the signed-in user,
 * so a user can only ever cancel their own generation.
 */
export async function POST(request: Request) {
  const crossSite = rejectCrossSite(request);
  if (crossSite) return crossSite;
  const { userId } = await auth();
  if (!userId) return Response.json({ cancelled: false }, { status: 401 });

  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ cancelled: false }, { status: 400 });

  const cancelled = abortActiveTask(generationTaskKey(userId, parsed.data.generationId));
  return Response.json({ cancelled });
}
