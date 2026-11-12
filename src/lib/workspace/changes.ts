/**
 * Id-addressed changes ("patches") between two workspace documents.
 *
 * This is the model the editor's sync engine is built on: a student's work is
 * not a snapshot of the whole document but a list of changes, each addressed
 * by the ids of what it touches ("page p1 / block b7 / text"), that can be
 * re-applied on top of whatever the server holds now (another device's save,
 * the AI agent's result, a draft recovered after a crash).
 *
 *   diff(a, b)            the changes that turn `a` into `b`
 *   applyPatch(doc, ops)  apply them to any document, copy-on-write
 *   invertPatch(ops)      the changes that undo them
 *
 * Arrays whose items all carry a unique string `id` (pages, blocks, cards,
 * quiz questions, databases, columns, rows, views, options) are diffed item by
 * item: insert / delete / move by id, edits inside an item by id. Any other
 * value (text, numbers, tag lists, filters) is a single field.
 *
 * Applying a change to a document that changed meanwhile is where the rules
 * live (see `ApplyMode`). Nothing the student did is ever dropped silently: a
 * text edit that collides is merged three ways, and if that fails both
 * versions are kept; an edit to something deleted elsewhere brings it back;
 * a value the student overwrote is reported so it can be restored.
 *
 * Documents are treated as immutable: applying a patch copies only the
 * objects on the changed paths and shares everything else with the input, so
 * many versions of a large workspace cost little memory.
 */
import { MAX_FLASHCARD_TEXT, MAX_QUIZ_TEXT } from "./schema";
import { merge3 } from "./text-merge";

/** A step in a path: an object key, or an array item by id. */
export type Seg = string | { id: string };
export type Path = Seg[];

type Neighbours = [prev: string | null, next: string | null];

export type Op =
  /** Set a field. `undefined` before/after = the field is absent. */
  | { op: "set"; path: Path; before?: unknown; after?: unknown }
  /** Insert `item` into the id-array at `path`, between its neighbours. */
  | { op: "ins"; path: Path; item: IdItem; at: Neighbours }
  /** Remove `item` from the id-array at `path` (it sat between `at`). */
  | { op: "del"; path: Path; item: IdItem; at: Neighbours }
  /** Move item `id` within the id-array at `path`. */
  | { op: "mov"; path: Path; id: string; from: Neighbours; to: Neighbours };

export type IdItem = { id: string } & Record<string, unknown>;
type Obj = Record<string, unknown>;

/**
 * How `applyPatch` treats a change whose target changed meanwhile.
 *  - "rebase": replaying the student's own unsaved edits on a newer document.
 *    Text collisions merge three ways; if that fails for a block's text, the
 *    student's version is kept as a new block right after; other collisions
 *    keep the student's value and report what it replaced; an edit inside
 *    something deleted elsewhere restores it (via `lookup`).
 *  - "undo": undo/redo on top of the current document. Only changes still in
 *    place are reverted; anything changed since (by anyone) is left alone.
 *  - "strict": server-side merges. Any collision is reported in `conflicts`
 *    and the caller must refuse the merge.
 *  - "salvage": edits that may already have been applied and then changed
 *    elsewhere (an old draft whose save may or may not have landed). Nothing
 *    is overwritten or deleted: a block's different text is kept as a copy,
 *    missing items are brought back (reported), everything else is skipped
 *    and counted in `skipped`.
 *
 * Only prose (see `proseLimit`) is merged word by word; any other value that
 * changed on both sides is a single value: the student's wins (rebase,
 * reported), it is a conflict (strict), or it is left alone (undo, salvage).
 */
export type ApplyMode = "rebase" | "undo" | "strict" | "salvage";

export interface Overwrite {
  path: Path;
  /** The value from elsewhere that the student's edit replaced. */
  theirs: unknown;
  /** The student's value. */
  mine: unknown;
}

