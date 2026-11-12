/**
 * Server-side text extraction for syllabus uploads: PDF, Word (.docx) and
 * plain text / Markdown.
 *
 * The upload is untrusted, so extraction is deliberately boxed in:
 * - It only ever sees the uploaded bytes. Nothing here takes a path or URL,
 *   PDF.js gets no font/CMap/wasm locations (so it never touches the disk or
 *   network), and .docx parsing reads exactly one zip entry into memory.
 * - Size is capped before parsing (MAX_UPLOAD_BYTES) and decompression is
 *   capped while parsing: the one .docx entry is inflated in small chunks and
 *   abandoned past MAX_DOCX_XML_BYTES, and every zlib stream in a PDF is
 *   measured the same way before PDF.js runs, so a zip/flate bomb is refused
 *   instead of exhausting memory.
 * - Work is bounded: at most MAX_PDF_PAGES pages, at most MAX_EXTRACTED_CHARS
 *   of text, and an overall deadline (EXTRACTION_TIMEOUT_MS) checked between
 *   pages, after which the PDF.js task is destroyed.
 * - The .docx XML is scanned with a single linear tag walk (no nested regex),
 *   so hostile markup can't trigger catastrophic backtracking.
 *
 * The extracted text is still untrusted: callers pass it through
 * `normalizeSourceText` and `sourceTextBlock` (./syllabus), which fence it as
 * data in every prompt.
 */
import "server-only";
import { Unzip, UnzipInflate, Unzlib } from "fflate";
import { MAX_SOURCE_TEXT, MAX_UPLOAD_BYTES } from "./syllabus";

export { MAX_UPLOAD_BYTES };
/** Pages read from a PDF; a syllabus is rarely longer. */
export const MAX_PDF_PAGES = 60;
/**
 * Text kept from a file. More than the prompt will use (MAX_SOURCE_TEXT), so
 * the client can honestly tell the student how much material there was.
 */
export const MAX_EXTRACTED_CHARS = MAX_SOURCE_TEXT * 3;
export const EXTRACTION_TIMEOUT_MS = 15_000;
/** Cap on the inflated word/document.xml of a .docx. */
const MAX_DOCX_XML_BYTES = 30 * 1024 * 1024;
/** Cap on the inflated size of all zlib streams in a PDF. */
const MAX_PDF_INFLATED_BYTES = 80 * 1024 * 1024;
/** Feed decompressors this much compressed input at a time. */
const INFLATE_CHUNK = 16 * 1024;

export type ExtractErrorCode =
  | "too_large"
  | "unsupported"
  | "no_text"
  | "unreadable"
  | "timeout";

export class ExtractError extends Error {
  readonly code: ExtractErrorCode;
  /** The detected file kind, when known (lets the UI say "scanned PDF"). */
  readonly kind?: SourceKind;
  constructor(code: ExtractErrorCode, detail?: string, kind?: SourceKind) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = "ExtractError";
    this.code = code;
    this.kind = kind;
  }
}

export type SourceKind = "pdf" | "docx" | "text";

export interface ExtractedSource {
  kind: SourceKind;
  text: string;
  /** Characters of text found (before the MAX_EXTRACTED_CHARS cap). */
  totalChars: number;
  /** PDF only: pages in the document, pages read, and whether some were skipped. */
  pages?: number;
  pagesRead?: number;
  pagesTruncated?: boolean;
}

/** Decide the file kind from its leading bytes (the name/MIME only break ties). */
export function detectSourceKind(
  bytes: Uint8Array,
  fileName: string,
  mimeType: string,
): SourceKind | null {
  const name = fileName.toLowerCase();
  const head = Buffer.from(bytes.subarray(0, 1024)).toString("latin1");
  if (head.includes("%PDF-")) return "pdf";
  const isZip = bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
  if (isZip) {
    return name.endsWith(".docx") || mimeType.includes("wordprocessingml") ? "docx" : null;
  }
  // Legacy binary .doc (OLE) and anything else binary is not supported.
  if (bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0) return null;
  if (/\.(txt|md|markdown|text)$/.test(name) || mimeType.startsWith("text/")) return "text";
  return null;
}

/** Extract plain text from an uploaded file, or throw an ExtractError. */
export async function extractSourceText(
  bytes: Uint8Array,
  fileName: string,
  mimeType: string,
  options: { timeoutMs?: number } = {},
): Promise<ExtractedSource> {
  if (bytes.byteLength === 0) throw new ExtractError("no_text", "empty file");
  if (bytes.byteLength > MAX_UPLOAD_BYTES) throw new ExtractError("too_large");
  const kind = detectSourceKind(bytes, fileName, mimeType);
  if (!kind) throw new ExtractError("unsupported");

  const deadline = Date.now() + (options.timeoutMs ?? EXTRACTION_TIMEOUT_MS);
  let raw: string;
  let pdfInfo: Pick<ExtractedSource, "pages" | "pagesRead" | "pagesTruncated"> = {};
  if (kind === "pdf") {
    const { text, ...info } = await extractPdf(bytes, deadline);
    raw = text;
    pdfInfo = info;
  } else if (kind === "docx") {
    raw = extractDocx(bytes);
  } else {
    raw = decodeText(bytes);
  }

  const text = tidy(raw);
  const meaningful = text.replace(/\s+/g, "").length;
  if (meaningful < 20) {
    // A PDF with pages but no text layer is a scan (or images of text).
    throw new ExtractError("no_text", "no text layer", kind);
  }
  return {
    kind,
    text: text.slice(0, MAX_EXTRACTED_CHARS),
    totalChars: text.length,
    ...pdfInfo,
  };
}

