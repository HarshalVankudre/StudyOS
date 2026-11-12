/**
 * Pure helpers behind the page editor: block kinds, conversions, list
 * numbering, Markdown shortcuts, reordering and the insert-menu catalogue.
 *
 * Nothing here touches React or the workspace store, so every rule the editor
 * follows ("Enter in a list continues the list", "numbering restarts after a
 * paragraph", ...) is unit-testable on plain arrays. The block shapes are the
 * ones in src/lib/workspace/types.ts; these helpers never add fields to them.
 */
import type { Dictionary } from "@/lib/i18n/dictionaries/en";
import type { Block, Database } from "@/lib/workspace/types";
import { duplicateQuiz } from "@/lib/study/quiz";

export const newId = (): string => crypto.randomUUID();

// ---------------------------------------------------------------------------
// Text blocks and their "kinds"
// ---------------------------------------------------------------------------

export const TEXT_BLOCK_TYPES = [
  "paragraph",
  "heading",
  "todo",
  "bulleted_list_item",
  "numbered_list_item",
  "quote",
  "callout",
] as const;

export type TextBlockType = (typeof TEXT_BLOCK_TYPES)[number];
export type TextBlock = Extract<Block, { type: TextBlockType }>;

export function isTextBlock(b: Block | undefined | null): b is TextBlock {
  return !!b && (TEXT_BLOCK_TYPES as readonly string[]).includes(b.type);
}

/** A text block type, with headings split by level (what "Turn into" offers). */
export const TEXT_KINDS = [
  "paragraph",
  "heading1",
  "heading2",
  "heading3",
  "todo",
  "bulleted_list_item",
  "numbered_list_item",
  "quote",
  "callout",
] as const;

export type TextKind = (typeof TEXT_KINDS)[number];

const LIST_KINDS: ReadonlySet<TextKind> = new Set<TextKind>([
  "todo",
  "bulleted_list_item",
  "numbered_list_item",
]);

export function isListKind(kind: TextKind): boolean {
  return LIST_KINDS.has(kind);
}

export function kindOf(b: TextBlock): TextKind {
  if (b.type === "heading") return `heading${b.level}` as TextKind;
  return b.type;
}

/**
 * Build a text block of `kind`. `prev` (the block being converted, if any)
 * carries over the fields the new kind shares with it: a to-do keeps its
 * check mark, a callout keeps its emoji.
 */
export function makeTextBlock(
  kind: TextKind,
  text = "",
  id: string = newId(),
  prev?: TextBlock,
): TextBlock {
  switch (kind) {
    case "heading1":
    case "heading2":
    case "heading3":
      return { id, type: "heading", level: Number(kind.slice(-1)) as 1 | 2 | 3, text };
    case "todo":
      return { id, type: "todo", text, checked: prev?.type === "todo" ? prev.checked : false };
    case "callout":
      return { id, type: "callout", text, emoji: prev?.type === "callout" ? prev.emoji : "💡" };
    default:
      return { id, type: kind, text };
  }
}

/** Same block (same id), different kind; text kept unless `text` is given. */
export function convertTextBlock(b: TextBlock, kind: TextKind, text: string = b.text): TextBlock {
  return makeTextBlock(kind, text, b.id, b);
}

/** The kind of the block Enter creates after `b`: lists continue, the rest become text. */
export function continuationKind(b: TextBlock): TextKind {
  const kind = kindOf(b);
  return isListKind(kind) ? kind : "paragraph";
}

/**
 * The number shown before each numbered list item (undefined for any other
 * block). Counting restarts whenever a run of numbered items is interrupted.
 */
export function listNumbers(blocks: readonly Block[]): (number | undefined)[] {
  let n = 0;
  return blocks.map((b) => {
    if (b.type !== "numbered_list_item") {
      n = 0;
      return undefined;
    }
    n += 1;
    return n;
  });
}

/** Whether removing `b` would throw away something worth confirming. */
export function blockHasContent(b: Block): boolean {
  if (isTextBlock(b)) return b.text.trim() !== "";
  switch (b.type) {
    case "divider":
      return false;
    case "flashcards":
      return b.cards.length > 0;
    case "quiz":
      return b.questions.length > 0;
    default:
      return true;
  }
}

