/**
 * Moving decks in and out of StudyOS as delimited text — the formats Quizlet's
 * export and Anki's "Notes in Plain Text" export produce, and the formats both
 * apps import.
 *
 * Import understands:
 *  - tab, comma or semicolon separated rows (auto-detected, or forced);
 *  - RFC 4180 quoting: "a, b", doubled "" quotes, tabs and line breaks inside
 *    quoted fields, CRLF line endings, a UTF-8 byte-order mark;
 *  - Anki's `#key:value` header lines (#separator, #html, #columns and the
 *    `#guid/notetype/deck/tags column:N` markers, whose columns are skipped);
 *  - an optional header row ("Front,Back", "Term,Definition", …) or none;
 *  - Anki HTML (<br>, <b>, entities) and MathJax \( \) / \[ \] → Markdown + $math$.
 *
 * Anki .apkg packages are deliberately not supported: they are zipped SQLite
 * databases and would need a WebAssembly SQLite build in the browser. Anki
 * itself exports and imports the plain-text format handled here.
 */
import type { Flashcard } from "@/lib/workspace/types";
import { MAX_FLASHCARDS, MAX_FLASHCARD_TEXT } from "@/lib/workspace/schema";

export type Delimiter = "\t" | "," | ";";
export const DELIMITERS: Delimiter[] = ["\t", ",", ";"];

export interface ParsedDeck {
  rows: { line: number; front: string; back: string }[];
  delimiter: Delimiter;
  /** True when a header row (or Anki #columns line) was recognised and skipped. */
  header: boolean;
}

/** Split delimited text into rows of fields, honouring double-quoted fields. */
export function splitDelimited(text: string, delimiter: Delimiter): { line: number; fields: string[] }[] {
  const rows: { line: number; fields: string[] }[] = [];
  let field = "";
  let fields: string[] = [];
  let quoted = false;
  let atFieldStart = true;
  let line = 1;
  let rowLine = 1;
  const pushRow = () => {
    fields.push(field);
    rows.push({ line: rowLine, fields });
    fields = [];
    field = "";
    atFieldStart = true;
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        if (ch === "\n") line++;
        field += ch;
      }
      continue;
    }
    if (ch === '"' && atFieldStart) {
      quoted = true;
      atFieldStart = false;
      continue;
    }
    if (ch === delimiter) {
      fields.push(field);
      field = "";
      atFieldStart = true;
      continue;
    }
    if (ch === "\r" || ch === "\n") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      pushRow();
      line++;
      rowLine = line;
      continue;
    }
    field += ch;
    atFieldStart = false;
  }
  if (field !== "" || fields.length > 0) pushRow();
  return rows;
}

/** Pick the delimiter that splits the sample lines most consistently. */
export function detectDelimiter(text: string): Delimiter {
  const sample = text
    .split(/\r?\n/)
    .filter((l) => l.trim() !== "" && !l.startsWith("#"))
    .slice(0, 20)
    .join("\n");
  let best: Delimiter = "\t";
  let bestScore = -1;
  for (const d of DELIMITERS) {
    const rows = splitDelimited(sample, d).filter((r) => r.fields.some((f) => f.trim()));
    if (rows.length === 0) continue;
    const multi = rows.filter((r) => r.fields.length >= 2).length;
    // Tabs almost never appear in prose, so prefer them on ties.
    const score = multi / rows.length + (d === "\t" ? 0.01 : 0);
    if (score > bestScore) {
      best = d;
      bestScore = score;
    }
  }
  return best;
}

const HEADER_WORDS = new Set([
  "front", "back", "term", "terms", "definition", "definitions", "question", "answer",
  "q", "a", "prompt", "response", "word", "meaning", "side 1", "side 2",
  "vorderseite", "rückseite", "begriff", "frage", "antwort",
  "recto", "verso", "terme", "réponse", "pregunta", "respuesta", "término", "definición",
  "domanda", "risposta", "termine", "definizione", "pergunta", "resposta", "termo", "definição",
  "vraag", "antwoord", "definitie", "问题", "答案", "术语", "定义", "正面", "背面",
  "質問", "答え", "用語", "定義", "表", "裏", "سؤال", "جواب", "مصطلح", "تعريف",
]);

