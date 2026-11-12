/**
 * Limits for study material (lecture slides, notes, readings) and for one
 * "study kit" run made from it. Pure and dependency-free: the dialog uses the
 * same numbers to show the student the cost and coverage before they start,
 * and the server enforces them.
 *
 * Why these numbers:
 * - Upload size stays at the syllabus import's 10 MB: the proxy in front of
 *   the app buffers bodies up to 11 MB (next.config.ts proxyClientMaxBodySize).
 *   A text-heavy 300-page PDF is well under that; slide decks full of photos
 *   may not be, and the dialog says so. Extraction runs inside the import's
 *   memory-capped, time-limited extraction (lib/import/extract) with these
 *   caps passed in, so a longer document can only stop earlier, never use
 *   more memory than the syllabus import allows.
 * - 300 PDF pages and 400,000 characters (about 100k tokens) cover a full
 *   lecture series or several textbook chapters while keeping one stored
 *   material under 1 MB (JSON of 400k characters). Reading stops at the
 *   character cap, so a 300-page PDF of dense text is cut, not parsed whole.
 * - Storage per student is capped (150 materials, 4,000,000 characters, about
 *   10 full-size materials), and per workspace at 40 materials.
 * - One run reads at most 10 sections of ~12,000 characters (~3k tokens
 *   each, ~120,000 characters in all): enough for a 60-page chapter or a
 *   150-slide deck, finished well inside the request's time budget. Longer
 *   material is covered by choosing a page range and running again.
 */
import { MAX_UPLOAD_BYTES } from "@/lib/import/syllabus";

export const MAX_MATERIAL_UPLOAD_BYTES = MAX_UPLOAD_BYTES;
export const MAX_MATERIAL_PDF_PAGES = 300;
export const MAX_MATERIAL_CHARS = 400_000;
/** A single page longer than this is cut (a page is rarely over 5,000). */
export const MAX_PAGE_CHARS = 12_000;
/** Pasted text and page text are split into "pages" of about this size. */
export const TEXT_PAGE_CHARS = 2_500;
export const MAX_PASTE_CHARS = 200_000;
export const MAX_MATERIAL_TITLE = 120;
export const MAX_MATERIALS_PER_WORKSPACE = 40;
/** Per student, across workspaces: materials kept and characters stored. */
export const MAX_MATERIALS_PER_USER = 150;
export const MAX_STORED_CHARS_PER_USER = 4_000_000;
export const MATERIAL_EXTRACTION_TIMEOUT_MS = 40_000;

/** Pages are packed into sections of about this many characters. */
export const SECTION_TARGET_CHARS = 12_000;
/** Most sections (model calls) one run makes. Bounds the cost of a run. */
export const MAX_SECTIONS_PER_RUN = 10;
/**
 * Most pages one material keeps, whatever its format. A .docx of thousands of
 * one-character pages is packed into at most this many (see packPages), so
 * nothing downstream (storage, listing, run planning, quote checks) scales
 * with a page count the file chose.
 */
export const MAX_MATERIAL_PAGES = MAX_MATERIAL_PDF_PAGES;
/** Most pages in one section, however short they are. */
export const MAX_SECTION_PAGES = 60;
/**
 * Prompt characters each page adds besides its text: the "[[page N]]" marker
 * and line breaks (see prompt.ts). An empty page is sent as a short
 * placeholder. Counted in section sizing so many short pages cannot make a
 * section's prompt (and its cost) far larger than its text.
 */
export const PAGE_MARKER_CHARS = 16;
export const EMPTY_PAGE_CHARS = 24;

/** Prompt characters a page of `chars` text characters takes in a section. */
export function pagePromptChars(chars: number): number {
  return PAGE_MARKER_CHARS + (chars > 0 ? Math.min(chars, MAX_PAGE_CHARS) : EMPTY_PAGE_CHARS);
}

export type KitAmount = "few" | "standard" | "many";
export const KIT_AMOUNTS: readonly KitAmount[] = ["few", "standard", "many"];

export interface KitOutputs {
  notes: boolean;
  flashcards: boolean;
  quiz: boolean;
}

/** Target totals per amount, before the material's own length caps them. */
export const KIT_TARGETS: Record<KitAmount, { cards: number; questions: number }> = {
  few: { cards: 12, questions: 6 },
  standard: { cards: 25, questions: 12 },
  many: { cards: 45, questions: 20 },
};

