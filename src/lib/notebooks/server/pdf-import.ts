/**
 * Importing a PDF into notebooks (server-only): as a new notebook whose
 * pages are the PDF's pages (POST /api/notebooks/import-pdf), or inserted
 * into an existing notebook (POST /api/notebooks/:id/pdf).
 *
 * Steps, cheapest refusals first:
 *  1. The bytes: at most MAX_PDF_BYTES, and a PDF ("%PDF-" in the first
 *     1024 bytes, as PDF readers accept it).
 *  2. Pre-checks that need no parsing: the folder or notebook is the
 *     student's, there is room for another notebook / more pages, and the
 *     student's PDF storage (MAX_PDF_STORAGE_BYTES_PER_USER) has room.
 *  3. Layout extraction in the import's isolated, memory-capped child
 *     process (lib/import/extract extractPdfLayout, same pool and per-account
 *     share as the syllabus and material uploads): every page's size and its
 *     text layer. A scan without text is fine (its pages are backgrounds).
 *  4. The bytes are stored (./file-store.ts), then ONE transaction creates
 *     the file row and the pages, re-checking every cap under the student's
 *     lock. If that fails, the stored object is deleted again.
 *
 * Page size: PDF points (1/72 inch) to page units (1/96 inch), so a page
 * shows at its printed size at 100 % zoom; scaled down uniformly to fit
 * MAX_PAGE_SIDE, then each side clamped to at least MIN_PAGE_SIDE.
 */
import "server-only";

import { createHash } from "node:crypto";
import { prisma } from "@/lib/db";
import { ExtractError, extractPdfLayout } from "@/lib/import/extract";
import { readFormCapped } from "@/lib/import/upload-body";
import { reportError } from "@/lib/ops/report-error";
import {
  COVER_COLORS,
  MAX_NOTEBOOKS_PER_USER,
  MAX_PAGE_SIDE,
  MAX_PAGES_PER_NOTEBOOK,
  MAX_PDF_BYTES,
  MAX_PDF_PAGES,
  MAX_TITLE,
  MIN_PAGE_SIDE,
  newId,
  PAGE_SIZES,
  type NotebookDetail,
  type PageTemplate,
} from "../model";
import { errorResponse, NotebookError } from "./errors";
import { deletePdfObjects, putPdfBytes } from "./file-store";
import {
  MAX_NOTEBOOK_PDF_INFLATED_BYTES,
  MAX_PDF_FORM_BYTES,
  MAX_PDF_PAGE_TEXT,
  MAX_PDF_STORAGE_BYTES_PER_USER,
  MAX_PDF_TEXT_TOTAL,
  NOTEBOOK_PDF_TIMEOUT_MS,
} from "./limits";
import { createNotebook, findLiveNotebook, insertPdfPages, pdfStorageUsed, type NewFile, type NewPage } from "./store";

/** Imported pages are blank white paper under the PDF. */
export const PDF_PAGE_TEMPLATE: PageTemplate = { kind: "blank", paper: "white" };

/**
 * The multipart body of a PDF upload ({ file, ...fields }), read with a hard
 * cap (lib/import/upload-body): a declared size past it is refused unread,
 * a chunked or lying body is cut off at the cap. Answers 413 too_large past
 * the cap and 400 invalid for a body that is not a form with a file.
 */
export async function readPdfForm(
  request: Request,
): Promise<{ ok: true; form: FormData; file: File; bytes: Uint8Array } | { ok: false; response: Response }> {
  const form = await readFormCapped(request, MAX_PDF_FORM_BYTES);
  if (form === "too_large") return { ok: false, response: errorResponse("too_large", 413, { limit: "bytes" }) };
  const file = form?.get("file");
  if (!form || !(file instanceof File)) return { ok: false, response: errorResponse("invalid", 400) };
  if (file.size > MAX_PDF_BYTES) return { ok: false, response: errorResponse("too_large", 413, { limit: "bytes" }) };
  return { ok: true, form, file, bytes: new Uint8Array(await file.arrayBuffer()) };
}