function isHeaderRow(fields: string[]): boolean {
  const [a, b] = fields.map((f) => f.trim().toLowerCase());
  return !!a && !!b && HEADER_WORDS.has(a) && HEADER_WORDS.has(b);
}

const NAMED_SEPARATORS: Record<string, Delimiter> = {
  tab: "\t",
  "\t": "\t",
  comma: ",",
  ",": ",",
  semicolon: ";",
  ";": ";",
};

const ENTITIES: Record<string, string> = {
  nbsp: " ",
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  "#39": "'",
};

function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+\d*);/gi, (whole, name: string) => {
    if (name[0] === "#") {
      const code = name[1].toLowerCase() === "x" ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : whole;
    }
    return ENTITIES[name.toLowerCase()] ?? whole;
  });
}

const HTML_HINT = /<(br|div|p|b|i|u|em|strong|span|img|sub|sup|ul|ol|li)\b[^>]*>|&(nbsp|amp|lt|gt|quot);/i;

/** Convert Anki-style HTML to Markdown text. */
export function htmlToMarkdown(html: string): string {
  let s = html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(div|p|li)>/gi, "\n")
    .replace(/<li\b[^>]*>/gi, "- ")
    .replace(/<\/?(b|strong)\b[^>]*>/gi, "**")
    .replace(/<\/?(i|em)\b[^>]*>/gi, "*")
    .replace(/<img\b[^>]*\balt="([^"]*)"[^>]*>/gi, "$1")
    .replace(/<[^>]+>/g, "");
  s = decodeEntities(s);
  return s.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** MathJax delimiters (Anki) → the $…$ / $$…$$ the card renderer typesets. */
export function mathJaxToDollars(s: string): string {
  return s
    .replace(/\\\[([\s\S]+?)\\\]/g, (_, m: string) => `$$${m.trim()}$$`)
    .replace(/\\\(([\s\S]+?)\\\)/g, (_, m: string) => `$${m.trim()}$`);
}

function cleanField(raw: string, html: boolean | undefined): string {
  let s = raw;
  if (html === true || (html === undefined && HTML_HINT.test(s))) s = htmlToMarkdown(s);
  return mathJaxToDollars(s).trim();
}

/** Parse pasted or uploaded deck text into front/back rows. */
export function parseDeckText(text: string, opts: { delimiter?: Delimiter | "auto" } = {}): ParsedDeck {
  let body = text.replace(/^﻿/, "");
  let delimiter: Delimiter | undefined = opts.delimiter && opts.delimiter !== "auto" ? opts.delimiter : undefined;
  let html: boolean | undefined;
  let header = false;
  const skipColumns = new Set<number>(); // 0-based

  // Anki header lines: only at the very top of the file.
  const lines = body.split(/\r?\n/);
  let consumed = 0;
  while (consumed < lines.length && lines[consumed].startsWith("#")) {
    const m = /^#([a-z ]+?)(?: column)?:(.*)$/i.exec(lines[consumed]);
    if (m) {
      const key = m[1].trim().toLowerCase();
      const value = m[2];
      if (key === "separator" && !delimiter) delimiter = NAMED_SEPARATORS[value.trim().toLowerCase()] ?? NAMED_SEPARATORS[value];
      else if (key === "html") html = value.trim().toLowerCase() === "true";
      else if (key === "columns") header = true;
      else if (/column:/i.test(lines[consumed]) && /^\d+$/.test(value.trim())) skipColumns.add(Number(value.trim()) - 1);
    }
    consumed++;
  }
  body = lines.slice(consumed).join("\n");
  delimiter ??= detectDelimiter(body);

  const rows: ParsedDeck["rows"] = [];
  const split = splitDelimited(body, delimiter);
  for (const { line, fields: all } of split) {
    const fields = all.filter((_, i) => !skipColumns.has(i));
    if (fields.every((f) => f.trim() === "")) continue; // blank line
    if (rows.length === 0 && !header && isHeaderRow(fields)) {
      header = true;
      continue;
    }
    rows.push({
      line: line + consumed,
      front: cleanField(fields[0] ?? "", html),
      back: cleanField(fields.slice(1).find((f) => f.trim() !== "") ?? "", html),
    });
  }
  return { rows, delimiter, header };
}