export interface MergeReport {
  /** Text edited in two places at once: both versions kept. */
  keptBoth: number;
  /** Things deleted elsewhere that the student had edited: brought back. */
  restored: number;
  /** Things the student deleted that were changed elsewhere: kept. */
  keptDeleted: number;
  /** Values changed elsewhere that the student's edit replaced. */
  overwritten: Overwrite[];
  /**
   * Parts left alone: undo/redo (changed since), salvage (could not be
   * matched safely), or a rebase edit with nowhere to go.
   */
  skipped: number;
  /** The merged document broke a size limit and was repaired (a deck split). */
  repaired: number;
  /** Strict mode: collisions that make the merge unsafe. */
  conflicts: number;
}

export function emptyReport(): MergeReport {
  return { keptBoth: 0, restored: 0, keptDeleted: 0, overwritten: [], skipped: 0, repaired: 0, conflicts: 0 };
}

/** Anything the student should be told about (a merge or a recovered draft). */
export function reportHasNews(r: MergeReport): boolean {
  return r.keptBoth + r.restored + r.keptDeleted + r.overwritten.length + r.skipped + r.repaired > 0;
}

/** Where a missing item can be found (the student's own copy), for restoring it. */
export type Lookup = (arrayPath: Path, id: string) => { item: IdItem; prev: string | null } | undefined;

export interface ApplyOptions {
  mode: ApplyMode;
  lookup?: Lookup;
  report?: MergeReport;
  /** Id for a copy of a block kept by "keep both" (defaults to a random UUID). */
  newId?: () => string;
}

// ---------------------------------------------------------------------------
// Values
// ---------------------------------------------------------------------------

export function isPlainObject(value: unknown): value is Obj {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isIdItem(value: unknown): value is IdItem {
  return isPlainObject(value) && typeof value.id === "string";
}

/** Every item is an object with a string id, and the ids are unique. */
function isIdArray(arr: readonly unknown[]): arr is IdItem[] {
  if (arr.length === 0) return false;
  const seen = new Set<string>();
  for (const item of arr) {
    if (!isIdItem(item) || seen.has(item.id)) return false;
    seen.add(item.id);
  }
  return true;
}

function idMode(a: readonly unknown[], b: readonly unknown[]): boolean {
  if (a.length === 0 && b.length === 0) return false;
  return (a.length === 0 || isIdArray(a)) && (b.length === 0 || isIdArray(b));
}

/** Structural equality for JSON values; an `undefined` field equals a missing one. */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i += 1) if (!deepEqual(a[i], b[i])) return false;
    return true;
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    for (const key of Object.keys(a)) {
      if (!deepEqual(a[key], b[key])) return false;
    }
    for (const key of Object.keys(b)) {
      if (!(key in a) && b[key] !== undefined) return false;
    }
    return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// diff
// ---------------------------------------------------------------------------

/** The changes that turn `a` into `b`, addressed by ids. Empty when equal. */
export function diff(a: unknown, b: unknown): Op[] {
  const ops: Op[] = [];
  diffInto(ops, a, b, []);
  return ops;
}

// `path` is a shared stack (pushed and popped while walking); ops get a copy.
function diffInto(ops: Op[], a: unknown, b: unknown, path: Path): void {
  if (a === b) return;
  if (isPlainObject(a) && isPlainObject(b)) {
    for (const key of Object.keys(a)) {
      path.push(key);
      diffInto(ops, a[key], b[key], path);
      path.pop();
    }
    for (const key of Object.keys(b)) {
      if (key in a) continue;
      path.push(key);
      diffInto(ops, undefined, b[key], path);
      path.pop();
    }
    return;
  }
  if (Array.isArray(a) && Array.isArray(b) && idMode(a, b)) {
    diffIdArray(ops, a as IdItem[], b as IdItem[], path);
    return;
  }
  if (!deepEqual(a, b)) ops.push({ op: "set", path: path.slice(), before: a, after: b });
}

/** Indexes (into `seq`) of a longest strictly increasing subsequence. */
function longestIncreasing(seq: readonly number[]): Set<number> {
  const tails: number[] = [];
  const prevOf = new Int32Array(seq.length).fill(-1);
  for (let i = 0; i < seq.length; i += 1) {
    let lo = 0;
    let hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (seq[tails[mid]] < seq[i]) lo = mid + 1;
      else hi = mid;
    }
    if (lo > 0) prevOf[i] = tails[lo - 1];
    tails[lo] = i;
  }
  const keep = new Set<number>();
  let k = tails.length ? tails[tails.length - 1] : -1;
  while (k >= 0) {
    keep.add(k);
    k = prevOf[k];
  }
  return keep;
}

