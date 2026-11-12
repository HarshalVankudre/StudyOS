/**
 * Turning text into citable "pages". PDFs (and Word documents Word has laid
 * out) bring their own pages; pasted text and the text of a workspace page do
 * not, so they are split into page-sized parts here. Pure: used by the upload
 * route and by the dialog (to send a notes page as material).
 */
import type { Block, Page } from "@/lib/workspace/types";
import { MAX_PAGE_CHARS, TEXT_PAGE_CHARS } from "./limits";

// Control chars except tab, newline and form feed.
const CONTROL_CHARS = /[\x00-\x08\x0B\x0E-\x1F\x7F]/g;

/**
 * Strip control characters and tidy whitespace, keeping line structure.
 * Linear on any input: lines are trimmed one by one (no regex that can
 * backtrack over a long run of spaces), and only single-character classes
 * are used with the global flag.
 */
export function cleanMaterialText(raw: string): string {
  const lines = raw.replace(CONTROL_CHARS, "").split(/\r\n|\r|\n/);
  const out: string[] = [];
  let blank = 0;
  for (const line of lines) {
    const trimmed = line.trimEnd();
    if (trimmed === "") {
      blank += 1;
      if (blank > 1) continue; // At most one blank line in a row.
    } else {
      blank = 0;
    }
    out.push(trimmed);
  }
  return out.join("\n").trim();
}

const SENTENCE_END = new Set([".", "!", "?", "。", "！", "？"]);
const isSpace = (ch: string | undefined) => ch === undefined || ch === " " || ch === "\n" || ch === "\t";

/**
 * Split text into pages of about `size` characters at paragraph boundaries
 * (then line, sentence, word). A part never ends mid-word, so a quote found
 * on one page is not cut in half by an artificial boundary more often than a
 * printed page would cut it. Walks the text once with an index (no repeated
 * copying of the remainder).
 */
export function paginateText(raw: string, size = TEXT_PAGE_CHARS): string[] {
  const text = cleanMaterialText(raw);
  if (!text) return [];
  const pages: string[] = [];
  let start = 0;
  while (text.length - start > size) {
    const end = Math.min(text.length, start + size + Math.floor(size * 0.2));
    const min = start + Math.floor(size * 0.5);
    const cut =
      lastBreak(text, "\n\n", start, end, min) ??
      lastBreak(text, "\n", start, end, min) ??
      lastSentenceEnd(text, end, min) ??
      lastBreak(text, " ", start, end, min) ??
      start + size;
    const page = text.slice(start, cut).trim();
    if (page) pages.push(page);
    start = cut;
  }
  const rest = text.slice(start).trim();
  if (rest) pages.push(rest);
  return pages;
}

function lastBreak(text: string, marker: string, start: number, end: number, min: number): number | null {
  const at = text.lastIndexOf(marker, end - marker.length);
  return at >= min && at >= start ? at + marker.length : null;
}

function lastSentenceEnd(text: string, end: number, min: number): number | null {
  for (let i = end - 1; i >= min; i -= 1) {
    if (SENTENCE_END.has(text[i]) && isSpace(text[i + 1])) return i + 1;
  }
  return null;
}

/** Cap each page at MAX_PAGE_CHARS (a stray huge "page" is cut, not dropped). */
export function capPages(pages: readonly string[]): string[] {
  return pages.map((page) => (page.length > MAX_PAGE_CHARS ? page.slice(0, MAX_PAGE_CHARS) : page));
}

function blockText(block: Block): string | null {
  switch (block.type) {
    case "heading":
      return `${"#".repeat(block.level)} ${block.text}`;
    case "paragraph":
    case "quote":
      return block.text;
    case "callout":
      return block.text;
    case "todo":
    case "bulleted_list_item":
      return `- ${block.text}`;
    case "numbered_list_item":
      return `1. ${block.text}`;
    default:
      return null;
  }
}

/**
 * The text of a workspace notes page, for "make flashcards / a quiz from this
 * page": its title and every text block in order. Flashcards, quizzes,
 * tables and embeds are left out; making cards from cards would only echo
 * them back.
 */
export function pageMaterialText(page: Pick<Page, "title" | "blocks">): string {
  const lines: string[] = [];
  if (page.title.trim()) lines.push(page.title.trim(), "");
  for (const block of page.blocks) {
    const text = blockText(block);
    if (text === null || !text.trim()) continue;
    lines.push(text);
    // Headings and paragraphs separate thoughts; list items stay together.
    if (block.type === "heading" || block.type === "paragraph" || block.type === "callout" || block.type === "quote") {
      lines.push("");
    }
  }
  return cleanMaterialText(lines.join("\n"));
}
