/**
 * Summary notes for a study kit: how many note sections to ask a section of
 * material for, and the check that keeps copied passages out of the notes.
 *
 * Notes are study notes, not excerpts: the student already has the text. A
 * note section is asked for roughly every topic the pages teach (pages with
 * text, or about every 1,500 characters for long pages), so an eight-page
 * lecture gets about eight sections instead of two drawn from its first and
 * last pages. A bullet that is mostly a sentence lifted from the material is
 * dropped in code, whatever the model did.
 */
import type { ProposedNote } from "./parse";

/** Note sections asked of one model call at most. */
export const MAX_NOTES_PER_SECTION = 10;
/** A page with fewer text characters than this (a title or picture slide) teaches no topic of its own. */
export const NOTE_PAGE_MIN_CHARS = 200;
/** About one note section per this many characters of a long page. */
const CHARS_PER_NOTE = 1_500;
/** Slides are short: never more than one section per this many characters. */
const MIN_CHARS_PER_NOTE = 600;

/**
 * How many note sections to ask for pages `from`..`to` (1-based, inclusive):
 * about one per page that teaches something, and more for long pages, within
 * [1, MAX_NOTES_PER_SECTION].
 */
export function noteSectionsFor(pageChars: readonly number[], from: number, to: number): number {
  let chars = 0;
  let textPages = 0;
  for (let page = from; page <= to; page += 1) {
    const n = Math.max(0, pageChars[page - 1] ?? 0);
    chars += n;
    if (n >= NOTE_PAGE_MIN_CHARS) textPages += 1;
  }
  if (chars <= 0) return 0;
  const byLength = Math.ceil(chars / CHARS_PER_NOTE);
  const byPages = Math.min(textPages, Math.ceil(chars / MIN_CHARS_PER_NOTE));
  return Math.min(MAX_NOTES_PER_SECTION, Math.max(1, byLength, byPages));
}

/** Pages of `from`..`to` long enough to teach a topic (what the notes must cover). */
export function notePages(pages: readonly string[], from: number, to: number): number[] {
  const out: number[] = [];
  for (let page = from; page <= to; page += 1) {
    if ((pages[page - 1] ?? "").trim().length >= NOTE_PAGE_MIN_CHARS) out.push(page);
  }
  return out;
}

// Scripts written without spaces between words: compare characters, not words.
const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Thai}]/u;
/** Words in a run that count as copied when found in the material in the same order. */
const RUN_WORDS = 6;
const RUN_CHARS = 12;
/** A bullet shorter than this (in words) is a term or a phrase, not a passage. */
const MIN_COPIED_WORDS = 10;
const MIN_COPIED_CHARS = 24;
/** Share of a bullet's runs found in the material above which it is a copied passage. */
const COPIED_SHARE = 0.7;

function fold(text: string): string {
  return text.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase();
}

function units(text: string): { list: string[]; cjk: boolean } {
  const folded = fold(text);
  if (CJK.test(folded)) return { list: Array.from(folded.replace(/[^\p{L}\p{N}]/gu, "")), cjk: true };
  return { list: folded.split(/[^\p{L}\p{N}]+/u).filter(Boolean), cjk: false };
}

function runsOf(list: readonly string[], size: number): string[] {
  const out: string[] = [];
  for (let i = 0; i + size <= list.length; i += 1) out.push(list.slice(i, i + size).join(" "));
  return out;
}

/** The material's runs of words (or characters), for {@link isCopiedPassage}. */
export function materialRuns(text: string): { words: Set<string>; chars: Set<string> } {
  const { list, cjk } = units(text);
  return cjk
    ? { words: new Set(), chars: new Set(runsOf(list, RUN_CHARS)) }
    : { words: new Set(runsOf(list, RUN_WORDS)), chars: new Set() };
}

/**
 * Is this bullet mostly a passage copied from the material? True when it is
 * long enough to be a passage and most of its six-word runs (twelve
 * characters for Chinese or Japanese) appear in the material word for word.
 * Paraphrase, a "Term: definition" line in the note's own words, or a short
 * technical phrase is not copying.
 */
export function isCopiedPassage(point: string, material: { words: Set<string>; chars: Set<string> }): boolean {
  const { list, cjk } = units(point);
  if (cjk ? list.length < MIN_COPIED_CHARS : list.length < MIN_COPIED_WORDS) return false;
  const runs = runsOf(list, cjk ? RUN_CHARS : RUN_WORDS);
  if (runs.length === 0) return false;
  const pool = cjk ? material.chars : material.words;
  const found = runs.filter((run) => pool.has(run)).length;
  return found / runs.length >= COPIED_SHARE;
}

/**
 * Notes of one section, ready to keep: bullets copied from the material are
 * dropped (a section left with none is dropped), and sections are put in page
 * order so the sheet follows the document. Returns how many bullets were
 * dropped as copies.
 */
export function cleanNotes(
  notes: readonly ProposedNote[],
  pages: readonly string[],
  range: { from: number; to: number },
): { notes: ProposedNote[]; copied: number } {
  const material = materialRuns(pages.slice(range.from - 1, range.to).join("\n"));
  let copied = 0;
  const kept: ProposedNote[] = [];
  for (const note of notes) {
    const points = note.points.filter((point) => {
      const copy = isCopiedPassage(point, material);
      if (copy) copied += 1;
      return !copy;
    });
    if (points.length > 0) kept.push({ ...note, points });
  }
  const order = kept.map((note, index) => ({ note, index }));
  order.sort((a, b) => (a.note.page ?? 0) - (b.note.page ?? 0) || a.index - b.index);
  return { notes: order.map((entry) => entry.note), copied };
}
