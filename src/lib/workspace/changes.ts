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
 */
export type ApplyMode = "rebase" | "undo" | "strict";

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
  /** Undo/redo: parts left alone because they changed since. */
  skipped: number;
  /** Strict mode: collisions that make the merge unsafe. */
  conflicts: number;
}

export function emptyReport(): MergeReport {
  return { keptBoth: 0, restored: 0, keptDeleted: 0, overwritten: [], skipped: 0, conflicts: 0 };
}

export function reportHasNews(r: MergeReport): boolean {
  return r.keptBoth + r.restored + r.keptDeleted + r.overwritten.length > 0;
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

function randomId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `id-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

class Applier {
  /** Containers created by this apply (safe to mutate). */
  private own = new WeakSet<object>();
  /** Blocks whose student version was kept as a copy: later edits to them are in the copy. */
  private forked = new Set<string>();
  root: Obj;
  report: MergeReport;

  constructor(
    doc: Obj,
    private opts: ApplyOptions,
  ) {
    this.root = doc;
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
      if (this.opts.mode !== "rebase" || !Array.isArray(arr)) return false;
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
    if (deepEqual(current, op.before)) {
      this.write(containerPath, key, op.after);
      return;
    }
    this.collide(op, containerPath, key, current);
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
    if (texts) {
      const merged = merge3(op.before as string, op.after as string, current as string);
      if (merged.ok) {
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

  /** Insert the student's version of a block as a new block right after theirs. */
  private keepBothBlocks(blockPath: Path): boolean {
    const last = blockPath[blockPath.length - 1];
    if (typeof last === "string") return false;
    const arrayPath = blockPath.slice(0, -1);
    const mine = this.opts.lookup?.(arrayPath, last.id)?.item;
    if (!mine) return false;
    const theirs = getAt(this.root, blockPath);
    // Only text blocks are worth duplicating; anything else keeps the student's value.
    if (!TEXT_BLOCK_TYPES.has(String(mine.type))) return false;
    if (isPlainObject(theirs) && typeof mine.text === "string" && mine.text === theirs.text) return false;
    const arr = this.writable(arrayPath) as unknown[];
    const copy = { ...mine, id: (this.opts.newId ?? randomId)() };
    insertAt(arr, copy, [last.id, null], true);
    this.forked.add(pathKey(blockPath));
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
    if (arr.some((x) => isIdItem(x) && x.id === op.item.id)) return; // already there
    if (this.opts.mode === "strict" && !anchorsPresent(arr, op.at)) {
      this.report.conflicts += 1;
      return;
    }
    insertAt(this.writable(op.path) as unknown[], op.item, op.at, false);
  }

  private del(op: Extract<Op, { op: "del" }>): void {
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
    const arr = getAt(this.root, op.path);
    if (!Array.isArray(arr)) return;
    const i = arr.findIndex((x) => isIdItem(x) && x.id === op.id);
    if (i < 0) return;
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
 * with `prev` (so unchanged pages, blocks and rows are the same objects).
 * Returns the patch from `prev` to `next` as well.
 */
export function shareWith<T extends object>(prev: T, next: T): { doc: T; ops: Op[] } {
  const ops = diff(prev, next);
  if (ops.length === 0) return { doc: prev, ops };
  return { doc: applyPatch(prev, ops, { mode: "undo" }).doc, ops };
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
