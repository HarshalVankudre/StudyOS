/**
 * Notebooks: the shared data model (pure, client- and server-safe).
 *
 * A notebook is an ordered list of pages; a page is a fixed-size sheet with a
 * paper template (or a PDF page as its background) and a set of ink strokes.
 * Coordinates are page units: one unit is one CSS pixel at 100 % zoom
 * (1/96 inch), origin at the page's top-left corner.
 *
 * Ink is stored per page as a compact binary blob (./codec.ts) and changed
 * through stroke ops (./ops.ts): `put` (add or replace a stroke by id) and
 * `del` (remove a stroke by id). Both are idempotent and commute across
 * different ids, so two devices editing one page merge without conflicts
 * (last writer wins per stroke) and a retried batch is harmless.
 */

// ---- Strokes ----------------------------------------------------------------

/** How a stroke is drawn. Stored as one byte (index in this list). */
export const STROKE_KINDS = ["fountain", "ballpoint", "highlighter"] as const;
export type StrokeKind = (typeof STROKE_KINDS)[number];

export interface Stroke {
  /** Unique within the page; client-generated (see newId). */
  id: string;
  kind: StrokeKind;
  /** "#rrggbb". */
  color: string;
  /** Nominal diameter in page units. */
  width: number;
  /**
   * Samples, flat: x0, y0, p0, x1, y1, p1, … (page units; pressure 0..1).
   * Kept as a plain array so it can be appended to while drawing.
   */
  points: number[];
}

export const MIN_STROKE_WIDTH = 0.25;
export const MAX_STROKE_WIDTH = 80;
/** Samples per stroke (a minute of continuous 240 Hz pencil input is ~14k). */
export const MAX_STROKE_POINTS = 20_000;
/** Strokes per page. */
export const MAX_PAGE_STROKES = 20_000;
/** Encoded ink per page. */
export const MAX_PAGE_INK_BYTES = 6 * 1024 * 1024;

// ---- Pages ------------------------------------------------------------------

export const TEMPLATE_KINDS = ["blank", "ruled", "narrow", "grid", "dots", "cornell"] as const;
export type TemplateKind = (typeof TEMPLATE_KINDS)[number];

export const PAPER_COLORS = ["white", "cream", "dark"] as const;
export type PaperColor = (typeof PAPER_COLORS)[number];

export interface PageTemplate {
  kind: TemplateKind;
  paper: PaperColor;
}

export const DEFAULT_TEMPLATE: PageTemplate = { kind: "ruled", paper: "white" };

export const PAGE_SIZES = {
  a4: { width: 794, height: 1123 },
  letter: { width: 816, height: 1056 },
} as const;
export type PageSizeName = keyof typeof PAGE_SIZES;

export const MIN_PAGE_SIDE = 100;
export const MAX_PAGE_SIDE = 5000;

/** A page as listed with its notebook (ink is loaded separately). */
export interface PageMeta {
  id: string;
  /** Fractional order key: pages sort ascending by it. */
  position: number;
  template: PageTemplate;
  width: number;
  height: number;
  /** A PDF page drawn as the background, when the page came from an import. */
  pdf: { fileId: string; page: number } | null;
  /** Bumped by the server on every ink change. */
  inkVersion: number;
  strokeCount: number;
}

// ---- Notebooks ----------------------------------------------------------------

export const COVER_COLORS = [
  "slate", "red", "orange", "amber", "lime", "emerald", "teal", "sky", "indigo", "violet", "pink", "stone",
] as const;
export type CoverColor = (typeof COVER_COLORS)[number];

export interface NotebookPaper {
  template: PageTemplate;
  size: PageSizeName;
  landscape: boolean;
}

export const DEFAULT_PAPER: NotebookPaper = { template: DEFAULT_TEMPLATE, size: "a4", landscape: false };

export interface NotebookSummary {
  id: string;
  title: string;
  cover: CoverColor;
  folderId: string | null;
  /** Linked course workspace (for study kits), when the student picked one. */
  workspaceId: string | null;
  pageCount: number;
  /** Page id of the first page, for the cover thumbnail. */
  firstPageId: string | null;
  updatedAt: string;
  deletedAt: string | null;
}

export interface NotebookDetail extends NotebookSummary {
  paper: NotebookPaper;
  /** Bumped by the server on every change (pages or ink). */
  version: number;
  pages: PageMeta[];
}

export interface NotebookFolder {
  id: string;
  name: string;
  createdAt: string;
}

export const MAX_TITLE = 120;
export const MAX_FOLDER_NAME = 80;
export const MAX_NOTEBOOKS_PER_USER = 500;
export const MAX_FOLDERS_PER_USER = 100;
export const MAX_PAGES_PER_NOTEBOOK = 2000;
/** Largest PDF a student can import (the proxy body limit in next.config.ts fits it). */
export const MAX_PDF_BYTES = 30 * 1024 * 1024;
export const MAX_PDF_PAGES = 500;

// ---- Ids ----------------------------------------------------------------------

export const ID_PATTERN = /^[A-Za-z0-9_-]{8,40}$/;

const ID_ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";

/** A random 16-character id (~95 bits). */
export function newId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let out = "";
  for (const b of bytes) out += ID_ALPHABET[b % ID_ALPHABET.length];
  return out;
}

// ---- Validation helpers ---------------------------------------------------------

export function isTemplate(value: unknown): value is PageTemplate {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    (TEMPLATE_KINDS as readonly unknown[]).includes(v.kind) &&
    (PAPER_COLORS as readonly unknown[]).includes(v.paper)
  );
}

export function pageSize(paper: NotebookPaper): { width: number; height: number } {
  const s = PAGE_SIZES[paper.size];
  return paper.landscape ? { width: s.height, height: s.width } : { width: s.width, height: s.height };
}

/** An order key strictly between a and b (either may be missing: list ends). */
export function positionBetween(a: number | null | undefined, b: number | null | undefined): number {
  if (a == null && b == null) return 1;
  if (a == null) return (b as number) - 1;
  if (b == null) return a + 1;
  return (a + b) / 2;
}
