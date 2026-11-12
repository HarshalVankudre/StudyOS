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
 * Block text is Markdown with $math$. For search and snippets, reduce it to
 * what a person reads: link text without URLs, no emphasis markers, no
 * heading/list/quote prefixes, single spaces.
 */
export function plainText(markdown: string): string {
  return markdown
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1") // images → alt
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1") // links → text
    .replace(/`{1,3}([^`]*)`{1,3}/g, "$1") // code spans
    .replace(/(\*\*|__|\*|_|~~)(?=\S)([^*_~]*?\S)\1/g, "$2") // emphasis
    .replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+[.)])\s+/gm, "") // block prefixes
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
