import { auth } from "@clerk/nextjs/server";
import { rejectCrossSite } from "@/lib/http/same-origin";
import { errorResponse, toErrorResponse } from "@/lib/notebooks/server/errors";
import { allowNotebookWrite, readJsonBody } from "@/lib/notebooks/server/guard";
import { MAX_META_BODY_BYTES } from "@/lib/notebooks/server/limits";
import { createFolderSchema } from "@/lib/notebooks/server/schemas";
import { createFolder } from "@/lib/notebooks/server/store";

export const runtime = "nodejs";

/**
 * POST /api/notebooks/folders  JSON { id?, name } → { folder: NotebookFolder }
 * (201). A retried create with the same id returns the folder. Folders are
 * listed by GET /api/notebooks.
 *
 * Errors carry { code }: not_authenticated | invalid (schema; 409: the id is
 * taken) | too_large | limit (422 { limit: "folders" }) | rate_limited | busy | unavailable.
 */
export async function POST(request: Request) {
  const crossSite = rejectCrossSite(request);
  if (crossSite) return crossSite;
  const { userId } = await auth();
  if (!userId) return errorResponse("not_authenticated", 401);
  if (!allowNotebookWrite(userId)) return errorResponse("rate_limited", 429);

  const read = await readJsonBody(request, MAX_META_BODY_BYTES);
  if (!read.ok) return errorResponse(read.status === 413 ? "too_large" : "invalid", read.status);
  const parsed = createFolderSchema.safeParse(read.value);
  if (!parsed.success) return errorResponse("invalid", 400);
  try {
    const folder = await createFolder(userId, parsed.data);
    return Response.json({ folder }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return toErrorResponse(error, { route: "/api/notebooks/folders", method: "POST", userId });
  }
}
