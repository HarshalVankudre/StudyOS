/**
 * Workspace undo/redo history and removal detection (pure, framework-free).
 *
 * The history holds the student's own changes, not snapshots of the whole
 * document: each step is the id-addressed patch it made (see changes.ts).
 * Undo applies the inverse of a step on top of the CURRENT document, so it
 * reverts only what the student did. Updates that arrived from elsewhere
 * (another device, the AI agent) are never history steps, so undo can never
 * cross them or take them back. Steps are small (only what changed), which
 * keeps a long history of a large workspace cheap.
 *
 * Typing produces one edit per keystroke, so consecutive edits made in the same
 * text field within COALESCE_MS are merged into one step: undo then removes a
 * burst of typing, not one character. Removals are never merged, so each one
 * is its own undoable step (the Undo toast targets exactly that step).
 */
import { diff, patchBytes, type Op } from "./changes";
import type { Block, Workspace } from "./types";

export const HISTORY_LIMIT = 100;
/** Rough cap on the memory the kept steps may use. */
export const HISTORY_MAX_BYTES = 8_000_000;
export const COALESCE_MS = 1500;

export interface HistoryEntry {
  /** Monotonic id; lets an Undo toast find "its" step later. */
  id: number;
  /** What the step changed (undo applies the inverse). */
  ops: Op[];
  bytes: number;
  /** Coalescing key of the step (null = never merge into it). */
  key: string | null;
  at: number;
  /**
   * The document before the step, kept only while the step may still absorb
   * more typing (the newest step); shares structure with the live document.
   */
  before: Workspace | null;
}

export interface History {
  undo: HistoryEntry[];
  redo: HistoryEntry[];
  nextId: number;
}

export function createHistory(): History {
  return { undo: [], redo: [], nextId: 1 };
}

export interface RecordOptions {
  before: Workspace;
  after: Workspace;
  ops: Op[];
  now: number;
  /** Same non-null key within COALESCE_MS merges into the previous step. */
  coalesceKey?: string | null;
  limit?: number;
  maxBytes?: number;
}

/** Record a step the student made. Clears redo. Returns the step's id. */
export function record(h: History, opts: RecordOptions): { history: History; entryId: number } {
  const key = opts.coalesceKey ?? null;
  const top = h.undo[h.undo.length - 1];
  if (
    top &&
    top.before &&
    key !== null &&
    top.key === key &&
    opts.now - top.at <= COALESCE_MS
  ) {
    const ops = diff(top.before, opts.after);
    const merged: HistoryEntry = { ...top, ops, bytes: patchBytes(ops), at: opts.now };
    return { history: { ...h, undo: [...h.undo.slice(0, -1), merged], redo: [] }, entryId: top.id };
  }
  const entry: HistoryEntry = {
    id: h.nextId,
    ops: opts.ops,
    bytes: patchBytes(opts.ops),
    key,
    at: opts.now,
    before: key === null ? null : opts.before,
  };
  const undo = h.undo.map((e, i) => (i === h.undo.length - 1 && e.before ? { ...e, before: null } : e));
  undo.push(entry);
  trim(undo, opts.limit ?? HISTORY_LIMIT, opts.maxBytes ?? HISTORY_MAX_BYTES);
  return { history: { undo, redo: [], nextId: h.nextId + 1 }, entryId: entry.id };
}

function trim(steps: HistoryEntry[], limit: number, maxBytes: number) {
  if (steps.length > limit) steps.splice(0, steps.length - limit);
  let total = steps.reduce((n, e) => n + e.bytes, 0);
  // Always keep the newest step, however large.
  while (steps.length > 1 && total > maxBytes) {
    total -= steps[0].bytes;
    steps.shift();
  }
}

/** The next edit starts a new step (after undo/redo or an outside update). */
export function breakCoalescing(h: History): History {
  const top = h.undo[h.undo.length - 1];
  if (!top || (!top.before && top.key === null)) return h;
  return { ...h, undo: [...h.undo.slice(0, -1), { ...top, before: null, key: null }] };
}

export function canUndo(h: History): boolean {
  return h.undo.length > 0;
}

export function canRedo(h: History): boolean {
  return h.redo.length > 0;
}

/**
 * Take a step off the undo stack (the newest, or the one with `entryId` for
 * an Undo toast) and put it on top of the redo stack. The caller applies its
 * inverse. Null when there is no such step.
 */
export function takeUndo(
  h: History,
  entryId?: number,
): { history: History; entry: HistoryEntry } | null {
  const index = entryId === undefined ? h.undo.length - 1 : h.undo.findIndex((e) => e.id === entryId);
  if (index < 0) return null;
  const entry = { ...h.undo[index], before: null };
  const undo = h.undo.filter((_, i) => i !== index);
  return { history: { ...h, undo, redo: [entry, ...h.redo] }, entry };
}