function tidy(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t ]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// ---------------------------------------------------------------------------
// Plain text
// ---------------------------------------------------------------------------

function decodeText(bytes: Uint8Array): string {
  let text: string;
  if (bytes[0] === 0xff && bytes[1] === 0xfe) {
    text = new TextDecoder("utf-16le").decode(bytes.subarray(2));
  } else if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    text = new TextDecoder("utf-16be").decode(bytes.subarray(2));
  } else {
    text = new TextDecoder("utf-8").decode(bytes).replace(/^﻿/, "");
  }
  // Lots of NULs means this was a binary file with a text-looking name.
  const nulCount = (text.slice(0, 4096).match(/\u0000/g) ?? []).length;
  if (nulCount > 8) throw new ExtractError("unsupported", "binary content");
  return text;
}

// ---------------------------------------------------------------------------
// .docx
// ---------------------------------------------------------------------------

function extractDocx(bytes: Uint8Array): string {
  const xml = readZipEntry(bytes, "word/document.xml", MAX_DOCX_XML_BYTES);
  if (xml === null) throw new ExtractError("unreadable", "no word/document.xml");
  return docxXmlToText(new TextDecoder("utf-8").decode(xml));
}

/**
 * Inflate one entry of a zip, refusing to produce more than `maxBytes`.
 * Returns null when the entry is missing. Throws too_large past the cap and
 * unreadable on a corrupt or encrypted archive.
 */
export function readZipEntry(
  bytes: Uint8Array,
  entryName: string,
  maxBytes: number,
): Uint8Array | null {
  const chunks: Uint8Array[] = [];
  let size = 0;
  let found = false;
  let finished = false;
  let overflow = false;
  let failure: unknown = null;

  const unzip = new Unzip();
  unzip.register(UnzipInflate);
  unzip.onfile = (file) => {
    if (file.name !== entryName || found) return;
    found = true;
    file.ondata = (error, data, final) => {
      if (overflow || failure) return;
      if (error) {
        failure = error;
        return;
      }
      size += data.length;
      if (size > maxBytes) {
        overflow = true;
        try {
          file.terminate();
        } catch {
          // Already stopped.
        }
        return;
      }
      chunks.push(data);
      if (final) finished = true;
    };
    try {
      file.start();
    } catch (error) {
      failure = error;
    }
  };

  try {
    for (let offset = 0; offset < bytes.length; offset += INFLATE_CHUNK) {
      if (overflow || failure || finished) break;
      const end = Math.min(offset + INFLATE_CHUNK, bytes.length);
      unzip.push(bytes.subarray(offset, end), end === bytes.length);
    }
  } catch (error) {
    if (!overflow) failure = error;
  }

  if (overflow) throw new ExtractError("too_large", "document expands beyond the limit");
  if (failure) throw new ExtractError("unreadable", String(failure));
  if (!found) return null;
  if (!finished) throw new ExtractError("unreadable", "truncated archive");
  const out = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.length;
  }
  return out;
}

/**
 * Text of a WordprocessingML body: runs (`w:t`) in reading order, tabs and
 * line breaks kept, paragraphs and table rows on new lines, table cells
 * separated by tabs (so a grading table stays "Midterm<TAB>25%").
 */
export function docxXmlToText(xml: string): string {
  const out: string[] = [];
  let inText = false;
  let cellDepth = 0;
  let cursor = 0;
  let length = 0;
  const tag = /<[^>]*>/g;
  let match: RegExpExecArray | null;
  while ((match = tag.exec(xml)) !== null) {
    if (inText && match.index > cursor) {
      const piece = decodeXmlEntities(xml.slice(cursor, match.index));
      out.push(piece);
      length += piece.length;
    }
    cursor = match.index + match[0].length;
    if (length > MAX_EXTRACTED_CHARS * 2) break;

    const raw = match[0];
    const closing = raw.startsWith("</");
    const selfClosing = raw.endsWith("/>");
    const name = raw.slice(closing ? 2 : 1).match(/^[A-Za-z0-9_:.-]+/)?.[0] ?? "";
    switch (name) {
      case "w:t":
        inText = !closing && !selfClosing;
        break;
      case "w:tab":
        if (!closing) out.push("\t");
        break;
      case "w:br":
      case "w:cr":
        if (!closing) out.push("\n");
        break;
      case "w:p":
        // Inside a table cell, paragraphs join with a space so a row stays on one line.
        if (closing) out.push(cellDepth > 0 ? " " : "\n");
        break;
      case "w:tc":
        if (selfClosing) break;
        if (closing) {
          cellDepth = Math.max(0, cellDepth - 1);
          out.push("\t");
        } else {
          cellDepth += 1;
        }
        break;
      case "w:tr":
        if (closing) out.push("\n");
        break;
      default:
        break;
    }
  }
  return out.join("").replace(/ \t/g, "\t").replace(/\t+\n/g, "\n");
}

