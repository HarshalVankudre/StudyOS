import { auth } from "@clerk/nextjs/server";
import { rejectCrossSite } from "@/lib/http/same-origin";
import { errorResponse, toErrorResponse } from "@/lib/notebooks/server/errors";
import { acquireImportSlot } from "@/lib/notebooks/server/guard";
import { importPdfIntoNotebook, readPdfForm } from "@/lib/notebooks/server/pdf-import";
import { idSchema } from "@/lib/notebooks/server/schemas";
import { checkUsageLimit } from "@/lib/usage-limits";

export const runtime = "nodejs";
// Up to 30 MB of upload, a 50 s extraction and the storage upload.
export const maxDuration = 120;

type Props = { params: Promise<{ id: string }> };

/**
 * POST /api/notebooks/:id/pdf  multipart { file, afterPageId? } → the PDF's
 * pages inserted after that page (at the end when it is missing or no longer
 * in the notebook) → { notebook: NotebookDetail } (the notebook's version
 * is bumped). Same checks and errors as /api/notebooks/import-pdf, plus
 * not_found for a notebook that is not the student's live notebook and
 * limit { limit: "pages" } past MAX_PAGES_PER_NOTEBOOK.
 */
export async function POST(request: Request, { params }: Props) {
  const crossSite = rejectCrossSite(request);
  if (crossSite) return crossSite;
  const { userId } = await auth();
  if (!userId) return errorResponse("not_authenticated", 401);
  const { id } = await params;
  if (!idSchema.safeParse(id).success) return errorResponse("not_found", 404);

  const release = acquireImportSlot(userId);
  if (!release) return errorResponse("busy", 429);
  try {
    const read = await readPdfForm(request);
    if (!read.ok) return read.response;
    const rawAfter = read.form.get("afterPageId");
    const after = idSchema.optional().safeParse(rawAfter === null || rawAfter === "" ? undefined : rawAfter);
    if (!after.success) return errorResponse("invalid", 400);

    if (!(await checkUsageLimit(userId, "notebook_pdf")).allowed) return errorResponse("rate_limited", 429);
    const notebook = await importPdfIntoNotebook(userId, id, {
      bytes: read.bytes,
      fileName: read.file.name,
      afterPageId: after.data ?? null,
    });
    return Response.json({ notebook }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return toErrorResponse(error, { route: "/api/notebooks/[id]/pdf", method: "POST", userId });
  } finally {
    release();
  }
}
