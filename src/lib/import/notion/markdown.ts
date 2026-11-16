/**
 * Notion's Markdown → a flat list of block-shaped nodes.
 *
 * StudyOS block text is itself Markdown (rendered with math by RichText), so
 * inline formatting (bold, italic, strikethrough, `code`, $math$, links) is
 * kept exactly as written; only links and images are rewritten later (by the
 * builder, through `rewriteInline`). The editor has no nested blocks and no
 * code or equation block, so:
 * - nested list items are flattened into one level, in order;
 * - a fenced code block becomes a paragraph holding the fence (rendered as a
 *   highlighted code block), and a $$ equation a paragraph holding $$…$$;
 * - Notion's callouts (<aside>) become callouts, their first emoji the icon;
 * - toggles (<details><summary>) become a bold line followed by their content.
 *
 * Every scan is linear in its input (bounded lookahead, no backtracking
 * regular expressions on long lines): the text is untrusted.
 */

export type MdNode =
  | { type: "heading"; level: 1 | 2 | 3; text: string }
  | { type: "paragraph"; text: string }
  | { type: "bulleted_list_item"; text: string }
  | { type: "numbered_list_item"; text: string }
  | { type: "quote"; text: string }
  | { type: "todo"; text: string; checked: boolean }
  | { type: "callout"; text: string; emoji?: string }
  /** A fenced code block, as Markdown (the fence included). */
  | { type: "code"; text: string }
  /** A display equation, as Markdown ($$…$$). */
  | { type: "math"; text: string }
  | { type: "divider" }
  | { type: "table"; header: string[]; rows: string[][] }
  /** An image on a line of its own. */
  | { type: "image"; alt: string; src: string }
  /** A link on a line of its own (a subpage or an inline database in Notion). */
  | { type: "link"; label: string; href: string };

// ---------------------------------------------------------------------------
// Inline links and images
// ---------------------------------------------------------------------------

export interface InlineLink {
  kind: "link" | "image";
  label: string;
  href: string;
}

const MAX_LABEL = 1_000;
const MAX_DEST = 2_000;

/** Index of `ch` in text[from, from + max), or -1. */
function findWithin(text: string, ch: string, from: number, max: number): number {
  const stop = Math.min(text.length, from + max);
  for (let i = from; i < stop; i += 1) if (text[i] === ch) return i;
  return -1;
}

/** A Markdown link or image starting at `start` ("[" or "!["), or null. */
function scanLink(text: string, start: number): { link: InlineLink; end: number } | null {
  let p = start;
  let kind: InlineLink["kind"] = "link";
  if (text[p] === "!") {
    kind = "image";
    p += 1;
  }
  if (text[p] !== "[") return null;
  let depth = 0;
  let q = p;
  const labelStop = Math.min(text.length, p + MAX_LABEL);
  for (; q < labelStop; q += 1) {
    const c = text[q];
    if (c === "\\") {
      q += 1;
      continue;
    }
    if (c === "[") depth += 1;
    else if (c === "]") {
      depth -= 1;
      if (depth === 0) break;
    } else if (c === "\n" && text[q + 1] === "\n") return null;
  }
  if (q >= labelStop || text[q] !== "]" || text[q + 1] !== "(") return null;
  const label = text.slice(p + 1, q);
  let r = q + 2;
  while (text[r] === " ") r += 1;
  let href: string;
  if (text[r] === "<") {
    const close = findWithin(text, ">", r + 1, MAX_DEST);
    if (close === -1) return null;
    href = text.slice(r + 1, close);
    r = close + 1;
  } else {
    const from = r;
    const stop = Math.min(text.length, from + MAX_DEST);
    let parens = 0;
    for (; r < stop; r += 1) {
      const c = text[r];
      if (c === "\\") {
        r += 1;
        continue;
      }
      if (c === "(") parens += 1;
      else if (c === ")") {
        if (parens === 0) break;
        parens -= 1;
      } else if (c === " " || c === "\n" || c === "\t") break;
    }
    if (r >= stop) return null;
    href = text.slice(from, r);
  }
  while (text[r] === " ") r += 1;
  if (text[r] === '"' || text[r] === "'") {
    const close = findWithin(text, text[r], r + 1, MAX_DEST);
    if (close === -1) return null;
    r = close + 1;
    while (text[r] === " ") r += 1;
  }
  if (text[r] !== ")") return null;
  return { link: { kind, label, href }, end: r + 1 };
}

