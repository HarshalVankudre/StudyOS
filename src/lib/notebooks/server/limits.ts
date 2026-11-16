/**
 * Server-side limits of the notebooks feature (the shared ones, such as
 * MAX_PAGES_PER_NOTEBOOK and MAX_PDF_BYTES, live in ../model.ts so the
 * client can check them before sending).
 *
 * Why these numbers:
 * - PDF storage: 1 GB per student across every imported PDF. A semester of
 *   lecture slides is a few hundred MB; the cap stops one account from using
 *   the bucket (or, without a bucket, the database) as free file hosting.
 * - PDF text: a page's text layer is kept for search (and later study kits)
 *   up to 20,000 characters (a dense page is ~5,000), and 2,000,000 characters
 *   per PDF, so a 500-page textbook keeps all of its text while a hostile
 *   file cannot make one row huge.
 * - Extraction: 50 s inside the import's isolated, memory-capped extraction
 *   pool (lib/import/extract), whose hard ceiling is 60 s. Page sizes are
 *   cheap; if text reading runs long, later pages keep their size and lose
 *   only their search text (lib/import/extract-core.mjs extractPdfLayout).
 * - Ink reads: 20 pages per request (each page's blob is at most 6 MB).
 * - Handwriting recognition: one page image of at most 2 MB, PNG or JPEG;
 *   the recognised text is kept up to 20,000 characters.
 */
import { MAX_PDF_BYTES } from "../model";

export const MAX_PDF_STORAGE_BYTES_PER_USER = 1024 * 1024 * 1024;
export const MAX_PDF_PAGE_TEXT = 20_000;
export const MAX_PDF_TEXT_TOTAL = 2_000_000;
export const NOTEBOOK_PDF_TIMEOUT_MS = 50_000;
/** Decoded size of all streams in an imported PDF (the extraction's early refusal). */
export const MAX_NOTEBOOK_PDF_INFLATED_BYTES = 400 * 1024 * 1024;
/** Multipart overhead allowed on top of the file itself. */
export const PDF_FORM_OVERHEAD_BYTES = 64 * 1024;
export const MAX_PDF_FORM_BYTES = MAX_PDF_BYTES + PDF_FORM_OVERHEAD_BYTES;

export const MAX_INK_PAGES_PER_READ = 20;

export const MAX_RECOGNIZE_IMAGE_BYTES = 2 * 1024 * 1024;
/** JSON body of a recognize request: the base64 image (4/3 of the bytes) plus the other fields. */
export const MAX_RECOGNIZE_BODY_BYTES = Math.ceil((MAX_RECOGNIZE_IMAGE_BYTES * 4) / 3) + 16 * 1024;
export const MAX_INK_TEXT = 20_000;

/** JSON bodies of the metadata routes (create, patch, folders). */
export const MAX_META_BODY_BYTES = 16 * 1024;

/** Lock key serialising every change to one notebook's pages and ink. */
export function notebookLockKey(notebookId: string): string {
  return `studyos:notebook:${notebookId}`;
}
