/**
 * Small text helpers for workspace search: folding for case- and
 * accent-insensitive matching, Markdown-to-plain-text for snippets, and
 * snippet windows around the first hit.
 */

/** Lowercase and strip diacritics ("Économie" → "economie"). Length-preserving per char where possible. */
export function fold(text: string): string {
  return text.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/** Split a query into folded words (empty words dropped). */
export function queryWords(query: string): string[] {
  return fold(query)
    .split(/\s+/)
    .map((w) => w.trim())
    .filter(Boolean);
}

/**
 * Most characters of one block, card side or cell that search reads. Search
 * matches words and shows a short snippet, so a bounded prefix is enough, and
 * it keeps indexing time proportional to this cap rather than to whatever a
 * pasted or imported block happens to contain.
 */
export const MAX_SEARCH_TEXT = 4000;

/** `text` cut to at most `max` characters, never splitting a surrogate pair. */
export function clipText(text: string, max = MAX_SEARCH_TEXT): string {
  if (text.length <= max) return text;
  const code = text.charCodeAt(max - 1);
  return text.slice(0, code >= 0xd800 && code <= 0xdbff ? max - 1 : max);
}

// Every pattern below runs in linear time on any input: no pattern has a
// repeat that can rescan text another attempt already scanned. Bracketed
// text stops at the next bracket, URLs stop at the next parenthesis or
// whitespace, inline spans stop at the next marker or line end, and every
// repeat is bounded. (The old patterns rescanned the rest of the text from
// every "[" or "*", which made a long hostile paragraph take minutes.)
const IMAGE = /!\[([^[\]\n]{0,300})\]\([^()\s]{0,1000}\)/g;
const LINK = /\[([^[\]\n]{1,300})\]\([^()\s]{0,1000}\)/g;
const CODE = /`{1,3}([^`\n]{0,500})`{1,3}/g;
const EMPHASIS = /(\*\*|__|\*|_|~~)(?=[^\s*_~])([^*_~\n]{0,300}?[^\s*_~])\1/g;
const BLOCK_PREFIX = /^[ \t]{0,3}(?:#{1,6}|>|[-*+]|\d{1,9}[.)])[ \t]+/gm;

/**
 * Block text is Markdown with $math$. For search and snippets, reduce it to
 * what a person reads: link text without URLs, no emphasis markers, no
 * heading/list/quote prefixes, single spaces. Reads at most `max` input
 * characters (see MAX_SEARCH_TEXT).
 */
export function plainText(markdown: string, max = MAX_SEARCH_TEXT): string {
  return clipText(markdown, max)
    .replace(IMAGE, "$1") // images → alt
    .replace(LINK, "$1") // links → text
    .replace(CODE, "$1") // code spans
    .replace(EMPHASIS, "$2") // emphasis
    .replace(BLOCK_PREFIX, "") // block prefixes
    .replace(/\$+/g, "") // math delimiters
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * A window of `text` around the first occurrence of any query word, at most
 * `max` characters, with an ellipsis where it was cut. Matching is folded;
 * the returned snippet keeps the original characters.
 */
export function snippetAround(text: string, words: string[], max = 120): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  const folded = fold(clean);
  // Folding can change length for a few ligatures; fall back to the start then.
  const aligned = folded.length === clean.length;
  let at = -1;
  if (aligned) {
    for (const w of words) {
      const i = folded.indexOf(w);
      if (i >= 0 && (at < 0 || i < at)) at = i;
    }
  }
  if (at < 0) return clean.slice(0, max - 1).trimEnd() + "…";
  let start = Math.max(0, at - Math.floor(max / 3));
  const end = Math.min(clean.length, start + max);
  start = Math.max(0, end - max);
  // Prefer to start and end on word boundaries.
  if (start > 0) {
    const space = clean.indexOf(" ", start);
    if (space >= 0 && space < at) start = space + 1;
  }
  let slice = clean.slice(start, end);
  if (end < clean.length) {
    const lastSpace = slice.lastIndexOf(" ");
    if (lastSpace > slice.length * 0.6) slice = slice.slice(0, lastSpace);
  }
  return `${start > 0 ? "…" : ""}${slice}${end < clean.length ? "…" : ""}`;
}