/**
 * Replace every Markdown link and image in `text` with what `replace` returns
 * for it. Code spans are left alone (a link written in code is code).
 */
export function rewriteInline(text: string, replace: (link: InlineLink) => string): string {
  let out = "";
  let last = 0;
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === "\\") {
      i += 2;
      continue;
    }
    if (c === "`") {
      let n = 1;
      while (text[i + n] === "`") n += 1;
      const close = text.indexOf("`".repeat(n), i + n);
      i = close === -1 ? i + n : close + n;
      continue;
    }
    if (c === "[" || (c === "!" && text[i + 1] === "[")) {
      const found = scanLink(text, i);
      if (found) {
        out += text.slice(last, i) + replace(found.link);
        i = last = found.end;
        continue;
      }
    }
    i += 1;
  }
  return last === 0 ? text : out + text.slice(last);
}

/** The link or image that makes up the whole of `line` (spaces aside), or null. */
export function soleLink(line: string): InlineLink | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith("[") && !trimmed.startsWith("![")) return null;
  const found = scanLink(trimmed, 0);
  return found && found.end === trimmed.length ? found.link : null;
}

/** Text with links reduced to their labels and images to their alt text (for table cells and titles). */
export function plainText(text: string): string {
  return rewriteInline(text, (link) => link.label)
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/\\([\\`*_{}[\]()#+\-.!|~<>$])/g, "$1")
    .trim();
}

// ---------------------------------------------------------------------------
// Blocks
// ---------------------------------------------------------------------------

/** Lines longer than this are always paragraph text (no structure is looked for). */
const MAX_STRUCTURE_LINE = 4_000;

const TODO = /^[-*+]\s+\[([ xX])\](?:\s+([^]*))?$/;
const BULLET = /^[-*+]\s+([^]*)$/;
const NUMBERED = /^\d{1,9}[.)]\s+([^]*)$/;
const FENCE = /^(`{3,}|~{3,})([^`]*)$/;
const TABLE_SEPARATOR = /^\|?\s*:?-+:?\s*(?:\|\s*:?-+:?\s*)*\|?$/;
const LEADING_EMOJI = /^(\p{Extended_Pictographic}(?:\uFE0F|\u200D\p{Extended_Pictographic}|\p{Emoji_Modifier})*)\s*/u;

function indentOf(line: string): number {
  let n = 0;
  while (n < line.length && (line[n] === " " || line[n] === "\t")) n += line[n] === "\t" ? 4 : 1;
  return n;
}

/** Remove up to `n` columns of leading indentation. */
function dedent(line: string, n: number): string {
  let i = 0;
  let col = 0;
  while (i < line.length && col < n && (line[i] === " " || line[i] === "\t")) {
    col += line[i] === "\t" ? 4 : 1;
    i += 1;
  }
  return line.slice(i);
}

function isBlank(line: string): boolean {
  return line.trim() === "";
}

function headingOf(t: string): { level: 1 | 2 | 3; text: string } | null {
  let n = 0;
  while (n < t.length && n < 7 && t[n] === "#") n += 1;
  if (n === 0 || n > 6 || (t.length > n && t[n] !== " " && t[n] !== "\t")) return null;
  let text = t.slice(n).trim();
  // A closing run of #s ("## Title ##").
  let end = text.length;
  while (end > 0 && text[end - 1] === "#") end -= 1;
  if (end < text.length && (end === 0 || text[end - 1] === " ")) text = text.slice(0, end).trim();
  return { level: Math.min(3, n) as 1 | 2 | 3, text };
}

function isDivider(t: string): boolean {
  if (t.length < 3 || t.length > 200) return false;
  const ch = t[0];
  if (ch !== "-" && ch !== "*" && ch !== "_") return false;
  let count = 0;
  for (const c of t) {
    if (c === ch) count += 1;
    else if (c !== " " && c !== "\t") return false;
  }
  return count >= 3;
}

function isTableRow(t: string): boolean {
  return t.startsWith("|");
}

/** Cells of a table row ("| a | b \| c |" -> ["a", "b | c"]). */
export function tableCells(t: string): string[] {
  const cells: string[] = [];
  let cell = "";
  for (let i = 0; i < t.length; i += 1) {
    const c = t[i];
    if (c === "\\" && t[i + 1] === "|") {
      cell += "|";
      i += 1;
    } else if (c === "|") {
      cells.push(cell);
      cell = "";
    } else {
      cell += c;
    }
  }
  cells.push(cell);
  // The outer pipes leave an empty first and last cell.
  if (t.startsWith("|")) cells.shift();
  if (t.trimEnd().endsWith("|") && !t.trimEnd().endsWith("\\|")) cells.pop();
  return cells.map((c) => c.trim().replace(/<br\s*\/?>/gi, "\n"));
}

/** A code fence longer than any backtick run inside `source`. */
function fenceFor(source: string): string {
  let longest = 0;
  let run = 0;
  for (const c of source) {
    run = c === "`" ? run + 1 : 0;
    if (run > longest) longest = run;
  }
  return "`".repeat(Math.max(3, longest + 1));
}

/** Notion's code-block languages as the highlighter names them. */
function codeLanguage(info: string): string {
  const lang = info.trim().toLowerCase();
  if (!lang || lang === "plain text" || lang === "plaintext") return "";
  const known: Record<string, string> = { "c++": "cpp", "c#": "csharp", "f#": "fsharp", "objective-c": "objc", shell: "bash" };
  return known[lang] ?? lang.replace(/[^a-z0-9_+-]/g, "");
}

/** Split a callout's text into its leading emoji (Notion's icon) and the rest. */
export function calloutParts(text: string): { emoji?: string; text: string } {
  // An image icon (custom upload) cannot be shown; drop its tag.
  const cleaned = text.replace(/^\s*<img\b[^>]{0,2000}>\s*/i, "");
  const match = LEADING_EMOJI.exec(cleaned);
  if (!match) return { text: cleaned.trim() };
  return { emoji: match[1], text: cleaned.slice(match[0].length).trim() };
}

function tidyBlockText(lines: string[]): string {
  return lines
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** The page title (a leading "# Title" line) and the Markdown after it. */
export function extractTitle(md: string): { title: string | null; body: string } {
  const text = md.replace(/^\uFEFF/, "");
  let i = 0;
  while (i < text.length) {
    const nl = text.indexOf("\n", i);
    const line = text.slice(i, nl === -1 ? text.length : nl);
    if (!isBlank(line)) {
      const heading = line.length <= MAX_STRUCTURE_LINE ? headingOf(line.trim()) : null;
      if (heading && line.trim().startsWith("# ")) {
        return { title: heading.text, body: nl === -1 ? "" : text.slice(nl + 1) };
      }
      return { title: null, body: text };
    }
    if (nl === -1) break;
    i = nl + 1;
  }
  return { title: null, body: text };
}

/** Parse Notion's Markdown into block-shaped nodes (see the header). */
export function parseMarkdown(md: string): MdNode[] {
  const lines = md.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").split("\n");
  const nodes: MdNode[] = [];
  let i = 0;

  /** True when `t` (a trimmed line) starts a block other than a paragraph. */
  const startsBlock = (t: string, next: string | undefined): boolean =>
    t.length <= MAX_STRUCTURE_LINE &&
    (headingOf(t) !== null ||
      FENCE.test(t) ||
      t === "$$" ||
      t.startsWith("<aside") ||
      t.startsWith("<details") ||
      t.startsWith("</details") ||
      t.startsWith("<summary") ||
      t.startsWith(">") ||
      isDivider(t) ||
      BULLET.test(t) ||
      NUMBERED.test(t) ||
      (isTableRow(t) && next !== undefined && TABLE_SEPARATOR.test(next.trim())));

  while (i < lines.length) {
    const line = lines[i];
    if (isBlank(line)) {
      i += 1;
      continue;
    }
    const t = line.trim();
    if (t.length > MAX_STRUCTURE_LINE) {
      nodes.push({ type: "paragraph", text: t });
      i += 1;
      continue;
    }

    // Fenced code.
    const fence = FENCE.exec(t);
    if (fence) {
      const marker = fence[1];
      const indent = indentOf(line);
      const body: string[] = [];
      i += 1;
      while (i < lines.length) {
        const closing = lines[i].trim();
        if (closing.length >= marker.length && closing.length <= 200 && closing === closing[0].repeat(closing.length) && closing[0] === marker[0]) {
          i += 1;
          break;
        }
        body.push(dedent(lines[i], indent));
        i += 1;
      }
      const source = body.join("\n");
      const ticks = fenceFor(source);
      nodes.push({ type: "code", text: `${ticks}${codeLanguage(fence[2])}\n${source}\n${ticks}` });
      continue;
    }

    // Display math.
    if (t === "$$" || (t.startsWith("$$") && t.endsWith("$$") && t.length > 4)) {
      if (t !== "$$") {
        nodes.push({ type: "math", text: t });
        i += 1;
        continue;
      }
      const body: string[] = [];
      i += 1;
      while (i < lines.length && lines[i].trim() !== "$$") {
        body.push(lines[i].trim());
        i += 1;
      }
      i += 1;
      nodes.push({ type: "math", text: `$$\n${body.join("\n").trim()}\n$$` });
      continue;
    }

    // Callout.
    if (t.startsWith("<aside")) {
      const inner: string[] = [];
      const open = t.replace(/^<aside[^>]{0,200}>/, "");
      if (open.includes("</aside>")) {
        inner.push(open.slice(0, open.indexOf("</aside>")));
        i += 1;
      } else {
        if (open.trim()) inner.push(open);
        i += 1;
        // Up to the closing tag (or the end of the file, for a broken one).
        while (i < lines.length) {
          const l = lines[i];
          const at = l.indexOf("</aside>");
          i += 1;
          if (at !== -1) {
            if (l.slice(0, at).trim()) inner.push(l.slice(0, at));
            break;
          }
          inner.push(l);
        }
      }
      const text = tidyBlockText(inner.map((l) => l.trim()));
      const parts = calloutParts(text);
      nodes.push({ type: "callout", text: parts.text, ...(parts.emoji ? { emoji: parts.emoji } : {}) });
      continue;
    }

    // Toggle (<details>): a bold summary line, then the content as usual.
    if (t.startsWith("<details") || t.startsWith("</details") || t.startsWith("<summary")) {
      const summary = /<summary>([^]*?)<\/summary>/i.exec(t);
      if (summary && summary[1].trim()) nodes.push({ type: "paragraph", text: `**${summary[1].trim()}**` });
      i += 1;
      continue;
    }

    const heading = headingOf(t);
    if (heading) {
      nodes.push({ type: "heading", level: heading.level, text: heading.text });
      i += 1;
      continue;
    }

    if (isDivider(t)) {
      nodes.push({ type: "divider" });
      i += 1;
      continue;
    }

    // Table.
    if (isTableRow(t) && i + 1 < lines.length && TABLE_SEPARATOR.test(lines[i + 1].trim())) {
      const header = tableCells(t);
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && isTableRow(lines[i].trim())) {
        rows.push(tableCells(lines[i].trim()));
        i += 1;
      }
      nodes.push({ type: "table", header, rows });
      continue;
    }

    // Quote.
    if (t.startsWith(">")) {
      const body: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith(">")) {
        body.push(lines[i].trim().replace(/^>\s?/, ""));
        i += 1;
      }
      nodes.push({ type: "quote", text: tidyBlockText(body) });
      continue;
    }

    // List items (flattened). Continuation lines without a marker join the item.
    const todo = TODO.exec(t);
    const bullet = todo ? null : BULLET.exec(t);
    const numbered = todo || bullet ? null : NUMBERED.exec(t);
    if (todo || bullet || numbered) {
      const body = [(todo ? todo[2] ?? "" : (bullet ?? numbered)![1]).trim()];
      i += 1;
      while (i < lines.length && !isBlank(lines[i])) {
        const next = lines[i].trim();
        if (startsBlock(next, lines[i + 1])) break;
        body.push(next);
        i += 1;
      }
      const text = body.join("\n");
      if (todo) nodes.push({ type: "todo", text, checked: todo[1] !== " " });
      else if (bullet) nodes.push({ type: "bulleted_list_item", text });
      else nodes.push({ type: "numbered_list_item", text });
      continue;
    }

    // An image or a link on its own line.
    const sole = soleLink(t);
    if (sole) {
      nodes.push(sole.kind === "image" ? { type: "image", alt: sole.label, src: sole.href } : { type: "link", label: sole.label, href: sole.href });
      i += 1;
      continue;
    }

    // Paragraph: consecutive lines up to a blank line or another block.
    const body = [t];
    i += 1;
    while (i < lines.length && !isBlank(lines[i])) {
      const next = lines[i].trim();
      if (startsBlock(next, lines[i + 1]) || soleLink(next)?.kind === "image") break;
      body.push(next);
      i += 1;
    }
    nodes.push({ type: "paragraph", text: body.join("\n") });
  }
  return nodes;
}
