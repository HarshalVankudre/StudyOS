import { auth } from "@clerk/nextjs/server";
import { rejectCrossSite } from "@/lib/http/same-origin";
import { errorResponse, toErrorResponse } from "@/lib/notebooks/server/errors";
import { allowNotebookRead, allowNotebookWrite, readJsonBody } from "@/lib/notebooks/server/guard";
import { MAX_META_BODY_BYTES } from "@/lib/notebooks/server/limits";
import { createNotebookSchema } from "@/lib/notebooks/server/schemas";
import { createNotebook, listNotebooks } from "@/lib/notebooks/server/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

/**
 * GET  /api/notebooks  The shelf: { notebooks: NotebookSummary[], folders:
 *                      NotebookFolder[] }, live AND trashed notebooks (the
 *                      client splits them by deletedAt), most recently
 *                      changed first.
 * POST /api/notebooks  Create: JSON { id?, title, cover, folderId?,
 *                      workspaceId?, paper, firstPageId? } → { notebook }
 *                      (201; 200 when the id is already this student's
 *                      notebook: a retried create).
 *
 * Errors carry { code }: not_authenticated | invalid | too_large | not_found
 * (folder or workspace) | limit | rate_limited | busy | unavailable.
 */
export async function GET() {
  const { userId } = await auth();
  if (!userId) return errorResponse("not_authenticated", 401);
  if (!allowNotebookRead(userId)) return errorResponse("rate_limited", 429);
  try {
    return Response.json(await listNotebooks(userId), { headers: NO_STORE });
  } catch (error) {
    return toErrorResponse(error, { route: "/api/notebooks", method: "GET", userId });
  }
}

export async function POST(request: Request) {
  const crossSite = rejectCrossSite(request);
  if (crossSite) return crossSite;
  const { userId } = await auth();
  if (!userId) return errorResponse("not_authenticated", 401);
  if (!allowNotebookWrite(userId)) return errorResponse("rate_limited", 429);

  const read = await readJsonBody(request, MAX_META_BODY_BYTES);
  if (!read.ok) return errorResponse(read.status === 413 ? "too_large" : "invalid", read.status);
  const parsed = createNotebookSchema.safeParse(read.value);
  if (!parsed.success) return errorResponse("invalid", 400);

  try {
    const { notebook, created } = await createNotebook(userId, parsed.data);
    return Response.json({ notebook }, { status: created ? 201 : 200, headers: NO_STORE });
  } catch (error) {
    return toErrorResponse(error, { route: "/api/notebooks", method: "POST", userId });
  }
}
