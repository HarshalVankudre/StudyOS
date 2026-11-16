import { auth } from "@clerk/nextjs/server";
import { rejectCrossSite } from "@/lib/http/same-origin";
import { errorResponse, toErrorResponse } from "@/lib/notebooks/server/errors";
import { allowNotebookWrite, readJsonBody } from "@/lib/notebooks/server/guard";
import { MAX_META_BODY_BYTES } from "@/lib/notebooks/server/limits";
import { idSchema, renameFolderSchema } from "@/lib/notebooks/server/schemas";
import { deleteFolder, renameFolder } from "@/lib/notebooks/server/store";

export const runtime = "nodejs";

type Props = { params: Promise<{ folderId: string }> };

/**
 * PATCH  /api/notebooks/folders/:folderId  JSON { name } → { folder }.
 * DELETE /api/notebooks/folders/:folderId  → { deleted: true }; the folder's
 *                                         notebooks move to the shelf's root.
 * Someone else's folder is a 404.
 */
export async function PATCH(request: Request, { params }: Props) {
  const crossSite = rejectCrossSite(request);
  if (crossSite) return crossSite;
  const { userId } = await auth();
  if (!userId) return errorResponse("not_authenticated", 401);
  if (!allowNotebookWrite(userId)) return errorResponse("rate_limited", 429);
  const { folderId } = await params;
  if (!idSchema.safeParse(folderId).success) return errorResponse("not_found", 404);

  const read = await readJsonBody(request, MAX_META_BODY_BYTES);
  if (!read.ok) return errorResponse(read.status === 413 ? "too_large" : "invalid", read.status);
  const parsed = renameFolderSchema.safeParse(read.value);
  if (!parsed.success) return errorResponse("invalid", 400);
  try {
    const folder = await renameFolder(userId, folderId, parsed.data.name);
    if (!folder) return errorResponse("not_found", 404);
    return Response.json({ folder }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return toErrorResponse(error, { route: "/api/notebooks/folders/[folderId]", method: "PATCH", userId });
  }
}

export async function DELETE(request: Request, { params }: Props) {
  const crossSite = rejectCrossSite(request);
  if (crossSite) return crossSite;
  const { userId } = await auth();
  if (!userId) return errorResponse("not_authenticated", 401);
  if (!allowNotebookWrite(userId)) return errorResponse("rate_limited", 429);
  const { folderId } = await params;
  if (!idSchema.safeParse(folderId).success) return errorResponse("not_found", 404);
  try {
    if (!(await deleteFolder(userId, folderId))) return errorResponse("not_found", 404);
    return Response.json({ deleted: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return toErrorResponse(error, { route: "/api/notebooks/folders/[folderId]", method: "DELETE", userId });
  }
}