/**
 * A short text cannot honestly support 45 cards: about one card per 350
 * characters and one question per 700 is where they start repeating
 * themselves. Never fewer than a handful.
 */
export function kitTargets(
  amount: KitAmount,
  outputs: KitOutputs,
  coveredChars: number,
): { cards: number; questions: number } {
  const base = KIT_TARGETS[amount];
  return {
    cards: outputs.flashcards ? Math.min(base.cards, Math.max(4, Math.floor(coveredChars / 350))) : 0,
    questions: outputs.quiz ? Math.min(base.questions, Math.max(3, Math.floor(coveredChars / 700))) : 0,
  };
}

export interface RunSection {
  /** 1-based page numbers, inclusive. */
  from: number;
  to: number;
  /** Text characters of its pages. */
  chars: number;
  /** Characters the section's pages take in the prompt (text plus page markers). */
  promptChars?: number;
}

export interface RunPlan {
  sections: RunSection[];
  /** Pages this run reads (1-based, inclusive); 0/0 when there is nothing to read. */
  from: number;
  to: number;
  /** True when the chosen range did not fit in one run (it stops at `to`). */
  cutShort: boolean;
  /** Characters this run reads. */
  chars: number;
}

/**
 * Pack pages (by their lengths) into sections of about SECTION_TARGET_CHARS
 * of prompt (text plus each page's marker, see pagePromptChars) and at most
 * MAX_SECTION_PAGES pages, starting at `range.from`, stopping at `range.to`
 * or after MAX_SECTIONS_PER_RUN sections, whichever comes first. Pages are
 * never split: a section boundary always falls between pages, so every page
 * a card cites was read whole. Empty pages (picture slides) are carried
 * along; only their markers count.
 */
export function planRun(
  pageChars: readonly number[],
  range?: { from?: number; to?: number },
  limits: { target?: number; maxSections?: number; maxSectionPages?: number } = {},
): RunPlan {
  const target = limits.target ?? SECTION_TARGET_CHARS;
  const maxSections = limits.maxSections ?? MAX_SECTIONS_PER_RUN;
  const maxSectionPages = limits.maxSectionPages ?? MAX_SECTION_PAGES;
  const total = pageChars.length;
  const from = clamp(Math.floor(range?.from ?? 1), 1, Math.max(1, total));
  const to = clamp(Math.floor(range?.to ?? total), from, Math.max(1, total));
  const sections: RunSection[] = [];
  if (total === 0) return { sections, from: 0, to: 0, cutShort: false, chars: 0 };

  let current: Required<RunSection> | null = null;
  let page = from;
  for (; page <= to; page += 1) {
    const chars = Math.max(0, Math.min(pageChars[page - 1] ?? 0, MAX_PAGE_CHARS));
    const prompt = pagePromptChars(chars);
    const full =
      current !== null &&
      ((current.chars > 0 && current.promptChars + prompt > target) ||
        current.to - current.from + 1 >= maxSectionPages);
    if (current && full) {
      sections.push(current);
      current = null;
      if (sections.length >= maxSections) break;
    }
    if (!current) current = { from: page, to: page, chars: 0, promptChars: 0 };
    current.to = page;
    current.chars += chars;
    current.promptChars += prompt;
  }
  if (current && sections.length < maxSections) {
    sections.push(current);
    page = to + 1;
  }
  // Sections made only of empty pages carry nothing to read.
  const useful = sections.filter((s) => s.chars > 0);
  const last = sections.at(-1);
  return {
    sections: useful,
    from,
    to: last ? last.to : from,
    cutShort: page <= to,
    chars: useful.reduce((sum, s) => sum + s.chars, 0),
  };
}

/**
 * Split a run's targets across its sections in proportion to their length
 * (largest remainder), so a long section gets more cards than a short one
 * and the kit covers the whole range instead of its first pages.
 */
export function sectionQuotas(sections: readonly { chars: number }[], total: number): number[] {
  const sum = sections.reduce((acc, s) => acc + s.chars, 0);
  if (total <= 0 || sum <= 0) return sections.map(() => 0);
  const exact = sections.map((s) => (s.chars / sum) * total);
  const quotas = exact.map(Math.floor);
  let left = total - quotas.reduce((a, b) => a + b, 0);
  const order = exact
    .map((value, index) => ({ index, rest: value - Math.floor(value) }))
    .sort((a, b) => b.rest - a.rest || a.index - b.index);
  for (const { index } of order) {
    if (left <= 0) break;
    quotas[index] += 1;
    left -= 1;
  }
  return quotas;
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}