/** True when `bytes` look like a PDF ("%PDF-" within the first 1024 bytes). */
export function isPdf(bytes: Uint8Array): boolean {
  return Buffer.from(bytes.buffer, bytes.byteOffset, Math.min(bytes.byteLength, 1024))
    .toString("latin1")
    .includes("%PDF-");
}

/** A PDF page's size in points as notebook page units (see the header). */
export function pdfPageSize(widthPt: number, heightPt: number): { width: number; height: number } {
  let width = (widthPt * 96) / 72;
  let height = (heightPt * 96) / 72;
  if (!(width > 0) || !(height > 0) || !Number.isFinite(width) || !Number.isFinite(height)) {
    return { ...PAGE_SIZES.a4 };
  }
  const scale = Math.min(1, MAX_PAGE_SIDE / Math.max(width, height));
  width *= scale;
  height *= scale;
  const side = (v: number) => Math.min(MAX_PAGE_SIDE, Math.max(MIN_PAGE_SIDE, Math.round(v)));
  return { width: side(width), height: side(height) };
}

/** A notebook title from an uploaded file name ("Lecture_3.pdf" → "Lecture 3"). */
export function titleFromFileName(name: string): string {
  const base = name.replace(/\.[A-Za-z0-9]{1,8}$/, "").replace(/_+/g, " ").trim();
  return (base || "PDF").slice(0, MAX_TITLE);
}

/** A file name safe to keep and echo back (no paths, no control characters). */
function cleanFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "";
  let clean = "";
  for (const ch of base) {
    const code = ch.codePointAt(0) ?? 0;
    if (code >= 0x20 && code !== 0x7f) clean += ch;
  }
  clean = clean.trim().slice(0, 200);
  return clean || "document.pdf";
}

interface PreparedPdf {
  pageCount: number;
  pages: { width: number; height: number; text: string }[];
  sha256: string;
}

function checkBytes(bytes: Uint8Array): void {
  if (bytes.byteLength > MAX_PDF_BYTES) throw new NotebookError("too_large", 413, { limit: "bytes" });
  if (bytes.byteLength === 0 || !isPdf(bytes)) throw new NotebookError("unsupported", 415);
}

async function checkStorage(ownerId: string, size: number): Promise<void> {
  if ((await pdfStorageUsed(prisma, ownerId)) + size > MAX_PDF_STORAGE_BYTES_PER_USER) {
    throw new NotebookError("limit", 422, { limit: "storage" });
  }
}

/** Map an extraction failure to the API's error. */
function extractionError(error: ExtractError): NotebookError {
  switch (error.code) {
    case "too_large":
      return new NotebookError("too_large", 413, {
        limit: /too many pages/.test(error.message) ? "pages" : "bytes",
      });
    case "unsupported":
      return new NotebookError("unsupported", 415);
    case "busy":
      // Every extraction process on this instance is taken, or this account
      // already has one running.
      return new NotebookError("busy", 503);
    case "timeout":
      return new NotebookError("unreadable", 422, { reason: "timeout" });
    default:
      return new NotebookError("unreadable", 422);
  }
}

async function extract(ownerId: string, bytes: Uint8Array): Promise<PreparedPdf> {
  try {
    const layout = await extractPdfLayout(bytes, {
      maxBytes: MAX_PDF_BYTES,
      maxPdfPages: MAX_PDF_PAGES,
      maxChars: MAX_PDF_TEXT_TOTAL,
      maxPageChars: MAX_PDF_PAGE_TEXT,
      maxPdfInflatedBytes: MAX_NOTEBOOK_PDF_INFLATED_BYTES,
      timeoutMs: NOTEBOOK_PDF_TIMEOUT_MS,
      owner: ownerId,
    });
    return {
      pageCount: layout.pageCount,
      pages: layout.pages.map((p) => ({ ...pdfPageSize(p.width, p.height), text: p.text.slice(0, MAX_PDF_PAGE_TEXT) })),
      sha256: createHash("sha256").update(bytes).digest("hex"),
    };
  } catch (error) {
    if (error instanceof ExtractError) throw extractionError(error);
    throw error;
  }
}

