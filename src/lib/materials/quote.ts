/**
 * Quote verification: is a "verbatim" quote the model gave really in the
 * student's material, and where?
 *
 * Both texts are reduced to a skeleton of letters and digits: lower-cased,
 * compatibility-normalised (ligatures, full-width forms), accents and every
 * space, punctuation mark and hyphen removed. That makes the check tolerant of
 * what PDF extraction and models legitimately change (line breaks, words
 * hyphenated across lines, curly vs straight quotes, case, spacing) and of
 * nothing else: a changed, added or missing word changes the skeleton, so a
 * paraphrase or an invented sentence is not found.
 *
 * A quote may elide with "..." or "…"; each part must then be found, in order
 * and close together, so an ellipsis can shorten a real passage but never
 * stitch two unrelated ones. Pure: the server verifies with it and the
 * citation viewer uses it to highlight the passage.
 */

export interface Skeleton {
  /** Letters and digits only, lower-case, without accents. */
  text: string;
  /** For each skeleton character, the index of its source character. */
  map: number[];
}

const KEEP = /[\p{L}\p{N}]/u;
const MARK = /\p{M}/gu;

/** Reduce `source` to its skeleton, remembering where each character came from. */
export function skeletonOf(source: string): Skeleton {
  let text = "";
  const map: number[] = [];
  let index = 0;
  for (const char of source) {
    const folded = char.normalize("NFKD").replace(MARK, "").toLowerCase();
    for (const out of folded) {
      if (KEEP.test(out)) {
        text += out;
        map.push(index);
      }
    }
    index += char.length;
  }
  return { text, map };
}

/** Skeleton text only (no map). */
export function skeletonText(source: string): string {
  return skeletonOf(source).text;
}

const ELLIPSIS = /\s*(?:\.{3,}|…|\[\s*(?:\.{3}|…)\s*\])\s*/u;
// Scripts written without spaces between words: count characters, not words.
const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Thai}]/u;

/** Longest quote accepted, in characters. A citation is a short excerpt. */
export const MAX_QUOTE_CHARS = 400;
/** How far apart (in skeleton characters) the parts of an elided quote may be. */
const MAX_ELISION_GAP = 600;
/** Occurrences of an elided quote's first part tried before giving up. */
const MAX_OCCURRENCES = 25;

/**
 * Whether a quote is specific enough to prove anything: at least four words
 * (or eight characters in a script without spaces) and 15 skeleton
 * characters. "the cell" occurs on every page of a biology deck; a citation
 * that short would verify anything.
 */
export function isSpecificQuote(quote: string): boolean {
  const skeleton = skeletonText(quote);
  if (CJK.test(quote)) return skeleton.length >= 8;
  const words = quote.split(/\s+/).filter((w) => KEEP.test(w));
  return words.length >= 4 && skeleton.length >= 15;
}

export interface QuoteMatch {
  /** Range in the page text (start inclusive, end exclusive). */
  start: number;
  end: number;
}

/**
 * Find `quote` in `pageText`. Returns the range of the page text it covers,
 * or null when it is not there (or is too short or too long to be a
 * meaningful citation).
 */
export function locateQuote(
  pageText: string,
  quote: string,
  pageSkeleton?: Skeleton,
): QuoteMatch | null {
  if (!quote || quote.length > MAX_QUOTE_CHARS * 1.5) return null;
  if (!isSpecificQuote(quote)) return null;
  const parts = quote
    .split(ELLIPSIS)
    .map(skeletonText)
    .filter((part) => part.length > 0);
  if (parts.length === 0) return null;
  // Every part of an elided quote must be substantial on its own.
  if (parts.length > 1 && parts.some((part) => part.length < 6)) return null;

  const page = pageSkeleton ?? skeletonOf(pageText);
  // Try occurrences of the first part (a bounded number, so a page that
  // repeats one phrase hundreds of times cannot make this quadratic), so an
  // elided quote whose opening words also appear earlier is still found.
  let from = page.text.indexOf(parts[0]);
  let tries = 0;
  while (from !== -1 && tries < MAX_OCCURRENCES) {
    tries += 1;
    let end = from + parts[0].length;
    let ok = true;
    for (const part of parts.slice(1)) {
      const at = page.text.indexOf(part, end);
      if (at === -1 || at - end > MAX_ELISION_GAP) {
        ok = false;
        break;
      }
      end = at + part.length;
    }
    if (ok) {
      return { start: page.map[from], end: page.map[end - 1] + charLengthAt(pageText, page.map[end - 1]) };
    }
    from = page.text.indexOf(parts[0], from + 1);
  }
  return null;
}

function charLengthAt(text: string, index: number): number {
  const code = text.codePointAt(index);
  return code !== undefined && code > 0xffff ? 2 : 1;
}

export interface VerifiedQuote {
  /** 1-based page the quote was found on. */
  page: number;
  /** The passage as it appears in the material (whitespace tidied). */
  quote: string;
}

/**
 * Verify a quote against the pages a section covered. The cited page is
 * tried first, then its neighbours (a passage can run over a page break, and
 * models are sometimes one page off), then the rest of the section. Returns
 * the corrected page and the material's own wording, or null.
 */
export function verifyQuote(
  pages: readonly string[],
  quote: string,
  citedPage: number | undefined,
  range: { from: number; to: number },
  /** Page skeletons by page number, reused across the items of a section. */
  cache: Map<number, Skeleton> = new Map(),
): VerifiedQuote | null {
  const candidates: number[] = [];
  const add = (page: number) => {
    if (page >= range.from && page <= range.to && !candidates.includes(page)) candidates.push(page);
  };
  if (citedPage !== undefined && Number.isFinite(citedPage)) {
    add(citedPage);
    add(citedPage - 1);
    add(citedPage + 1);
  }
  for (let page = range.from; page <= range.to; page += 1) add(page);

  for (const page of candidates) {
    const text = pages[page - 1] ?? "";
    let skeleton = cache.get(page);
    if (!skeleton) {
      skeleton = skeletonOf(text);
      cache.set(page, skeleton);
    }
    const match = locateQuote(text, quote, skeleton);
    if (!match) continue;
    const exact = text.slice(match.start, match.end).replace(/\s+/g, " ").trim();
    // An elided quote can span more than an excerpt should: keep the
    // model's shortened form (the viewer re-locates it the same way).
    const stored = exact.length <= MAX_QUOTE_CHARS ? exact : quote.replace(/\s+/g, " ").trim();
    return { page, quote: stored };
  }
  return null;
}
