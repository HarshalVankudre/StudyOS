import { auth } from "@clerk/nextjs/server";
import { rejectCrossSite } from "@/lib/http/same-origin";
import { errorResponse, toErrorResponse } from "@/lib/notebooks/server/errors";
import { acquireImportSlot } from "@/lib/notebooks/server/guard";
import { importPdfAsNotebook, readPdfForm } from "@/lib/notebooks/server/pdf-import";
import { idSchema, titleSchema } from "@/lib/notebooks/server/schemas";
import { checkUsageLimit } from "@/lib/usage-limits";

export const runtime = "nodejs";
// Up to 30 MB of upload, a 50 s extraction and the storage upload.
export const maxDuration = 120;

/**
 * POST /api/notebooks/import-pdf  multipart { file, title?, folderId? } → a
 * new notebook whose pages are the PDF's pages (blank white paper under each
 * PDF page, the page's printed size, its text layer kept for search) →
 * { notebook: NotebookDetail } (201). See lib/notebooks/server/pdf-import.ts.
 *
 * Errors carry { code }: not_authenticated | invalid | too_large (413;
 * { limit: "bytes" } past MAX_PDF_BYTES, { limit: "pages" } past
 * MAX_PDF_PAGES) | unsupported (415: not a PDF) | unreadable (422: damaged,
 * encrypted, or { reason: "timeout" }) | not_found (folder) | limit (422;
 * { limit: "notebooks" | "storage" }) | rate_limited (429: the hourly
 * notebook_pdf limit) | busy (429: an import of this student is running;
 * 503: every extraction process is taken) | unavailable.
 */
export async function POST(request: Request) {
  const crossSite = rejectCrossSite(request);
  if (crossSite) return crossSite;
  const { userId } = await auth();
  if (!userId) return errorResponse("not_authenticated", 401);

  // One import at a time per student, taken before the 30 MB body is read.
  const release = acquireImportSlot(userId);
  if (!release) return errorResponse("busy", 429);
  try {
    const read = await readPdfForm(request);
    if (!read.ok) return read.response;
    const title = titleSchema.optional().safeParse(read.form.get("title") ?? undefined);
    const rawFolder = read.form.get("folderId");
    const folderId = idSchema.optional().safeParse(rawFolder === null || rawFolder === "" ? undefined : rawFolder);
    if (!title.success || !folderId.success) return errorResponse("invalid", 400);

    if (!(await checkUsageLimit(userId, "notebook_pdf")).allowed) return errorResponse("rate_limited", 429);
    const notebook = await importPdfAsNotebook(userId, {
      bytes: read.bytes,
      fileName: read.file.name,
      title: title.data,
      folderId: folderId.data ?? null,
    });
    return Response.json({ notebook }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return toErrorResponse(error, { route: "/api/notebooks/import-pdf", method: "POST", userId });
  } finally {
    release();
  }
}