/** Store the bytes, then run `create`; the stored object is removed again if `create` fails. */
async function storeThen<T>(
  ownerId: string,
  bytes: Uint8Array,
  fileName: string,
  prepared: PreparedPdf,
  create: (file: NewFile) => Promise<T>,
): Promise<T> {
  const fileId = newId();
  const stored = await putPdfBytes(ownerId, fileId, bytes);
  const file: NewFile = {
    id: fileId,
    name: cleanFileName(fileName),
    mime: "application/pdf",
    sizeBytes: bytes.byteLength,
    sha256: prepared.sha256,
    pageCount: prepared.pageCount,
    storageKey: stored.storageKey,
    data: stored.data,
  };
  try {
    return await create(file);
  } catch (error) {
    if (stored.storageKey) {
      const { failed } = await deletePdfObjects([stored.storageKey]);
      if (failed > 0) {
        reportError(new Error("stored PDF of a failed import could not be deleted"), {
          source: "notebooks",
          userId: ownerId,
        });
      }
    }
    throw error;
  }
}

function pagesOf(prepared: PreparedPdf, fileId: string): Omit<NewPage, "position">[] {
  return prepared.pages.map((p, i) => ({
    id: newId(),
    template: PDF_PAGE_TEMPLATE,
    width: p.width,
    height: p.height,
    pdfFileId: fileId,
    pdfPage: i + 1,
    pdfText: p.text,
  }));
}

/** A new notebook made of the PDF's pages. */
export async function importPdfAsNotebook(
  ownerId: string,
  input: { bytes: Uint8Array; fileName: string; title?: string; folderId?: string | null },
): Promise<NotebookDetail> {
  checkBytes(input.bytes);
  if (input.folderId) {
    const folder = await prisma.notebookFolder.findFirst({ where: { id: input.folderId, ownerId }, select: { id: true } });
    if (!folder) throw new NotebookError("not_found", 404, { field: "folderId" });
  }
  if ((await prisma.notebook.count({ where: { ownerId } })) >= MAX_NOTEBOOKS_PER_USER) {
    throw new NotebookError("limit", 422, { limit: "notebooks" });
  }
  await checkStorage(ownerId, input.bytes.byteLength);

  const prepared = await extract(ownerId, input.bytes);
  const first = prepared.pages[0];
  const title = input.title?.trim().slice(0, MAX_TITLE) || titleFromFileName(input.fileName);
  return storeThen(ownerId, input.bytes, input.fileName, prepared, async (file) => {
    const pages = pagesOf(prepared, file.id).map((p, i) => ({ ...p, position: i + 1 }));
    const { notebook } = await createNotebook(ownerId, {
      title,
      // A stable cover per document: the same PDF gets the same color.
      cover: COVER_COLORS[parseInt(prepared.sha256.slice(0, 2), 16) % COVER_COLORS.length],
      folderId: input.folderId ?? null,
      // Pages added later get the imported pages' paper and orientation.
      paper: { template: PDF_PAGE_TEMPLATE, size: "a4", landscape: Boolean(first && first.width > first.height) },
      pages,
      file,
    });
    return notebook;
  });
}

/** The PDF's pages inserted after `afterPageId` (or at the end) of a live notebook. */
export async function importPdfIntoNotebook(
  ownerId: string,
  notebookId: string,
  input: { bytes: Uint8Array; fileName: string; afterPageId?: string | null },
): Promise<NotebookDetail> {
  checkBytes(input.bytes);
  if (!(await findLiveNotebook(prisma, ownerId, notebookId))) throw new NotebookError("not_found", 404);
  const pageCount = await prisma.notebookPage.count({ where: { notebookId, ownerId } });
  if (pageCount >= MAX_PAGES_PER_NOTEBOOK) throw new NotebookError("limit", 422, { limit: "pages" });
  await checkStorage(ownerId, input.bytes.byteLength);

  const prepared = await extract(ownerId, input.bytes);
  return storeThen(ownerId, input.bytes, input.fileName, prepared, (file) =>
    insertPdfPages(ownerId, notebookId, input.afterPageId ?? null, pagesOf(prepared, file.id), file),
  );
}