function diffIdArray(ops: Op[], a: IdItem[], b: IdItem[], stack: Path): void {
  const path = stack.slice();
  const aIndex = new Map(a.map((item, i) => [item.id, i]));
  const bIndex = new Map(b.map((item, i) => [item.id, i]));
  const idAt = (arr: IdItem[], i: number) => (i >= 0 && i < arr.length ? arr[i].id : null);

  a.forEach((item, i) => {
    if (!bIndex.has(item.id)) {
      ops.push({ op: "del", path, item, at: [idAt(a, i - 1), idAt(a, i + 1)] });
    }
  });

  // Items kept on both sides that are not in the longest stable run moved.
  const common = a.filter((item) => bIndex.has(item.id));
  const stableIdx = longestIncreasing(common.map((item) => bIndex.get(item.id)!));
  const stable = new Set(common.filter((_, i) => stableIdx.has(i)).map((item) => item.id));

  // In b's order, so every anchor ("after prev") is already in place.
  b.forEach((item, j) => {
    const to: Neighbours = [idAt(b, j - 1), idAt(b, j + 1)];
    const ai = aIndex.get(item.id);
    if (ai === undefined) ops.push({ op: "ins", path, item, at: to });
    else if (!stable.has(item.id)) {
      ops.push({ op: "mov", path, id: item.id, from: [idAt(a, ai - 1), idAt(a, ai + 1)], to });
    }
  });

  for (const item of b) {
    const ai = aIndex.get(item.id);
    if (ai === undefined || a[ai] === item) continue;
    stack.push({ id: item.id });
    diffInto(ops, a[ai], item, stack);
    stack.pop();
  }
}

