/**
 * Workspace undo/redo history and removal detection (pure, framework-free).
 *
 * The editor keeps whole-workspace snapshots. Edits are cheap structural
 * clones, so a snapshot per step is simple and exact: undo restores precisely
 * the prior state, whatever component made the edit.
 *
 * Typing produces one edit per keystroke, so consecutive edits made in the same
 * text field within COALESCE_MS are merged into one step: undo then removes a
 * burst of typing, not one character. Removals are never merged, so each one
 * is its own undoable step (the Undo toast targets exactly that step).
 */
import type { Workspace } from "./types";

export const HISTORY_LIMIT = 100;
export const COALESCE_MS = 1500;

export interface HistoryEntry {
  /** Monotonic id; lets an Undo toast find "its" step later. */
  id: number;
  workspace: Workspace;
}

export interface History {
  past: HistoryEntry[];
  present: HistoryEntry;
  future: HistoryEntry[];
  /** Coalescing key of the edit that produced `present` (null = never merge). */
  lastKey: string | null;
  lastAt: number;
  nextId: number;
}

export function createHistory(workspace: Workspace): History {
  return {
    past: [],
    present: { id: 0, workspace },
    future: [],
    lastKey: null,
    lastAt: 0,
    nextId: 1,
  };
}

export interface CommitOptions {
  now: number;
  /** Same non-null key within COALESCE_MS merges into the previous step. */
  coalesceKey?: string | null;
  limit?: number;
}

/** Record a new present state. Clears redo. */
export function commit(h: History, workspace: Workspace, opts: CommitOptions): History {
  const key = opts.coalesceKey ?? null;
  const merge =
    key !== null &&
    key === h.lastKey &&
    opts.now - h.lastAt <= COALESCE_MS &&
    h.past.length > 0;
  const id = h.nextId;
  if (merge) {
    return {
      ...h,
      present: { id, workspace },
      future: [],
      lastAt: opts.now,
      nextId: id + 1,
    };
  }
  const limit = opts.limit ?? HISTORY_LIMIT;
  const past = [...h.past, h.present];
  if (past.length > limit) past.splice(0, past.length - limit);
  return {
    past,
    present: { id, workspace },
    future: [],
    lastKey: key,
    lastAt: opts.now,
    nextId: id + 1,
  };
}

export function canUndo(h: History): boolean {
  return h.past.length > 0;
}

export function canRedo(h: History): boolean {
  return h.future.length > 0;
}

export function undo(h: History): History {
  if (!canUndo(h)) return h;
  const past = h.past.slice(0, -1);
  const previous = h.past[h.past.length - 1];
  return {
    ...h,
    past,
    present: previous,
    future: [h.present, ...h.future],
    lastKey: null,
  };
}

export function redo(h: History): History {
  if (!canRedo(h)) return h;
  const [next, ...future] = h.future;
  return {
    ...h,
    past: [...h.past, h.present],
    present: next,
    future,
    lastKey: null,
  };
}

/**
 * Undo back to the state just before step `entryId` was made (used by the
 * Undo toast of a removal). Later steps move onto the redo stack, so nothing
 * is lost. Returns null when that step is no longer in the current history.
 */
export function undoStep(h: History, entryId: number): History | null {
  if (h.present.id !== entryId && !h.past.some((e) => e.id === entryId)) {
    return null;
  }
  let next = h;
  while (canUndo(next)) {
    const wasTarget = next.present.id === entryId;
    next = undo(next);
    if (wasTarget) return next;
  }
  return null;
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
    for (const block of page.blocks) {
      const kept = afterBlocks.get(block.id);
      if (!kept) {
        add("block");
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
