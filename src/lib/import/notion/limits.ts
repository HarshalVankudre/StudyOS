/**
 * Limits of the Notion import (src/lib/import/notion). One place for every
 * number, so the route, the dialog and the tests agree.
 *
 * Archive limits refuse the whole upload (it is not something we can safely
 * read). Content caps import what fits and report the rest as skipped.
 */
import { MAX_WORKSPACE_BYTES } from "@/lib/workspace/repair";

export const NOTION_IMPORT_LIMITS = {
  // ---- The archive (refused when passed) --------------------------------
  /**
   * Largest upload accepted. Kept well inside what the 2 GB server can hold
   * for two imports at once (the proxy buffers the body, the route reads it,
   * the parser inflates it); most of a large export's weight is attachments
   * the import drops anyway.
   */
  maxUploadBytes: 25 * 1024 * 1024,
  /** Uncompressed bytes in all, declared and actually inflated, nested zips included. */
  maxTotalBytes: 120 * 1024 * 1024,
  /** Entries in all archives together (folders count). */
  maxEntries: 5_000,
  /** Zips inside zips: the upload is level 1, Notion's "Part-N.zip" files level 2. */
  maxDepth: 2,
  /** An entry inflating more than this many times its compressed size looks like a bomb... */
  maxRatio: 100,
  /** ...once it is at least this large (small files compress well legitimately). */
  ratioMinBytes: 1024 * 1024,
  /** Longest entry path read. */
  maxPathLength: 1_024,

  // ---- Content (what fits is imported, the rest reported) ---------------
  maxPages: 500,
  maxDatabases: 100,
  maxRowsPerDatabase: 2_000,
  maxColumns: 50,
  /** Text kept from one page; the rest of the page is left out. */
  maxPageChars: 100_000,
  /** Blocks kept from one page. */
  maxBlocksPerPage: 1_500,
  /** Text of one block or cell. */
  maxBlockChars: 20_000,
  maxCellChars: 5_000,
  /** Markdown read from one file (longer files are cut before parsing). */
  maxSourceChars: 250_000,
  /** Images stored as media (when storage is available). */
  maxImages: 100,
  maxImageBytes: 5_000_000,
  /** Room left in the stored document for what the save adds around it. */
  workspaceBytes: MAX_WORKSPACE_BYTES - 64 * 1024,
  /** Time for reading and converting the archive. */
  timeoutMs: 25_000,
} as const;

export type NotionImportLimits = { -readonly [K in keyof typeof NOTION_IMPORT_LIMITS]: number };

/** Why an upload was refused as a whole. */
export type NotionImportErrorCode =
  | "not_zip"
  | "not_notion"
  | "too_large"
  | "too_many_files"
  | "unsafe"
  | "encrypted"
  | "corrupt"
  | "timeout";

export class NotionImportError extends Error {
  readonly code: NotionImportErrorCode;
  constructor(code: NotionImportErrorCode, detail?: string) {
    // The detail names a limit or a structure, never file contents.
    super(detail ? `${code}: ${detail}` : code);
    this.name = "NotionImportError";
    this.code = code;
  }
}

/** What was left out of an import, and why. */
export type SkipReason =
  | "page_limit"
  | "database_limit"
  | "row_limit"
  | "column_limit"
  | "size_limit"
  | "truncated"
  | "image"
  | "attachment"
  | "nested_zip"
  | "unreadable";

export const SKIP_REASONS: readonly SkipReason[] = [
  "page_limit",
  "database_limit",
  "row_limit",
  "column_limit",
  "size_limit",
  "truncated",
  "image",
  "attachment",
  "nested_zip",
  "unreadable",
];

export interface SkippedItems {
  reason: SkipReason;
  count: number;
  /** A few names (file names or page titles), for the summary. */
  examples: string[];
}

export interface NotionImportSummary {
  pages: number;
  databases: number;
  rows: number;
  images: number;
  skipped: SkippedItems[];
}

/** Collects skipped items by reason (at most a few example names each). */
export class SkipLog {
  private readonly items = new Map<SkipReason, SkippedItems>();

  add(reason: SkipReason, name?: string, count = 1): void {
    if (count <= 0) return;
    const entry = this.items.get(reason) ?? { reason, count: 0, examples: [] };
    entry.count += count;
    const label = name?.trim();
    if (label && entry.examples.length < 3 && !entry.examples.includes(label)) {
      entry.examples.push(label.length > 80 ? `${label.slice(0, 79)}…` : label);
    }
    this.items.set(reason, entry);
  }

  list(): SkippedItems[] {
    return SKIP_REASONS.map((r) => this.items.get(r)).filter((x): x is SkippedItems => Boolean(x));
  }
}