// ---------------------------------------------------------------------------
// Markdown shortcuts typed at the start of a block
// ---------------------------------------------------------------------------

export interface ShortcutMatch {
  kind: TextKind;
  /** The block text with the shortcut prefix removed. */
  rest: string;
  /** For "[x] ": start the to-do already checked. */
  checked?: boolean;
}

const SHORTCUTS: { prefix: string; kind: TextKind; checked?: boolean }[] = [
  { prefix: "# ", kind: "heading1" },
  { prefix: "## ", kind: "heading2" },
  { prefix: "### ", kind: "heading3" },
  { prefix: "- ", kind: "bulleted_list_item" },
  { prefix: "* ", kind: "bulleted_list_item" },
  { prefix: "+ ", kind: "bulleted_list_item" },
  { prefix: "1. ", kind: "numbered_list_item" },
  { prefix: "1) ", kind: "numbered_list_item" },
  { prefix: "[] ", kind: "todo" },
  { prefix: "[ ] ", kind: "todo" },
  { prefix: "[x] ", kind: "todo", checked: true },
  { prefix: "> ", kind: "quote" },
];

/**
 * Detect a Markdown shortcut the user has just typed: the text starts with a
 * known prefix and the caret sits right after it (so pasting "- milk" in the
 * middle of a paragraph, or moving the caret, never converts a block).
 */
