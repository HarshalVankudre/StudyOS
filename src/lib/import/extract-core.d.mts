/** Types of extract-core.mjs (plain JavaScript so the child process can run it directly). */

export type SourceKind = "pdf" | "docx" | "text";

export type ExtractErrorCode =
  | "too_large"
  | "unsupported"
  | "no_text"
  | "unreadable"
  | "timeout"
  /** Every extraction slot on this server instance is taken; try again shortly. */
  | "busy";

export class ExtractError extends Error {
  readonly code: ExtractErrorCode;
  /** The detected file kind, when known (lets the UI say "scanned PDF"). */
  readonly kind?: SourceKind;
  constructor(code: ExtractErrorCode, detail?: string, kind?: SourceKind);
}

export interface ExtractedSource {
  kind: SourceKind;
  text: string;
  /** Characters of text found (before the cap). */
  totalChars: number;
  /** PDF only: pages in the document, pages read, and whether some were skipped. */
  pages?: number;
  pagesRead?: number;
  pagesTruncated?: boolean;
}

export interface ExtractedPages {
  kind: SourceKind;
  /** Tidied text of each page, in order (a page may be empty: a picture slide). */
  pages: string[];
  /**
   * True when `pages` are the document's own pages (every PDF; a .docx that
   * Word paginated). Otherwise `pages` holds the whole text as one entry and
   * the caller decides how to split it.
   */
  paginated: boolean;
  /** Characters kept across all pages. */
  totalChars: number;
  /** Pages in the original document (PDF and paginated .docx). */
  sourcePages: number;
  /** True when pages or text were left out because of the limits. */
  truncated: boolean;
}

/** Fully resolved limits of one run (extract.ts fills in the defaults). */
export interface ResolvedLimits {
  /** Epoch milliseconds after which PDF reading stops with "timeout". */
  deadline: number;
  maxBytes: number;
  maxPdfPages: number;
  maxChars: number;
  maxPdfInflatedBytes: number;
  maxDocxXmlBytes: number;
  /** Tests only: let PDF.js see the file unmeasured (exercises the memory cap). */
  skipPdfPrecheck?: boolean;
}

export interface ExtractionRequest {
  mode: "text" | "pages";
  bytes: Uint8Array;
  fileName: string;
  mimeType: string;
  limits: ResolvedLimits;
}

export type ExtractionOutcome =
  | { ok: true; value: ExtractedSource | ExtractedPages }
  | { ok: false; code: ExtractErrorCode | "internal"; detail: string; kind?: SourceKind };

export function detectSourceKind(
  bytes: Uint8Array,
  fileName: string,
  mimeType: string,
): SourceKind | null;
export function stripLineEnds(text: string, strip?: (code: number) => boolean): string;
export function tidy(text: string): string;
export function readZipEntry(bytes: Uint8Array, entryName: string, maxBytes: number): Uint8Array | null;
export function docxXmlToText(xml: string, maxChars: number): string;
export function assertPdfStreamsBounded(bytes: Uint8Array, maxBytes: number): void;
export function runExtraction(request: ExtractionRequest): Promise<ExtractionOutcome>;