/** Take the newest undone step back onto the undo stack. The caller re-applies it. */
export function takeRedo(h: History): { history: History; entry: HistoryEntry } | null {
  const [entry, ...redo] = h.redo;
  if (!entry) return null;
  return { history: { ...h, undo: [...h.undo, { ...entry, key: null }], redo }, entry };
}

// ---------------------------------------------------------------------------
// Removal detection (drives the "Deleted … · Undo" toast)
// ---------------------------------------------------------------------------

export type RemovalKind =
  | "page"
  | "database"
  | "block"
  | "column"
  | "row"
  | "columnData"
  | "card";

export interface Removal {
  kind: RemovalKind;
  /** How many things of that kind went away. */
  count: number;
  /** Title of the removed page, when a single page was removed. */
  name?: string;
}

const PRIORITY: RemovalKind[] = [
  "page",
  "database",
  "block",
  "column",
  "row",
  "columnData",
  "card",
];

function isEmptyCell(value: unknown): boolean {
  return (
    value === undefined ||
    value === null ||
    value === "" ||
    (Array.isArray(value) && value.length === 0)
  );
}

function blockText(block: Block): string | null {
  return "text" in block && typeof block.text === "string" ? block.text : null;
}

/**
 * True when a block went away without taking content with it: an empty
 * line (Backspace on an empty line, a "/" pick that replaced it), or text
 * that was joined onto a neighbouring block (Backspace at the start of a
 * line, Delete at the end of the one above). Those are ordinary editing,
 * not deletions to offer an Undo toast for.
 */
function removedNothing(block: Block, before: Map<string, Block>, after: Block[]): boolean {
  const text = blockText(block);
  if (text === null) return false;
  if (text.trim() === "") return true;
  return after.some((b) => {
    const now = blockText(b);
    const was = before.get(b.id);
    const prior = was ? blockText(was) : null;
    return (
      now !== null &&
      prior !== null &&
      now.length === prior.length + text.length &&
      (now === prior + text || now === text + prior)
    );
  });
}

/**
 * What did `next` remove compared with `prev`? Returns the most significant
 * kind of removal (a deleted page also deletes its blocks; that reports as a
 * page), or null for an edit that removed nothing. Clearing one cell by typing
 * is ordinary editing, not a removal; changing a column's type or clearing a
 * column across several rows is.
 */
export function detectRemoval(prev: Workspace, next: Workspace): Removal | null {
  const counts = new Map<RemovalKind, number>();
  const add = (kind: RemovalKind, n = 1) => {
    if (n > 0) counts.set(kind, (counts.get(kind) ?? 0) + n);
  };
  let pageName: string | undefined;

  const nextPages = new Map(next.pages.map((p) => [p.id, p]));
  for (const page of prev.pages) {
    const after = nextPages.get(page.id);
    if (!after) {
      add("page");
      pageName = page.title;
      continue;
    }
    if (page.blocks === after.blocks) continue;
    const afterBlocks = new Map(after.blocks.map((b) => [b.id, b]));
    const beforeBlocks = new Map(page.blocks.map((b) => [b.id, b]));
    for (const block of page.blocks) {
      const kept = afterBlocks.get(block.id);
      if (!kept) {
        if (!removedNothing(block, beforeBlocks, after.blocks)) add("block");
        continue;
      }
      if (block.type === "flashcards" && kept.type === "flashcards") {
        const ids = new Set(kept.cards.map((c) => c.id));
        add("card", block.cards.filter((c) => !ids.has(c.id)).length);
      }
    }
  }

  const nextDbs = new Map(next.databases.map((d) => [d.id, d]));
  for (const db of prev.databases) {
    const after = nextDbs.get(db.id);
    if (!after) {
      add("database");
      continue;
    }
    if (db === after) continue;
    const afterProps = new Map(after.properties.map((p) => [p.id, p]));
    const afterRows = new Map(after.rows.map((r) => [r.id, r]));
    for (const prop of db.properties) {
      const kept = afterProps.get(prop.id);
      if (!kept) {
        add("column");
        continue;
      }
      let cleared = 0;
      for (const row of db.rows) {
        const afterRow = afterRows.get(row.id);
        if (!afterRow) continue;
        if (!isEmptyCell(row.cells[prop.id]) && isEmptyCell(afterRow.cells[prop.id])) {
          cleared += 1;
        }
      }
      if (cleared >= 2 || (cleared >= 1 && kept.type !== prop.type)) {
        add("columnData");
      }
    }
    add("row", db.rows.filter((r) => !afterRows.has(r.id)).length);
  }

  for (const kind of PRIORITY) {
    const count = counts.get(kind);
    if (count) {
      return kind === "page" && count === 1
        ? { kind, count, name: pageName }
        : { kind, count };
    }
  }
  return null;
}