/** The changes that undo `ops` (apply in the returned order). */
export function invertPatch(ops: readonly Op[]): Op[] {
  const out: Op[] = [];
  for (let i = ops.length - 1; i >= 0; i -= 1) {
    const op = ops[i];
    switch (op.op) {
      case "set":
        out.push({ op: "set", path: op.path, before: op.after, after: op.before });
        break;
      case "ins":
        out.push({ op: "del", path: op.path, item: op.item, at: op.at });
        break;
      case "del":
        out.push({ op: "ins", path: op.path, item: op.item, at: op.at });
        break;
      case "mov":
        out.push({ op: "mov", path: op.path, id: op.id, from: op.to, to: op.from });
        break;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Reading paths
// ---------------------------------------------------------------------------

function step(node: unknown, seg: Seg): unknown {
  if (typeof seg === "string") return isPlainObject(node) ? node[seg] : undefined;
  if (!Array.isArray(node)) return undefined;
  return node.find((item) => isIdItem(item) && item.id === seg.id);
}

/** The value at `path`, or undefined. */
export function getAt(doc: unknown, path: Path): unknown {
  let node = doc;
  for (const seg of path) {
    node = step(node, seg);
    if (node === undefined) return undefined;
  }
  return node;
}

export function pathKey(path: Path): string {
  return path.map((s) => (typeof s === "string" ? `.${s}` : `#${s.id}`)).join("");
}

/** A lookup that finds missing items in another version of the document. */
export function lookupIn(doc: unknown): Lookup {
  return (arrayPath, id) => {
    const arr = getAt(doc, arrayPath);
    if (!Array.isArray(arr)) return undefined;
    const i = arr.findIndex((item) => isIdItem(item) && item.id === id);
    if (i < 0) return undefined;
    const prev = i > 0 && isIdItem(arr[i - 1]) ? (arr[i - 1] as IdItem).id : null;
    return { item: arr[i] as IdItem, prev };
  };
}

// Child lists that are part of an item's identity rather than its content:
// a restored database keeps its columns, views and select options.
const KEEP_ON_RESTORE = new Set(["properties", "views", "options"]);

/**
 * What is brought back when an item deleted elsewhere is restored because
 * the student edited something inside it: the item's own fields, with its
 * child lists emptied. The student's edits inside it are restored on their
 * own (each edited child is restored the same way), so nothing they changed
 * is lost and nothing else deleted elsewhere comes back.
 */
export function restoreShell(item: IdItem): IdItem {
  const out: IdItem = { ...item };
  for (const [key, value] of Object.entries(item)) {
    if (KEEP_ON_RESTORE.has(key)) continue;
    if (Array.isArray(value) && isIdArray(value)) out[key] = [];
  }
  return out;
}

/** The id-array paths and items an op needs to exist (for drafts' lookups). */
export function opContainers(op: Op): Array<{ arrayPath: Path; id: string }> {
  const target = op.op === "set" ? op.path.slice(0, -1) : op.path;
  const out: Array<{ arrayPath: Path; id: string }> = [];
  target.forEach((seg, i) => {
    if (typeof seg !== "string") out.push({ arrayPath: target.slice(0, i), id: seg.id });
  });
  return out;
}

// ---------------------------------------------------------------------------
// Prose fields: the only strings merged word by word
// ---------------------------------------------------------------------------

/** Keys of prose (merged as text) wherever they appear, with their length limit. */
const PROSE_KEYS: Record<string, number> = {
  title: Infinity,
  name: Infinity,
  description: Infinity,
  label: Infinity,
  caption: Infinity,
  alt: Infinity,
};
/** Prose keys of particular items (the parent list's key), with their limit. */
const PROSE_IN: Record<string, Record<string, number>> = {
  blocks: { text: Infinity },
  cards: { front: MAX_FLASHCARD_TEXT, back: MAX_FLASHCARD_TEXT },
  questions: {
    prompt: MAX_QUIZ_TEXT,
    explanation: MAX_QUIZ_TEXT,
    answerText: MAX_QUIZ_TEXT,
    topic: 200,
  },
};

/**
 * Is the string at `path` prose (block text, a title or name, a card side,
 * quiz text, a text-typed database cell)? Then two edits to it are merged
 * word by word, up to the returned length limit. Everything else (dates,
 * links, ids, icons, option choices, code) is a single value: merging
 * "2026-11-20" with "2026-12-12" token by token would invent a date nobody
 * chose. Null for those.
 */
export function proseLimit(root: unknown, path: Path): number | null {
  const key = path[path.length - 1];
  if (typeof key !== "string") return null;
  const listKey = path.length >= 3 ? path[path.length - 3] : null;
  // A database cell: prose only when its column is a text column.
  if (path.length >= 6 && path[path.length - 2] === "cells" && path[path.length - 4] === "rows") {
    const dbPath = path.slice(0, path.length - 4);
    const db = getAt(root, dbPath);
    const props = isPlainObject(db) && Array.isArray(db.properties) ? db.properties : [];
    const prop = props.find((p) => isIdItem(p) && p.id === key) as { type?: unknown } | undefined;
    return prop?.type === "text" ? Infinity : null;
  }
  if (typeof listKey === "string" && PROSE_IN[listKey]?.[key] !== undefined) {
    return PROSE_IN[listKey][key];
  }
  if (PROSE_KEYS[key] !== undefined) {
    // A grades block's title is capped by the schema.
    const container = getAt(root, path.slice(0, -1));
    if (key === "title" && isPlainObject(container) && container.type === "grades") return 200;
    return PROSE_KEYS[key];
  }
  return null;
}

// ---------------------------------------------------------------------------
// applyPatch
// ---------------------------------------------------------------------------

const TEXT_BLOCK_TYPES = new Set([
  "heading",
  "paragraph",
  "todo",
  "bulleted_list_item",
  "numbered_list_item",
  "quote",
  "callout",
]);

const UNSAFE_KEYS = new Set(["__proto__", "constructor", "prototype"]);

function randomId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `id-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

class Applier {
  /** Containers created by this apply (safe to mutate). */
  private own = new WeakSet<object>();
  /** Blocks whose student version was kept as a copy: later edits to them are in the copy. */
  private forked = new Set<string>();
  root: Obj;
  /** The document before this apply (the other writer's version, when merging). */
  readonly start: Obj;
  report: MergeReport;

  constructor(
    doc: Obj,
    private opts: ApplyOptions,
  ) {
    this.root = doc;
    this.start = doc;
    this.report = opts.report ?? emptyReport();
  }

  private copy<T extends object>(value: T): T {
    if (this.own.has(value)) return value;
    const c = (Array.isArray(value) ? value.slice() : { ...value }) as T;
    this.own.add(c);
    return c;
  }

  /** The container at `path`, copied along the way so it can be changed. */
  private writable(path: Path): Obj | unknown[] | undefined {
    this.root = this.copy(this.root);
    let node: Obj | unknown[] = this.root;
    for (const seg of path) {
      let child: unknown;
      if (typeof seg === "string") {
        if (!isPlainObject(node)) return undefined;
        child = node[seg];
        if (typeof child !== "object" || child === null) return undefined;
        const c = this.copy(child as object) as Obj | unknown[];
        node[seg] = c;
        node = c;
      } else {
        if (!Array.isArray(node)) return undefined;
        const i = node.findIndex((item) => isIdItem(item) && item.id === seg.id);
        if (i < 0) return undefined;
        child = node[i];
        const c = this.copy(child as object) as Obj;
        node[i] = c;
        node = c;
      }
    }
    return node;
  }

  apply(ops: readonly Op[]): void {
    for (const op of ops) {
      if (op.path.some((seg) => typeof seg === "string" && UNSAFE_KEYS.has(seg))) {
        this.miss(); // never step onto an object's prototype
        continue;
      }
      if (this.isForked(op.path)) continue;
      switch (op.op) {
        case "set":
          this.set(op);
          break;
        case "ins":
          this.ins(op);
          break;
        case "del":
          this.del(op);
          break;
        case "mov":
          this.mov(op);
          break;
      }
    }
  }

  private isForked(path: Path): boolean {
    if (this.forked.size === 0) return false;
    for (let i = 1; i <= path.length; i += 1) {
      if (this.forked.has(pathKey(path.slice(0, i)))) return true;
    }
    return false;
  }

  /**
   * Make sure every item on `path` exists. In rebase mode an item deleted
   * elsewhere is restored from the student's copy; otherwise false.
   */
  private ensure(path: Path): boolean {
    for (let i = 0; i < path.length; i += 1) {
      const seg = path[i];
      if (typeof seg === "string") continue;
      const arrayPath = path.slice(0, i);
      const arr = getAt(this.root, arrayPath);
      if (Array.isArray(arr) && arr.some((x) => isIdItem(x) && x.id === seg.id)) continue;
      const mayRestore = this.opts.mode === "rebase" || this.opts.mode === "salvage";
      if (!mayRestore || !Array.isArray(arr)) return false;
      const found = this.opts.lookup?.(arrayPath, seg.id);
      if (!found) return false;
      const target = this.writable(arrayPath) as unknown[];
      insertAt(target, restoreShell(found.item), [found.prev, null], true);
      this.report.restored += 1;
    }
    return true;
  }

  private set(op: Extract<Op, { op: "set" }>): void {
    const containerPath = op.path.slice(0, -1);
    const key = op.path[op.path.length - 1];
    if (typeof key !== "string") return;
    if (!this.ensure(containerPath)) {
      this.miss();
      return;
    }
    const container = getAt(this.root, containerPath);
    if (!isPlainObject(container)) {
      this.miss();
      return;
    }
    const current = container[key];
    if (deepEqual(current, op.after)) return;
    if (this.opts.mode === "salvage") {
      this.salvageSet(op, containerPath, key);
      return;
    }
    if (deepEqual(current, op.before)) {
      this.write(containerPath, key, op.after);
      return;
    }
    this.collide(op, containerPath, key, current);
  }

  /**
   * Salvage: the value may have been saved already and changed since, so it
   * is never written over. A block's text is kept as a copy; anything else is
   * left as it is and counted.
   */
  private salvageSet(op: Extract<Op, { op: "set" }>, containerPath: Path, key: string): void {
    const blockList = containerPath.length >= 2 ? containerPath[containerPath.length - 2] : null;
    if (blockList === "blocks" && key === "text" && typeof op.after === "string" && op.after.trim()) {
      if (this.keepBothBlocks(containerPath)) return;
    }
    this.report.skipped += 1;
  }

  private write(containerPath: Path, key: string, value: unknown): void {
    const c = this.writable(containerPath);
    if (!isPlainObject(c)) return;
    if (value === undefined) delete c[key];
    else c[key] = value;
  }

  private miss(): void {
    if (this.opts.mode === "strict") this.report.conflicts += 1;
    else this.report.skipped += 1;
  }

  /** The target changed meanwhile, to something else than the student's value. */
  private collide(
    op: Extract<Op, { op: "set" }>,
    containerPath: Path,
    key: string,
    current: unknown,
  ): void {
    const { mode } = this.opts;
    const texts =
      typeof op.before === "string" && typeof op.after === "string" && typeof current === "string";
    const limit = texts ? proseLimit(this.root, op.path) : null;
    if (limit !== null) {
      const merged = merge3(op.before as string, op.after as string, current as string);
      // A merge longer than the field allows is not a clean merge either.
      if (merged.ok && merged.text.length <= limit) {
        this.write(containerPath, key, merged.text);
        return;
      }
    }
    if (mode === "undo") {
      this.report.skipped += 1;
      return;
    }
    if (mode === "strict") {
      this.report.conflicts += 1;
      return;
    }
    // Rebase. A block's text or type edited on both sides: keep both blocks.
    const blockPos = containerPath.length >= 2 ? containerPath[containerPath.length - 2] : null;
    if (blockPos === "blocks" && (key === "text" || key === "type") && this.keepBothBlocks(containerPath)) {
      return;
    }
    this.write(containerPath, key, op.after);
    this.report.overwritten.push({ path: op.path, theirs: current, mine: op.after });
  }

  /**
   * A block's text changed on both sides and cannot be merged: keep both.
   * Rebase: the student's version stays where it is (what they are typing,
   * under their cursor) and the other version is inserted right after it.
   * Salvage: the saved version stays and the old draft's text is the copy.
   * The copy carries `keptFrom` (the block it was kept next to), so every
   * device shows it marked, with a way to use it or discard it.
   */
  private keepBothBlocks(blockPath: Path): boolean {
    const last = blockPath[blockPath.length - 1];
    if (typeof last === "string") return false;
    const arrayPath = blockPath.slice(0, -1);
    const mine = this.opts.lookup?.(arrayPath, last.id)?.item;
    const theirs = getAt(this.root, blockPath);
    if (!mine || !isPlainObject(theirs)) return false;
    // Only text blocks are worth duplicating; anything else keeps the student's value.
    if (!TEXT_BLOCK_TYPES.has(String(mine.type))) return false;
    if (typeof mine.text === "string" && mine.text === theirs.text) return false;
    const arr = this.writable(arrayPath) as unknown[];
    const i = arr.findIndex((x) => isIdItem(x) && x.id === last.id);
    if (i < 0) return false;
    const newId = (this.opts.newId ?? randomId)();
    if (this.opts.mode === "salvage") {
      arr.splice(i + 1, 0, { ...mine, id: newId, keptFrom: last.id });
    } else {
      arr.splice(i, 1, mine, { ...theirs, id: newId, keptFrom: last.id });
    }
    this.forked.add(pathKey(blockPath));
    this.report.keptBoth += 1;
    return true;
  }

  /**
   * Rebase: the student brings back a text block (an undone deletion) that
   * another writer had brought back too, with other text. Both texts stay:
   * the other writer's block where it is, the student's as a marked copy
   * right after it (one tap to use it or discard it).
   */
  private keepInsertedCopy(op: Extract<Op, { op: "ins" }>, existing: IdItem): boolean {
    const mine = op.item as Obj;
    const theirs = existing as Obj;
    if (op.path[op.path.length - 1] !== "blocks") return false;
    if (!TEXT_BLOCK_TYPES.has(String(mine.type)) || typeof mine.text !== "string" || !mine.text.trim()) return false;
    if (mine.text === theirs.text) return false;
    const arr = this.writable(op.path) as unknown[];
    const i = arr.findIndex((x) => isIdItem(x) && x.id === existing.id);
    if (i < 0) return false;
    const newId = (this.opts.newId ?? randomId)();
    arr.splice(i + 1, 0, { ...mine, id: newId, keptFrom: existing.id });
    this.report.keptBoth += 1;
    return true;
  }

  private ins(op: Extract<Op, { op: "ins" }>): void {
    if (!this.ensure(op.path)) {
      this.miss();
      return;
    }
    const arr = getAt(this.root, op.path);
    if (!Array.isArray(arr)) {
      this.miss();
      return;
    }
    const existing = arr.find((x) => isIdItem(x) && x.id === op.item.id);
    if (existing !== undefined) {
      // Already there. If with other content (undoing a deletion of something
      // another writer brought back from an older copy), say so.
      if (!deepEqual(existing, op.item)) {
        if (this.opts.mode === "undo") this.report.skipped += 1;
        else if (this.opts.mode === "strict") this.report.conflicts += 1;
        else if (this.opts.mode === "rebase" && !this.keepInsertedCopy(op, existing)) this.report.skipped += 1;
      }
      return;
    }
    if (this.opts.mode === "strict" && !anchorsPresent(arr, op.at)) {
      this.report.conflicts += 1;
      return;
    }
    insertAt(this.writable(op.path) as unknown[], op.item, op.at, false);
    // Salvage cannot tell a new item from one deleted elsewhere since: say so.
    if (this.opts.mode === "salvage") this.report.restored += 1;
  }

  private del(op: Extract<Op, { op: "del" }>): void {
    if (this.opts.mode === "salvage") {
      this.report.skipped += 1;
      return;
    }
    const arr = getAt(this.root, op.path);
    if (!Array.isArray(arr)) return; // its container is gone too
    const i = arr.findIndex((x) => isIdItem(x) && x.id === op.item.id);
    if (i < 0) return; // already gone
    if (!deepEqual(arr[i], op.item)) {
      // Changed elsewhere since: deleting it would destroy that change.
      if (this.opts.mode === "rebase") this.report.keptDeleted += 1;
      else if (this.opts.mode === "undo") this.report.skipped += 1;
      else this.report.conflicts += 1;
      return;
    }
    const target = this.writable(op.path) as unknown[];
    target.splice(
      target.findIndex((x) => isIdItem(x) && x.id === op.item.id),
      1,
    );
  }

  private mov(op: Extract<Op, { op: "mov" }>): void {
    if (this.opts.mode === "salvage") {
      this.report.skipped += 1;
      return;
    }
    const arr = getAt(this.root, op.path);
    if (!Array.isArray(arr)) return;
    const i = arr.findIndex((x) => isIdItem(x) && x.id === op.id);
    if (i < 0) return;
    const idAt = (list: unknown[], k: number) =>
      k >= 0 && k < list.length && isIdItem(list[k]) ? (list[k] as IdItem).id : null;
    if (idAt(arr, i - 1) === op.to[0] && idAt(arr, i + 1) === op.to[1]) return; // already there
    if (this.opts.mode === "strict") {
      // Server-side merges: if the other writer moved this item (or changed
      // what is next to it), placing it by our anchors would undo that.
      const theirs = getAt(this.start, op.path);
      const j = Array.isArray(theirs) ? theirs.findIndex((x) => isIdItem(x) && x.id === op.id) : -1;
      if (j < 0 || idAt(theirs as unknown[], j - 1) !== op.from[0] || idAt(theirs as unknown[], j + 1) !== op.from[1]) {
        this.report.conflicts += 1;
        return;
      }
    }
    const [prev, next] = op.to;
    const has = (id: string | null) => id !== null && id !== op.id && arr.some((x) => isIdItem(x) && x.id === id);
    if (!(prev === null || has(prev)) && !has(next)) {
      if (this.opts.mode === "strict") this.report.conflicts += 1;
      return;
    }
    const target = this.writable(op.path) as unknown[];
    const [item] = target.splice(i, 1);
    insertAt(target, item, op.to, false);
  }
}

function anchorsPresent(arr: unknown[], [prev, next]: Neighbours): boolean {
  const has = (id: string) => arr.some((x) => isIdItem(x) && x.id === id);
  return (prev === null || has(prev)) && (next === null || has(next) || prev !== null);
}

/**
 * Insert after `prev` if it is there, else before `next`, else where the
 * item was (first when it had no predecessor, otherwise last).
 */
function insertAt(arr: unknown[], item: unknown, [prev, next]: Neighbours, preferEnd: boolean): void {
  const indexOf = (id: string) => arr.findIndex((x) => isIdItem(x) && x.id === id);
  if (prev !== null) {
    const i = indexOf(prev);
    if (i >= 0) {
      arr.splice(i + 1, 0, item);
      return;
    }
  }
  if (next !== null) {
    const i = indexOf(next);
    if (i >= 0) {
      arr.splice(i, 0, item);
      return;
    }
  }
  if (prev === null && !preferEnd) arr.unshift(item);
  else arr.push(item);
}

/**
 * Apply `ops` to `doc` without changing it: returns a new document that
 * shares every untouched object with `doc`, and a report of what had to be
 * reconciled (see `ApplyMode`).
 */
export function applyPatch<T extends object>(
  doc: T,
  ops: readonly Op[],
  opts: ApplyOptions,
): { doc: T; report: MergeReport } {
  if (ops.length === 0) return { doc, report: opts.report ?? emptyReport() };
  const applier = new Applier(doc as unknown as Obj, opts);
  applier.apply(ops);
  return { doc: applier.root as unknown as T, report: applier.report };
}

/**
 * The same document as `next`, sharing every part that is equal to `prev`
 * with `prev` (so unchanged pages, blocks and rows are the same objects, and
 * only what changed re-renders). `changed` is false when the two are equal
 * (then `doc` is `prev` itself). One pass over the document.
 */
export function shareWith<T extends object>(prev: T, next: T): { doc: T; changed: boolean } {
  // Built from `next` directly (not by replaying a patch on `prev`): several
  // moves in one list replayed one by one need not give `next`'s order.
  const doc = share(prev, next) as T;
  return { doc, changed: doc !== prev };
}

/** `next`, with every part deep-equal to the matching part of `prev` taken from `prev`. */
function share(prev: unknown, next: unknown): unknown {
  if (prev === next) return prev;
  if (Array.isArray(next)) {
    if (!Array.isArray(prev)) return next;
    const byId = new Map<string, unknown>();
    for (const item of prev) if (isIdItem(item)) byId.set(item.id, item);
    let same = prev.length === next.length;
    const out = next.map((item, i) => {
      const old = isIdItem(item) ? byId.get(item.id) : prev[i];
      const shared = old === undefined ? item : share(old, item);
      if (shared !== prev[i]) same = false;
      return shared;
    });
    return same ? prev : out;
  }
  if (isPlainObject(next)) {
    if (!isPlainObject(prev)) return next;
    const keys = Object.keys(next);
    let same = keys.length === Object.keys(prev).length;
    const out: Record<string, unknown> = {};
    for (const k of keys) {
      const has = Object.prototype.hasOwnProperty.call(prev, k);
      const shared = has ? share(prev[k], next[k]) : next[k];
      if (!has || shared !== prev[k]) same = false;
      out[k] = shared;
    }
    return same ? prev : out;
  }
  return next;
}

/** Rough size of a patch in bytes (for capping undo history). */
export function patchBytes(ops: readonly Op[]): number {
  let n = 0;
  for (const op of ops) {
    n += 64;
    const values =
      op.op === "set" ? [op.before, op.after] : op.op === "mov" ? [] : [op.item];
    for (const v of values) {
      if (typeof v === "string") n += v.length * 2;
      else if (v !== undefined) n += JSON.stringify(v)?.length ?? 0;
    }
  }
  return n;
}
