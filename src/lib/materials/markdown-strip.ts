/**
 * Removing images and links from model-written Markdown, in linear time on
 * any input and without backtracking patterns.
 *
 * Generated study text is rendered as Markdown. An image there makes the
 * reader's browser fetch a URL the model chose, and a link invites a click on
 * one: both are channels a hostile document could steer the model into
 * (summary notes, in particular, need no verified quote). Brackets and
 * parentheses are paired once with a stack, so an image whose alt text is
 * long or holds nested brackets is still found, and a run of unmatched
 * brackets costs one pass, not one rescan per bracket.
 */

/** For every "[" and "(" its matching closer's index (or -1); backslash escapes skipped. */
function pairBrackets(s: string): Int32Array {
  const close = new Int32Array(s.length).fill(-1);
  const squares: number[] = [];
  const rounds: number[] = [];
  for (let i = 0; i < s.length; i += 1) {
    const ch = s[i];
    if (ch === "\\") {
      i += 1;
      continue;
    }
    if (ch === "[") squares.push(i);
    else if (ch === "(") rounds.push(i);
    else if (ch === "]") {
      const open = squares.pop();
      if (open !== undefined) close[open] = i;
    } else if (ch === ")") {
      const open = rounds.pop();
      if (open !== undefined) close[open] = i;
    }
  }
  return close;
}

/** Lines like "[label]: https://..." (Markdown reference definitions), removed. */
function dropReferenceDefinitions(s: string): string {
  if (!s.includes("]:")) return s;
  return s
    .split("\n")
    .filter((line) => !/^ {0,3}\[[^\]\n]{1,1000}\]:/.test(line))
    .join("\n");
}

/** Remove every `<tag ...>` whose name is `tag` (case-insensitive), up to its ">" (or the end). */
function dropHtmlTag(s: string, tag: string): string {
  const lower = s.toLowerCase();
  const open = `<${tag}`;
  let at = lower.indexOf(open);
  if (at === -1) return s;
  let out = "";
  let from = 0;
  while (at !== -1) {
    const next = lower[at + open.length];
    // "<img" must be the whole tag name ("<imgx" is not an image).
    if (next !== undefined && /[a-z0-9-]/.test(next)) {
      at = lower.indexOf(open, at + 1);
      continue;
    }
    out += s.slice(from, at);
    const end = lower.indexOf(">", at);
    from = end === -1 ? s.length : end + 1;
    at = lower.indexOf(open, from);
  }
  return out + s.slice(from);
}

/**
 * Markdown images (inline `![alt](url)` and reference `![alt][ref]`, any alt
 * length, nested brackets included), reference definitions and HTML `<img>`
 * tags, removed.
 */
export function stripImages(input: string): string {
  const s = dropHtmlTag(dropHtmlTag(dropReferenceDefinitions(input), "img"), "image");
  if (!s.includes("![")) return s;
  const close = pairBrackets(s);
  let out = "";
  let from = 0;
  for (let i = 0; i < s.length; i += 1) {
    if (s[i] === "\\") {
      i += 1;
      continue;
    }
    if (s[i] !== "!" || s[i + 1] !== "[") continue;
    const alt = close[i + 1];
    if (alt === -1) continue;
    const next = s[alt + 1];
    const end = next === "(" || next === "[" ? close[alt + 1] : -1;
    // `![alt]` alone is a shortcut reference; its definition is gone, but drop it too.
    const last = end !== -1 ? end : alt;
    out += s.slice(from, i);
    from = last + 1;
    i = last;
  }
  return defuseLinkSyntax(out + s.slice(from));
}

/**
 * Whatever pairing left (an image or link nested inside link text, an
 * unbalanced destination) cannot form one any more: Markdown needs "](" or
 * "][" right after the bracketed text.
 */
function defuseLinkSyntax(s: string): string {
  return s.includes("](") || s.includes("][") ? s.replaceAll("](", "] (").replaceAll("][", "] [") : s;
}

const BARE_URL = /\b(?:https?:\/\/|www\.)[^\s<>()[\]]{1,2000}/gi;
const AUTOLINK = /<[a-z][a-z0-9+.-]{1,31}:[^\s<>]{0,2000}>/gi;

/**
 * Links reduced to their text: `[text](url)` keeps the text, `[text][ref]`
 * (dead once its definition is removed) keeps its brackets, split apart,
 * autolinks, bare URLs (which Markdown renderers linkify), reference
 * definitions and HTML anchors are removed. Images are removed first.
 */
export function stripLinks(input: string): string {
  const s = stripImages(input);
  const close = pairBrackets(s);
  let out = "";
  let from = 0;
  for (let i = 0; i < s.length; i += 1) {
    if (s[i] === "\\") {
      i += 1;
      continue;
    }
    if (s[i] !== "[") continue;
    const textEnd = close[i];
    if (textEnd === -1) continue;
    // `[text][ref]` is only a link with a "[ref]:" definition, and those are
    // gone (stripImages), so it stays as text: "rate = k[substrate][nucleophile]"
    // must keep its concentrations. defuseLinkSyntax still splits the "][".
    const next = s[textEnd + 1];
    const end = next === "(" ? close[textEnd + 1] : -1;
    if (end === -1) continue;
    out += s.slice(from, i) + s.slice(i + 1, textEnd);
    from = end + 1;
    i = end;
  }
  const flat = defuseLinkSyntax(out + s.slice(from));
  return dropHtmlTag(dropHtmlTag(flat, "a"), "/a").replace(AUTOLINK, "").replace(BARE_URL, "");
}
