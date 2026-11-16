import { auth } from "@clerk/nextjs/server";
import { rejectCrossSite } from "@/lib/http/same-origin";
import { batchSchema, MAX_OPS_BODY_BYTES } from "@/lib/notebooks/ops";
import { applyBatch } from "@/lib/notebooks/server/apply-batch";
import { errorResponse, toErrorResponse } from "@/lib/notebooks/server/errors";
import { allowNotebookWrite, readJsonBody } from "@/lib/notebooks/server/guard";
import { idSchema } from "@/lib/notebooks/server/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Props = { params: Promise<{ id: string }> };

/**
 * POST /api/notebooks/:id/ops  Apply a batch of page and ink ops
 * (lib/notebooks/ops.ts), JSON { ops } of at most MAX_OPS_BODY_BYTES, in one
 * transaction under the notebook's lock (lib/notebooks/server/apply-batch.ts)
 * → { version, pages: [{ id, inkVersion, strokeCount }], dropped }.
 *
 * Errors carry { code }: not_authenticated | not_found (not the student's
 * live notebook) | invalid (schema, or a malformed stroke record: nothing
 * was applied) | too_large (body, or a page's ink past 6 MB: 422) |
 * too_many_strokes (422) | limit (pages per notebook: 422) | rate_limited |
 * busy (the notebook's lock was held too long; retry) | unavailable.
 */
export async function POST(request: Request, { params }: Props) {
  const crossSite = rejectCrossSite(request);
  if (crossSite) return crossSite;
  const { userId } = await auth();
  if (!userId) return errorResponse("not_authenticated", 401);
  if (!allowNotebookWrite(userId)) return errorResponse("rate_limited", 429);
  const { id } = await params;
  if (!idSchema.safeParse(id).success) return errorResponse("not_found", 404);

  const read = await readJsonBody(request, MAX_OPS_BODY_BYTES);
  if (!read.ok) return errorResponse(read.status === 413 ? "too_large" : "invalid", read.status);
  const parsed = batchSchema.safeParse(read.value);
  if (!parsed.success) return errorResponse("invalid", 400);

  try {
    const result = await applyBatch(userId, id, parsed.data.ops);
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return toErrorResponse(error, { route: "/api/notebooks/[id]/ops", method: "POST", userId });
  }
}