export function matchMarkdownShortcut(text: string, caret: number): ShortcutMatch | null {
  for (const s of SHORTCUTS) {
    if (caret === s.prefix.length && text.startsWith(s.prefix)) {
      return { kind: s.kind, rest: text.slice(s.prefix.length), checked: s.checked };
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Array operations (mutate the given array; callers pass a cloned draft)
// ---------------------------------------------------------------------------

/** Move block `id` one step up (-1) or down (+1). Returns false at the edges. */
export function moveBlock(blocks: Block[], id: string, delta: -1 | 1): boolean {
  const from = blocks.findIndex((b) => b.id === id);
  const to = from + delta;
  if (from < 0 || to < 0 || to >= blocks.length) return false;
  const [b] = blocks.splice(from, 1);
  blocks.splice(to, 0, b);
  return true;
}

/**
 * Move block `id` so it lands before the block currently at `beforeIndex`
 * (or at the end when `beforeIndex >= blocks.length`). Returns false when
 * that would leave it where it is.
 */
export function moveBlockTo(blocks: Block[], id: string, beforeIndex: number): boolean {
  const from = blocks.findIndex((b) => b.id === id);
  if (from < 0) return false;
  const target = Math.max(0, Math.min(beforeIndex, blocks.length));
  if (target === from || target === from + 1) return false;
  const [b] = blocks.splice(from, 1);
  blocks.splice(target > from ? target - 1 : target, 0, b);
  return true;
}

/**
 * A copy of `b` with a fresh id. A copied flashcard deck gets fresh card ids
 * and starts unscheduled, so a duplicate never doubles the "due" count. A
 * copied quiz gets fresh question ids and starts with no stats or attempts.
 */
export function duplicateBlock(b: Block, id: string = newId()): Block {
  const copy = structuredClone(b);
  copy.id = id;
  if (copy.type === "flashcards") {
    copy.cards = copy.cards.map((c) => ({
      id: newId(),
      front: c.front,
      back: c.back,
      ...(c.source ? { source: c.source } : {}),
    }));
  }
  if (copy.type === "quiz") return duplicateQuiz(copy, id, newId);
  // A grades block is a live view of a database: the copy keeps every setting
  // (scale, targets, columns) and reads the same rows; nothing is duplicated.
  return copy;
}

/** The nearest text block before (-1) or after (+1) index `from`. */
export function findTextNeighbor(
  blocks: readonly Block[],
  from: number,
  dir: -1 | 1,
): TextBlock | undefined {
  for (let i = from + dir; i >= 0 && i < blocks.length; i += dir) {
    const b = blocks[i];
    if (isTextBlock(b)) return b;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// New databases (the "Table" block)
// ---------------------------------------------------------------------------

export function newDatabase(
  id: string,
  viewId: string,
  labels: Dictionary["page"]["newTable"],
): Database {
  return {
    id,
    name: labels.name,
    icon: "▦",
    properties: [
      { id: newId(), name: labels.propName, type: "text" },
      {
        id: newId(),
        name: labels.propStatus,
        type: "status",
        options: [
          { id: newId(), label: labels.statusTodo, color: "zinc" },
          { id: newId(), label: labels.statusInProgress, color: "amber" },
          { id: newId(), label: labels.statusDone, color: "green" },
        ],
      },
      { id: newId(), name: labels.propDue, type: "date" },
    ],
    rows: [
      { id: newId(), cells: {} },
      { id: newId(), cells: {} },
    ],
    views: [{ id: viewId, name: labels.viewTable, type: "table" }],
  };
}

// ---------------------------------------------------------------------------
// Insert menu catalogue ("/" menu and "+" menu)
// ---------------------------------------------------------------------------

export type InsertAction =
  | { kind: "text"; textKind: TextKind }
  | { kind: "divider" }
  | { kind: "database" }
  | { kind: "flashcards" }
  | { kind: "quiz" }
  | { kind: "grades" }
  | { kind: "linked"; databaseId: string; viewId: string }
  /** Opens the study-kit dialog instead of inserting a block ("/" menu only). */
  | { kind: "studyKit"; make: StudyKitMenuAction };

export interface InsertItem {
  id: string;
  label: string;
  /** Extra search terms (English aliases, Markdown prefixes). */
  keywords: string[];
  /** Markdown shortcut shown next to the label, e.g. "#". */
  hint?: string;
  action: InsertAction;
}

const TEXT_ITEM_META: Record<TextKind, { keywords: string[]; hint?: string }> = {
  paragraph: { keywords: ["text", "paragraph", "plain"] },
  heading1: { keywords: ["h1", "heading", "title"], hint: "#" },
  heading2: { keywords: ["h2", "heading", "subheading"], hint: "##" },
  heading3: { keywords: ["h3", "heading", "subheading"], hint: "###" },
  todo: { keywords: ["todo", "to-do", "task", "checkbox", "check"], hint: "[]" },
  bulleted_list_item: { keywords: ["bullet", "list", "unordered", "ul"], hint: "-" },
  numbered_list_item: { keywords: ["numbered", "number", "ordered", "ol", "list"], hint: "1." },
  quote: { keywords: ["quote", "blockquote", "citation"], hint: ">" },
  callout: { keywords: ["callout", "note", "tip", "info", "warning", "highlight"] },
};

/** The label of a text kind in the active language. */
export function textKindLabel(kind: TextKind, dict: Dictionary): string {
  const t = dict.page.blockTypes;
  switch (kind) {
    case "heading1":
      return t.heading1;
    case "heading2":
      return t.heading2;
    case "heading3":
      return t.heading3;
    default:
      return t[kind];
  }
}

/**
 * Everything a student can insert, in menu order: every text kind, divider,
 * a new table, a flashcard deck, and a linked view of each existing table.
 * (Images need an upload flow and React artifacts are AI-authored code, so
 * neither is offered here; both still render when the AI adds them.)
 */
export function buildInsertItems(
  dict: Dictionary,
  t: (template: string, vars?: Record<string, string | number>) => string,
  databases: readonly Pick<Database, "id" | "name" | "views">[],
): InsertItem[] {
  const items: InsertItem[] = TEXT_KINDS.map((kind) => ({
    id: kind,
    label: textKindLabel(kind, dict),
    keywords: TEXT_ITEM_META[kind].keywords,
    hint: TEXT_ITEM_META[kind].hint,
    action: { kind: "text", textKind: kind },
  }));
  items.push(
    {
      id: "divider",
      label: dict.page.blockTypes.divider,
      keywords: ["divider", "line", "separator", "hr", "rule"],
      hint: "---",
      action: { kind: "divider" },
    },
    {
      id: "database",
      label: dict.page.blockTypes.database,
      keywords: ["table", "database", "tracker", "grid", "db"],
      action: { kind: "database" },
    },
    {
      id: "flashcards",
      label: dict.page.blockTypes.flashcards,
      keywords: ["flashcards", "cards", "deck", "study", "srs", "anki"],
      action: { kind: "flashcards" },
    },
    {
      id: "quiz",
      label: dict.quiz.insertLabel,
      keywords: ["quiz", "test", "exam", "practice", "questions", "mcq", "multiple choice"],
      action: { kind: "quiz" },
    },
    {
      id: "grades",
      label: dict.grades.insertLabel,
      keywords: ["grades", "grade", "gpa", "score", "marks", "target", "final", "calculator"],
      action: { kind: "grades" },
    },
  );
  for (const db of databases) {
    const view = db.views[0];
    if (!view) continue;
    items.push({
      id: `linked:${db.id}`,
      label: t(dict.page.blockMenu.linkedTable, { name: db.name }),
      keywords: ["linked", "view", "table", "database", db.name],
      action: { kind: "linked", databaseId: db.id, viewId: view.id },
    });
  }
  return items;
}

// ---------------------------------------------------------------------------
// "Make from material" actions (the "+" menu's study-kit section)
// ---------------------------------------------------------------------------

/**
 * Actions that open the study-kit dialog rather than inserting a block: make
 * notes, flashcards and a quiz from uploaded material, or flashcards / a quiz
 * from the text of the current page. Kept apart from InsertItem because they
 * create a whole page through a dialog, not a block in place.
 */
export type StudyKitMenuAction = "material" | "page_flashcards" | "page_quiz";

export interface StudyKitMenuItem {
  id: string;
  label: string;
  keywords: string[];
  action: StudyKitMenuAction;
}

export function buildStudyKitItems(dict: Dictionary): StudyKitMenuItem[] {
  const M = dict.materials;
  const study = ["study", "ai", "generate", "make", "lecture", "slides", "notes"];
  return [
    {
      id: "study-kit:material",
      label: M.menuStudyKit,
      keywords: [...study, "pdf", "upload", "reading", "material", "summary", "flashcards", "quiz"],
      action: "material",
    },
    {
      id: "study-kit:page-flashcards",
      label: M.menuFlashcardsFromPage,
      keywords: [...study, "flashcards", "cards", "deck", "page"],
      action: "page_flashcards",
    },
    {
      id: "study-kit:page-quiz",
      label: M.menuQuizFromPage,
      keywords: [...study, "quiz", "test", "questions", "page"],
      action: "page_quiz",
    },
  ];
}

/**
 * The study-kit actions as "/" menu entries, so "make flashcards or a quiz
 * from your material" is reachable while typing, not only from "+".
 */
export function studyKitSlashItems(dict: Dictionary, onPage: boolean): InsertItem[] {
  return buildStudyKitItems(dict)
    .filter((item) => onPage || item.action === "material")
    .map((item) => ({
      id: item.id,
      label: item.label,
      keywords: item.keywords,
      action: { kind: "studyKit", make: item.action },
    }));
}

/** Lower-case and strip accents so "título" matches "titulo". */
export function normalizeSearch(s: string): string {
  return s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().trim();
}

/**
 * Filter and rank insert items by `query`: label prefix first, then keyword
 * prefix, then substring matches, then (for a query of several words, like
 * "study kit" or "quiz page") items where every word starts a word of the
 * label or keywords; ties keep menu order.
 */
export function filterInsertItems<T extends Pick<InsertItem, "label" | "keywords">>(
  items: readonly T[],
  query: string,
): T[] {
  const q = normalizeSearch(query).replace(/\s+/g, " ");
  if (!q) return [...items];
  const tokens = q.split(" ");
  const scored: { item: T; score: number; order: number }[] = [];
  items.forEach((item, order) => {
    const label = normalizeSearch(item.label);
    const keywords = item.keywords.map(normalizeSearch);
    let score = -1;
    if (label.startsWith(q)) score = 0;
    else if (keywords.some((k) => k.startsWith(q))) score = 1;
    else if (label.includes(q)) score = 2;
    else if (keywords.some((k) => k.includes(q))) score = 3;
    else if (tokens.length > 1) {
      const words = [label, ...keywords].flatMap((s) => s.split(/[\s\-–—:·.,/()]+/u)).filter(Boolean);
      if (tokens.every((t) => words.some((w) => w.startsWith(t)))) score = 4;
    }
    if (score >= 0) scored.push({ item, score, order });
  });
  scored.sort((a, b) => a.score - b.score || a.order - b.order);
  return scored.map((s) => s.item);
}
