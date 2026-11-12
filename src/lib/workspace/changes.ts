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
 * live (see `ApplyMode`). Nothing the student did is ever dropped silently:
 * every change either lands, or its content is kept next to what is there (a
 * marked copy of the text), or it is listed in the report with the item it
 * belongs to, so the editor can say exactly what happened and offer it back.
 *
 * Documents are treated as immutable: applying a patch copies only the
 * objects on the changed paths and shares everything else with the input, so
 * many versions of a large workspace cost little memory.
 */
import { MAX_FLASHCARD_TEXT, MAX_QUIZ_TEXT } from "./schema";
import { merge3, tokenize } from "./text-merge";

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
 *
 *  - "rebase": the student's own unsaved edits, replayed on a newer document
 *    whose common ancestor is known (the version they were made on). Prose
 *    that collides merges three ways; if that fails for a block's text, both
 *    versions are kept (the student's stays in place, the other one becomes a
 *    marked copy right after); any other value that collides: the student's
 *    wins and what it replaced is listed in `overwritten`; an edit inside
 *    something deleted elsewhere restores it (via `lookup`).
 *  - "recover": edits recovered from a tab that is gone (its local draft),
 *    replayed later. The ancestor is known, but the edits are older than what
 *    the document holds now, so they never win: prose that collides merges
 *    three ways, else the recovered text is kept as a marked copy after the
 *    current block; any other value that collides stays as it is and the
 *    recovered value is listed in `unapplied`.
 *    What still fits ("the document holds the value the edit started from")
 *    simply applies only with `asLeft`: the caller knows the document is as
 *    that tab left it. Without it, "still the same value" cannot tell a value
 *    nobody touched from one that was changed and changed back since (set and
 *    undone, deleted and restored), so nothing that is there is replaced,
 *    shortened or removed: a value it would replace stays and is listed in
 *    `unapplied`; text is changed only by adding to it, anything else keeps
 *    both versions; deletions and moves are not repeated (`skipped`). New
 *    items, fields that hold nothing and re-run edits go in either way.
 *  - "keep": edits whose ancestor is NOT known (it cannot be told whether
 *    they were already saved once and changed elsewhere since). Additive
 *    only: missing items are inserted and absent fields are set (both listed
 *    as `restored`); a block text that differs is kept as a marked copy; any
 *    other value that differs is left alone and listed in `unapplied`;
 *    deletions and moves are not repeated (`skipped`). Nothing on the
 *    document is replaced or removed.
 *  - "undo": undo/redo on top of the current document. Only changes still in
 *    place are reverted; anything changed since (by anyone) is left alone.
 *  - "strict": server-side merges (the AI agent's result). Any collision is
 *    counted in `conflicts` and the caller must refuse the merge.
 *
 * Only prose (see `proseLimit`) is merged word by word. Where both sides hold
 * a container at the same place (a settings object each of them created, a
 * list of items each of them started), the two are merged inside, key by key
 * and item by item, in every mode: a grading scheme set up on two devices
 * keeps the categories of both. An item both sides hold under one id with
 * different content and no common ancestor (each inserted it) is merged the
 * "keep" way, whatever the mode.
 */
export type ApplyMode = "rebase" | "recover" | "keep" | "undo" | "strict";

export interface Overwrite {
  path: Path;
  /** The value from elsewhere (what the document held). */
  theirs: unknown;
  /** The student's value. */
  mine: unknown;
}

export type ReportKind = "keptBoth" | "restored" | "keptDeleted" | "skipped";

export interface MergeReport {
  /** Text edited in two places at once: both versions kept. */
  keptBoth: number;
  /** Things that were not there (deleted elsewhere, or never saved): brought back. */
  restored: number;
  /** Things the student deleted that were changed elsewhere: kept. */
  keptDeleted: number;
  /** "rebase": values changed elsewhere that the student's edit replaced. */
  overwritten: Overwrite[];
  /** "recover" / "keep": the student's values that were not applied. */
  unapplied: Overwrite[];
  /**
   * Parts left alone: undo/redo (changed since), a deletion or move that was
   * not repeated ("keep"), or an edit with nowhere to go.
   */
  skipped: number;
  /** The merged document broke a size limit and was repaired (a deck split). */
  repaired: number;
  /** Strict mode: collisions that make the merge unsafe. */
  conflicts: number;
  /** The item or field each of the four counts above is about, in order. */
  where: Array<{ kind: ReportKind; path: Path }>;
}

export function emptyReport(): MergeReport {
  return {
    keptBoth: 0,
    restored: 0,
    keptDeleted: 0,
    overwritten: [],
    unapplied: [],
    skipped: 0,
    repaired: 0,
    conflicts: 0,
    where: [],
  };
}

/** Anything the student should be told about (a merge or a recovered draft). */
export function reportHasNews(r: MergeReport): boolean {
  return (
    r.keptBoth + r.restored + r.keptDeleted + r.overwritten.length + r.unapplied.length + r.skipped + r.repaired > 0
  );
}

/** `into` with everything `more` reports added (counts, lists, places). */
export function addReport(into: MergeReport, more: MergeReport): MergeReport {
  return {
    keptBoth: into.keptBoth + more.keptBoth,
    restored: into.restored + more.restored,
    keptDeleted: into.keptDeleted + more.keptDeleted,
    overwritten: [...into.overwritten, ...more.overwritten],
    unapplied: [...into.unapplied, ...more.unapplied],
    skipped: into.skipped + more.skipped,
    repaired: into.repaired + more.repaired,
    conflicts: into.conflicts + more.conflicts,
    where: [...into.where, ...more.where],
  };
}

/** Where a missing item can be found (the student's own copy), for restoring it. */
export type Lookup = (arrayPath: Path, id: string) => { item: IdItem; prev: string | null } | undefined;

export interface ApplyOptions {
  mode: ApplyMode;
  lookup?: Lookup;
  report?: MergeReport;
  /**
   * "rebase" only: a single value that collides is left as it is and listed
   * in `unapplied` (as in "recover") instead of the student's winning. For
   * replaying an undo: what was changed elsewhere since is not reverted.
   */
  yieldValues?: boolean;
  /**
   * "recover" only: the document is known to be as the gone tab left it
   * (nothing was saved since, nothing edited in this browser since). See
   * `ApplyMode`.
   */
  asLeft?: boolean;
  /** Id for a copy of a block kept by "keep both" (defaults to a random UUID). */
  newId?: () => string;
}

// ---------------------------------------------------------------------------
// Values
// ---------------------------------------------------------------------------

export function isPlainObject(value: unknown): value is Obj {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Does `next` hold everything `text` holds, in order (it only adds to it)? */
function onlyAddsTo(text: string, next: string): boolean {
  const words = (t: string) => tokenize(t).filter((token) => token.trim() !== "");
  const want = words(text);
  let i = 0;
  for (const token of words(next)) {
    if (i < want.length && token === want[i]) i += 1;
  }
  return i === want.length;
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

/** A container holding nothing: an empty list, or an object of only such containers. */
function isHollow(value: unknown): boolean {
  if (Array.isArray(value)) return value.length === 0;
  return isPlainObject(value) && Object.values(value).every(isHollow);
}

/** A list addressed by id: empty, or every item carries a unique string id. */
function isIdList(arr: readonly unknown[]): boolean {
  return arr.length === 0 || isIdArray(arr);
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
  /**
   * Set while merging an item both sides hold with no common ancestor: the
   * student's copy of it and where it sits (see `mergeInto`).
   */
  private baseless: { path: Path; item: IdItem } | null = null;
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
    for (const op of ops) this.applyOne(op);
  }

  private applyOne(op: Op): void {
    if (op.path.some((seg) => typeof seg === "string" && UNSAFE_KEYS.has(seg))) {
      this.miss(op.path); // never step onto an object's prototype
      return;
    }
    if (this.isForked(op.path)) return;
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

  private isForked(path: Path): boolean {
    if (this.forked.size === 0) return false;
    for (let i = 1; i <= path.length; i += 1) {
      if (this.forked.has(pathKey(path.slice(0, i)))) return true;
    }
    return false;
  }

  private note(kind: ReportKind, path: Path): void {
    this.report[kind] += 1;
    this.report.where.push({ kind, path });
  }

  /** A change with nowhere to go. */
  private miss(path: Path): void {
    if (this.opts.mode === "strict") this.report.conflicts += 1;
    else this.note("skipped", path);
  }

  /** The ancestor of the value being changed is not known. */
  private get noBase(): boolean {
    return this.opts.mode === "keep" || this.baseless !== null;
  }

  /** The student's edits lose a collision (they are older, or their ancestor is unknown). */
  private get yields(): boolean {
    return this.opts.mode === "recover" || this.noBase;
  }

  /** Recovered edits on a document that may have changed and changed back since (see `ApplyMode`). */
  private get cautious(): boolean {
    return this.opts.mode === "recover" && !this.opts.asLeft;
  }

  /**
   * Make sure everything on `path` exists, ending in a container of kind
   * `leaf`. When replaying the student's edits, what is gone is brought
   * back: an item deleted elsewhere from the student's copy (via `lookup`),
   * a settings object or list removed elsewhere as an empty one (the edit
   * then puts into it what the student changed). Otherwise false.
   */
  private ensure(path: Path, leaf: "object" | "array"): boolean {
    const { mode } = this.opts;
    const mayRestore = mode === "rebase" || mode === "recover" || mode === "keep";
    for (let i = 0; i < path.length; i += 1) {
      const seg = path[i];
      const here = path.slice(0, i);
      if (typeof seg === "string") {
        const parent = getAt(this.root, here);
        if (!isPlainObject(parent)) return false;
        if (parent[seg] !== undefined) continue;
        if (!mayRestore) return false;
        const next = i + 1 < path.length ? path[i + 1] : null;
        const wantArray = next === null ? leaf === "array" : typeof next !== "string";
        const target = this.writable(here);
        if (!isPlainObject(target)) return false;
        const made: Obj | unknown[] = wantArray ? [] : {};
        this.own.add(made);
        target[seg] = made;
        this.note("restored", [...here, seg]);
        continue;
      }
      const arr = getAt(this.root, here);
      if (Array.isArray(arr) && arr.some((x) => isIdItem(x) && x.id === seg.id)) continue;
      if (!mayRestore || !Array.isArray(arr)) return false;
      const found = this.opts.lookup?.(here, seg.id);
      if (!found) return false;
      const target = this.writable(here) as unknown[];
      insertAt(target, restoreShell(found.item), [found.prev, null], true);
      this.note("restored", [...here, seg]);
    }
    return true;
  }

  private set(op: Extract<Op, { op: "set" }>): void {
    const containerPath = op.path.slice(0, -1);
    const key = op.path[op.path.length - 1];
    if (typeof key !== "string") return;
    if (!this.ensure(containerPath, "object")) {
      this.miss(op.path);
      return;
    }
    const container = getAt(this.root, containerPath);
    if (!isPlainObject(container)) {
      this.miss(op.path);
      return;
    }
    const current = container[key];
    if (deepEqual(current, op.after)) return;
    if (this.noBase) {
      // Whether the document's value is the one this edit started from cannot
      // be told: only a field that holds nothing is filled in.
      if (current === undefined) {
        this.write(containerPath, key, op.after);
        if (this.opts.mode === "keep") this.note("restored", op.path);
        return;
      }
      this.collide(op, containerPath, key, current);
      return;
    }
    if (deepEqual(current, op.before)) {
      if (this.cautious && current !== undefined) {
        // It may have been changed and changed back since: text is only added
        // to, nothing else that is there is replaced.
        const adds =
          typeof current === "string" &&
          typeof op.after === "string" &&
          proseLimit(this.root, op.path) !== null &&
          onlyAddsTo(current, op.after);
        if (!adds) {
          this.yieldTo(op, containerPath, key, current);
          return;
        }
      }
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

  /** The target holds something else than the student's value (and than what they started from, if known). */
  private collide(
    op: Extract<Op, { op: "set" }>,
    containerPath: Path,
    key: string,
    current: unknown,
  ): void {
    const { mode } = this.opts;
    if (this.mergeContainers(op, current)) return;
    const texts =
      typeof op.before === "string" && typeof op.after === "string" && typeof current === "string";
    const limit = texts && !this.noBase ? proseLimit(this.root, op.path) : null;
    if (limit !== null) {
      const merged = merge3(op.before as string, op.after as string, current as string);
      // A merge longer than the field allows is not a clean merge either.
      // (Nor, for cautious recovered edits, one that takes words out.)
      if (
        merged.ok &&
        merged.text.length <= limit &&
        (!this.cautious || onlyAddsTo(current as string, merged.text))
      ) {
        this.write(containerPath, key, merged.text);
        return;
      }
    }
    if (mode === "undo") {
      this.note("skipped", op.path);
      return;
    }
    if (mode === "strict") {
      this.report.conflicts += 1;
      return;
    }
    // A block's text or type differs on both sides: keep both blocks.
    if (this.keepBothAt(op, containerPath, key)) return;
    if (this.yields || this.opts.yieldValues) {
      this.offer(op, current);
      return;
    }
    this.write(containerPath, key, op.after);
    this.report.overwritten.push({ path: op.path, theirs: current, mine: op.after });
  }

  /** A block's text or type that differs on both sides: both blocks are kept. */
  private keepBothAt(op: Extract<Op, { op: "set" }>, containerPath: Path, key: string): boolean {
    const blockPos = containerPath.length >= 2 ? containerPath[containerPath.length - 2] : null;
    return (
      blockPos === "blocks" &&
      (key === "text" || key === "type") &&
      this.keepBothBlocks(containerPath, key === "text" && typeof op.after === "string" ? op.after : undefined)
    );
  }

  /** The student's value did not go in: listed in `unapplied` (the banner offers it). */
  private offer(op: Extract<Op, { op: "set" }>, current: unknown): void {
    const at = pathKey(op.path);
    const known = this.report.unapplied.find((u) => pathKey(u.path) === at);
    // The latest value the student gave it is the one on offer.
    if (known) known.mine = op.after;
    else this.report.unapplied.push({ path: op.path, theirs: current, mine: op.after });
  }

  /**
   * The student's value does not go in although it fits: what is there
   * stays. A paragraph's text is kept as a marked copy next to it; any other
   * value is offered.
   */
  private yieldTo(op: Extract<Op, { op: "set" }>, containerPath: Path, key: string, current: unknown): void {
    if (this.keepBothAt(op, containerPath, key)) return;
    this.offer(op, current);
  }

  /**
   * Both sides hold a container at this place (each created the settings
   * object, each started the list): merge inside it instead of letting one
   * replace the other. `diff` only emits a whole container as one value when
   * the student's side had none before, so the student's part is "everything
   * in it". The reverse too: the student removed a container (undid creating
   * it) that holds more by now: only what they had put there goes.
   */
  private mergeContainers(op: Extract<Op, { op: "set" }>, current: unknown): boolean {
    const { before, after } = op;
    const sub: Op[] = [];
    if (after === undefined) {
      if (this.noBase || !this.takeOut(op.path, before, current)) return false;
      // Nothing left in it: the container itself goes, as the student asked.
      if (isHollow(getAt(this.root, op.path))) {
        this.write(op.path.slice(0, -1), op.path[op.path.length - 1] as string, undefined);
      }
      return true;
    }
    if (isPlainObject(after) && isPlainObject(current)) {
      const from = !this.noBase && isPlainObject(before) ? before : {};
      diffInto(sub, from, after, op.path.slice());
    } else if (Array.isArray(after) && Array.isArray(current) && isIdList(after) && isIdList(current)) {
      const from = !this.noBase && Array.isArray(before) && isIdList(before) ? (before as IdItem[]) : [];
      diffIdArray(sub, from, after as IdItem[], op.path.slice());
    } else {
      return false;
    }
    this.apply(sub);
    return true;
  }

  /**
   * The student removed the container at `path` (it held `before`), and it
   * holds more by now: take out what they had put there. Only lists are
   * emptied of the student's items (each one only if nobody changed it
   * since), inside nested settings too; keys and plain values stay (a count
   * or a date is part of a whole, and a list may be required to exist).
   * False when there is no list in it to take anything out of.
   */
  private takeOut(path: Path, before: unknown, current: unknown): boolean {
    if (Array.isArray(before) && isIdArray(before) && Array.isArray(current) && isIdList(current)) {
      const sub: Op[] = [];
      diffIdArray(sub, before, [], path.slice());
      this.apply(sub);
      return true;
    }
    if (!isPlainObject(before) || !isPlainObject(current)) return false;
    let any = false;
    for (const key of Object.keys(before)) {
      if (this.takeOut([...path, key], before[key], current[key])) any = true;
    }
    return any;
  }

  /** The student's version of the block at `blockPath`. */
  private mineAt(blockPath: Path): IdItem | undefined {
    if (this.baseless) {
      const inside = getAt(this.baseless.item, blockPath.slice(this.baseless.path.length));
      return isIdItem(inside) ? inside : undefined;
    }
    const last = blockPath[blockPath.length - 1];
    if (typeof last === "string") return undefined;
    return this.opts.lookup?.(blockPath.slice(0, -1), last.id)?.item;
  }

  /**
   * A block's text differs on both sides and cannot be merged: keep both.
   * Rebase: the student's version stays where it is (what they are typing,
   * under their cursor) and the other version is inserted right after it.
   * Otherwise (the student's edits yield): the document's version stays and
   * the student's text is the copy. The copy carries `keptFrom` (the block it
   * was kept next to), so every device shows it marked, with a way to use it
   * or discard it.
   */
  private keepBothBlocks(blockPath: Path, text?: string): boolean {
    const last = blockPath[blockPath.length - 1];
    if (typeof last === "string") return false;
    const arrayPath = blockPath.slice(0, -1);
    const theirs = getAt(this.root, blockPath);
    if (!isIdItem(theirs)) return false;
    // Without the student's copy of the block (a draft that did not keep
    // one), their text on the block as it is now is their version.
    const mine = this.mineAt(blockPath) ?? (text !== undefined ? { ...theirs, text } : undefined);
    if (!mine) return false;
    // Only text blocks are worth duplicating; anything else is a single value.
    if (!TEXT_BLOCK_TYPES.has(String(mine.type))) return false;
    if (typeof mine.text !== "string" || mine.text === theirs.text) return false;
    const arr = this.writable(arrayPath) as unknown[];
    const i = arr.findIndex((x) => isIdItem(x) && x.id === last.id);
    if (i < 0) return false;
    if (
      this.yields &&
      arr.some((x) => isPlainObject(x) && x.keptFrom === last.id && x.text === mine.text && x.type === mine.type)
    ) {
      // That very version is already kept next to it (the same edits applied
      // once more): nothing to add.
      this.forked.add(pathKey(blockPath));
      return true;
    }
    const newId = (this.opts.newId ?? randomId)();
    if (this.yields) {
      arr.splice(i + 1, 0, { ...mine, id: newId, keptFrom: last.id });
    } else {
      arr.splice(i, 1, mine, { ...theirs, id: newId, keptFrom: last.id });
    }
    this.forked.add(pathKey(blockPath));
    this.note("keptBoth", blockPath);
    return true;
  }

  /**
   * An item both sides hold under one id, with different content and no
   * common ancestor (each inserted it: the student typed on in a paragraph
   * whose first words another writer already holds, or both brought the same
   * deleted block back). Merged the "keep" way whatever the mode: what the
   * student's copy has and the document lacks is added; a block text that
   * differs is kept as a marked copy; any other value that differs stays and
   * is listed in `unapplied`. Never skipped without a trace.
   */
  private mergeInto(itemPath: Path, existing: IdItem, mine: IdItem): void {
    const sub: Op[] = [];
    diffInto(sub, existing, mine, itemPath.slice());
    const outer = this.baseless;
    this.baseless = { path: itemPath, item: mine };
    try {
      for (const op of sub) {
        // What the document has and the student's copy lacks is not a deletion.
        if (op.op === "del" || op.op === "mov") continue;
        this.applyOne(op);
      }
    } finally {
      this.baseless = outer;
    }
  }

  private ins(op: Extract<Op, { op: "ins" }>): void {
    if (!this.ensure(op.path, "array")) {
      this.miss(op.path);
      return;
    }
    const arr = getAt(this.root, op.path);
    if (!Array.isArray(arr)) {
      this.miss(op.path);
      return;
    }
    const itemPath: Path = [...op.path, { id: op.item.id }];
    const existing = arr.find((x) => isIdItem(x) && x.id === op.item.id) as IdItem | undefined;
    if (existing !== undefined) {
      if (deepEqual(existing, op.item)) return; // already there
      if (this.opts.mode === "undo") this.note("skipped", itemPath);
      else if (this.opts.mode === "strict") this.report.conflicts += 1;
      else this.mergeInto(itemPath, existing, op.item);
      return;
    }
    if (this.opts.mode === "strict" && !anchorsPresent(arr, op.at)) {
      this.report.conflicts += 1;
      return;
    }
    insertAt(this.writable(op.path) as unknown[], op.item, op.at, false);
    // Without a known ancestor a new item cannot be told from one deleted elsewhere since: say so.
    if (this.opts.mode === "keep") this.note("restored", itemPath);
  }

  private del(op: Extract<Op, { op: "del" }>): void {
    const arr = getAt(this.root, op.path);
    if (!Array.isArray(arr)) return; // its container is gone too
    const i = arr.findIndex((x) => isIdItem(x) && x.id === op.item.id);
    if (i < 0) return; // already gone
    const itemPath: Path = [...op.path, { id: op.item.id }];
    if (this.opts.mode === "keep" || this.cautious) {
      this.note("skipped", itemPath);
      return;
    }
    if (!deepEqual(arr[i], op.item)) {
      // Changed elsewhere since: deleting it would destroy that change.
      if (this.opts.mode === "rebase" || this.opts.mode === "recover") this.note("keptDeleted", itemPath);
      else if (this.opts.mode === "undo") this.note("skipped", itemPath);
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
    const idAt = (list: unknown[], k: number) =>
      k >= 0 && k < list.length && isIdItem(list[k]) ? (list[k] as IdItem).id : null;
    if (idAt(arr, i - 1) === op.to[0] && idAt(arr, i + 1) === op.to[1]) return; // already there
    if (this.opts.mode === "keep" || this.cautious) {
      this.note("skipped", [...op.path, { id: op.id }]);
      return;
    }
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