function decodeXmlEntities(text: string): string {
  return text.replace(/&(#x[0-9a-fA-F]{1,6}|#\d{1,7}|amp|lt|gt|quot|apos);/g, (_, entity: string) => {
    switch (entity) {
      case "amp":
        return "&";
      case "lt":
        return "<";
      case "gt":
        return ">";
      case "quot":
        return '"';
      case "apos":
        return "'";
      default: {
        const code =
          entity[1] === "x" ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
        return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "";
      }
    }
  });
}

// ---------------------------------------------------------------------------
// PDF
// ---------------------------------------------------------------------------

/** Refuse PDFs whose zlib streams would inflate past the cap (flate bombs). */
export function assertPdfStreamsBounded(bytes: Uint8Array, maxBytes = MAX_PDF_INFLATED_BYTES) {
  const buf = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let position = 0;
  let total = 0;
  while (position < buf.length) {
    const keyword = buf.indexOf("stream", position, "latin1");
    if (keyword === -1) return;
    if (keyword >= 3 && buf.toString("latin1", keyword - 3, keyword) === "end") {
      position = keyword + 6;
      continue;
    }
    let start = keyword + 6;
    if (buf[start] === 0x0d) start += 1;
    if (buf[start] === 0x0a) start += 1;
    const end = buf.indexOf("endstream", start, "latin1");
    if (end === -1) return;
    // 0x78 is the zlib header FlateDecode streams start with.
    if (buf[start] === 0x78) {
      total += inflatedSize(buf.subarray(start, end), maxBytes - total);
      if (total > maxBytes) throw new ExtractError("too_large", "PDF expands beyond the limit");
    }
    position = end + 9;
  }
}

function inflatedSize(data: Uint8Array, budget: number): number {
  let size = 0;
  let over = false;
  const inflater = new Unzlib((chunk) => {
    size += chunk.length;
    if (size > budget) over = true;
  });
  try {
    for (let offset = 0; offset < data.length && !over; offset += INFLATE_CHUNK) {
      const end = Math.min(offset + INFLATE_CHUNK, data.length);
      inflater.push(data.subarray(offset, end), end === data.length);
    }
  } catch {
    // A corrupt stream; PDF.js decides what to do with it.
  }
  return size;
}

interface TextItemLike {
  str?: string;
  hasEOL?: boolean;
}

async function extractPdf(
  bytes: Uint8Array,
  deadline: number,
): Promise<{ text: string; pages: number; pagesRead: number; pagesTruncated: boolean }> {
  assertPdfStreamsBounded(bytes);

  const { getResolvedPDFJS } = await import("unpdf");
  const pdfjs = await getResolvedPDFJS();
  // PDF.js may transfer (detach) the buffer it is given, so hand it a copy.
  const task = pdfjs.getDocument({
    data: new Uint8Array(bytes),
    // No font/CMap/wasm locations: PDF.js never reads files or the network.
    useSystemFonts: false,
    disableFontFace: true,
    useWasm: false,
    enableXfa: false,
    stopAtErrors: false,
    isOffscreenCanvasSupported: false,
    verbosity: 0,
  });

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new ExtractError("timeout")),
      Math.max(0, deadline - Date.now()),
    );
  });

  const work = (async () => {
    let document;
    try {
      document = await task.promise;
    } catch (error) {
      // Password-protected, damaged, or not really a PDF.
      throw new ExtractError("unreadable", error instanceof Error ? error.name : "load failed");
    }
    const pages = document.numPages;
    const readPages = Math.min(pages, MAX_PDF_PAGES);
    const parts: string[] = [];
    let length = 0;
    for (let number = 1; number <= readPages; number += 1) {
      if (Date.now() > deadline) throw new ExtractError("timeout");
      const page = await document.getPage(number);
      const content = await page.getTextContent();
      const pageText = (content.items as TextItemLike[])
        .map((item) => (item.str ?? "") + (item.hasEOL ? "\n" : ""))
        .join("");
      page.cleanup();
      parts.push(pageText);
      length += pageText.length;
      if (length > MAX_EXTRACTED_CHARS * 2) break;
    }
    return {
      text: parts.join("\n\n"),
      pages,
      pagesRead: readPages,
      pagesTruncated: pages > readPages,
    };
  })();

  try {
    return await Promise.race([work, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
    // Always release PDF.js resources (also stops work after a timeout).
    void task.destroy().catch(() => {});
    work.catch(() => {});
  }
}
