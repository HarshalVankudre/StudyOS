import { auth } from "@clerk/nextjs/server";
import { rejectCrossSite } from "@/lib/http/same-origin";
import { errorResponse, toErrorResponse } from "@/lib/notebooks/server/errors";
import { allowNotebookRead, allowNotebookWrite, readJsonBody } from "@/lib/notebooks/server/guard";
import { MAX_META_BODY_BYTES } from "@/lib/notebooks/server/limits";
import { idSchema, patchNotebookSchema } from "@/lib/notebooks/server/schemas";
import { deleteNotebookForever, getNotebook, updateNotebook } from "@/lib/notebooks/server/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Props = { params: Promise<{ id: string }> };

const NO_STORE = { "Cache-Control": "no-store" };

/**
 * GET    /api/notebooks/:id  The notebook with its pages in order (no ink):
 *                            { notebook: NotebookDetail }.
 * PATCH  /api/notebooks/:id  JSON with any of { title, cover, folderId,
 *                            workspaceId, paper, trashed } → { notebook }.
 *                            trashed: true moves it to the trash, false
 *                            restores it (the only change a trashed notebook
 *                            accepts; other fields may come along).
 * DELETE /api/notebooks/:id  Permanently delete a notebook IN THE TRASH, with
 *                            its pages and imported PDFs → { deleted: true }.
 *
 * Someone else's notebook (or, except for restore and delete, one in the
 * trash) is a 404: an answer never reveals that it exists.
 */
export async function GET(_request: Request, { params }: Props) {
  const { userId } = await auth();
  if (!userId) return errorResponse("not_authenticated", 401);
  if (!allowNotebookRead(userId)) return errorResponse("rate_limited", 429);
  const { id } = await params;
  if (!idSchema.safeParse(id).success) return errorResponse("not_found", 404);
  try {
    const notebook = await getNotebook(userId, id);
    if (!notebook) return errorResponse("not_found", 404);
    return Response.json({ notebook }, { headers: NO_STORE });
  } catch (error) {
    return toErrorResponse(error, { route: "/api/notebooks/[id]", method: "GET", userId });
  }
}

export async function PATCH(request: Request, { params }: Props) {
  const crossSite = rejectCrossSite(request);
  if (crossSite) return crossSite;
  const { userId } = await auth();
  if (!userId) return errorResponse("not_authenticated", 401);
  if (!allowNotebookWrite(userId)) return errorResponse("rate_limited", 429);
  const { id } = await params;
  if (!idSchema.safeParse(id).success) return errorResponse("not_found", 404);

  const read = await readJsonBody(request, MAX_META_BODY_BYTES);
  if (!read.ok) return errorResponse(read.status === 413 ? "too_large" : "invalid", read.status);
  const parsed = patchNotebookSchema.safeParse(read.value);
  if (!parsed.success) return errorResponse("invalid", 400);

  try {
    const notebook = await updateNotebook(userId, id, parsed.data);
    if (!notebook) return errorResponse("not_found", 404);
    return Response.json({ notebook }, { headers: NO_STORE });
  } catch (error) {
    return toErrorResponse(error, { route: "/api/notebooks/[id]", method: "PATCH", userId });
  }
}

export async function DELETE(request: Request, { params }: Props) {
  const crossSite = rejectCrossSite(request);
  if (crossSite) return crossSite;
  const { userId } = await auth();
  if (!userId) return errorResponse("not_authenticated", 401);
  if (!allowNotebookWrite(userId)) return errorResponse("rate_limited", 429);
  const { id } = await params;
  if (!idSchema.safeParse(id).success) return errorResponse("not_found", 404);
  try {
    if (!(await deleteNotebookForever(userId, id))) return errorResponse("not_found", 404);
    return Response.json({ deleted: true }, { headers: NO_STORE });
  } catch (error) {
    return toErrorResponse(error, { route: "/api/notebooks/[id]", method: "DELETE", userId });
  }
}