export type ImportStatus = "new" | "duplicate" | "missingSide" | "tooLong" | "deckFull";

export interface ImportPlanRow {
  line: number;
  front: string;
  back: string;
  status: ImportStatus;
}

/** Key used to spot duplicates: the front, ignoring case and spacing. */
export function duplicateKey(front: string): string {
  return front.normalize("NFC").replace(/\s+/g, " ").trim().toLowerCase();
}

/**
 * Decide what happens to each parsed row: imported, or skipped as a duplicate
 * (same front as a card already in the deck or earlier in the file — the rule
 * Anki uses), as incomplete, as too long, or because the deck is full.
 */
export function planImport(
  rows: ParsedDeck["rows"],
  existing: Flashcard[],
  maxCards = MAX_FLASHCARDS,
): ImportPlanRow[] {
  const seen = new Set(existing.map((c) => duplicateKey(c.front)).filter(Boolean));
  let room = Math.max(0, maxCards - existing.length);
  return rows.map((row) => {
    let status: ImportStatus;
    if (!row.front || !row.back) status = "missingSide";
    else if (row.front.length > MAX_FLASHCARD_TEXT || row.back.length > MAX_FLASHCARD_TEXT) status = "tooLong";
    else if (seen.has(duplicateKey(row.front))) status = "duplicate";
    else if (room <= 0) status = "deckFull";
    else {
      status = "new";
      room -= 1;
      seen.add(duplicateKey(row.front));
    }
    return { ...row, status };
  });
}

/** New cards for every row the plan imports. */
export function cardsFromPlan(plan: ImportPlanRow[], makeId: () => string): Flashcard[] {
  return plan
    .filter((r) => r.status === "new")
    .map((r) => ({ id: makeId(), front: r.front, back: r.back }));
}

// ---- Export ----------------------------------------------------------------

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Markdown + $math$ → the HTML + MathJax Anki renders. */
export function markdownToAnkiHtml(md: string): string {
  return escapeHtml(md)
    .replace(/\$\$([\s\S]+?)\$\$/g, (_, m: string) => `\\[${m}\\]`)
    .replace(/\$([^$\n]+?)\$/g, (_, m: string) => `\\(${m}\\)`)
    .replace(/\*\*([^*\n]+)\*\*/g, "<b>$1</b>")
    .replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, "$1<i>$2</i>")
    .replace(/\t/g, "    ")
    .replace(/\r?\n/g, "<br>");
}

/**
 * A deck as an Anki plain-text notes file (File → Import in Anki). Tab
 * separated, HTML fields, header lines telling Anki how to read it.
 */
export function toAnkiText(cards: Flashcard[]): string {
  const lines = ["#separator:tab", "#html:true", "#columns:Front\tBack"];
  for (const c of cards) {
    if (!c.front.trim() && !c.back.trim()) continue;
    lines.push(`${markdownToAnkiHtml(c.front)}\t${markdownToAnkiHtml(c.back)}`);
  }
  return lines.join("\n") + "\n";
}

function quizletField(s: string): string {
  return s.replace(/\t/g, " ").replace(/\s*\r?\n\s*/g, " / ").trim();
}

/**
 * A deck in Quizlet's import format: term TAB definition, one card per line
 * (Quizlet's defaults "Between term and definition: Tab", "Between cards: New
 * line"). Line breaks inside a side become " / " because Quizlet would read
 * them as a new card.
 */
export function toQuizletText(cards: Flashcard[]): string {
  return (
    cards
      .filter((c) => c.front.trim() || c.back.trim())
      .map((c) => `${quizletField(c.front)}\t${quizletField(c.back)}`)
      .join("\n") + "\n"
  );
}

/** A file-system-safe file name for a deck title. */
export function deckFileName(title: string, suffix: string): string {
  const base = title
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return `${base || "flashcards"}${suffix}`;
}
