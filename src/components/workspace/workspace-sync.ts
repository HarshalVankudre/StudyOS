/**
 * The editor's document engine: undo/redo, version-checked autosave,
 * crash-safe local drafts and merging with changes made elsewhere. Plain
 * TypeScript (no React) so it can be tested directly; `useWorkspaceSync`
 * wraps it for components.
 *
 * THE MODEL. The student's work is a list of changes on top of the version
 * the server last confirmed, never a snapshot that replaces the document:
 *
 *   base     the document at `baseVersion`, as the server confirmed it
 *   present  base + the student's unsaved changes (what the editor shows)
 *
 * Every edit is recorded as an id-addressed patch (lib/workspace/changes.ts):
 * "page p1 / block b7 / text: 'hi' -> 'hi there'". When the server holds a
 * newer version (another tab or device, the AI agent, a save whose reply was
 * lost), the unsaved changes are re-applied on top of it by id. Edits that do
 * not overlap simply combine. Where they overlap, nothing is dropped silently:
 * text is merged three ways against the text as it was when the edits
 * diverged; if both changed the same words of a block, both versions are kept
 * (the student's as a new block right after); an edit to something deleted
 * elsewhere brings it back; a value the student overwrote is reported in a
 * banner with a way to restore it.
 *
 * The same model runs everything else:
 *  - Undo/redo: each history step is the student's own patch. Undo applies
 *    its inverse on top of the current document, so it never reverts what
 *    arrived from elsewhere (updates from outside are not history steps).
 *  - Drafts: the unsaved changes are written to localStorage as a patch, per
 *    tab. A draft left by a closed or crashed tab is merged in the same way
 *    when the workspace is opened again, never restored over newer content.
 *  - Edits that compute from the current state (a flashcard grade) can ask to
 *    be re-run on the newer document instead (`update(fn, { rebase: "rerun" })`).
 *
 * HOW A COMPONENT'S EDITS TAKE PART (for new block types): call `update` with
 * a mutator that finds what it edits by id (page id, block id, card id...) and
 * changes it in place. That is all; the patch is derived automatically and
 * merges field by field. Use `rebase: "rerun"` only for edits whose result
 * depends on the value they start from (counters, schedules, scores); such a
 * mutator must also be idempotent, because it can run again on a document
 * that already contains its effect (when a save's reply was lost): give it a
 * natural key (e.g. the review timestamp) and do nothing if it is present.
 *
 * Network calls (save, read, version check) run one at a time through an
 * internal queue, so a re-read can never race a save even if the transport
 * (today: Next server actions, which are serialized too) allowed it.
 */
import {
  applyPatch,
  diff,
  emptyReport,
  invertPatch,
  lookupIn,
  opContainers,
  pathKey,
  reportHasNews,
  restoreShell,
  type IdItem,
  type Lookup,
  type MergeReport,
  type Op,
} from "@/lib/workspace/changes";
import {
  breakCoalescing,
  canRedo,
  canUndo,
  createHistory,
  detectRemoval,
  record,
  takeRedo,
  takeUndo,
  type History,
  type Removal,
} from "@/lib/workspace/history";
import { MAX_WORKSPACE_BYTES, repairWorkspace, workspaceBytes } from "@/lib/workspace/repair";
import { safeParseWorkspace } from "@/lib/workspace/schema";
import type { Workspace } from "@/lib/workspace/types";

export type SaveStatus =
  | "saved"
  | "saving"
  | "offline"
  | "error"
  | "conflict"
  | "tooLarge"
  | "gone";

export type Mutator = (draft: Workspace) => void;

export interface UpdateOptions {
  /** Same key within a short time merges a typing burst into one undo step. */
  coalesceKey?: string | null;
  /**
   * How the edit is carried over if the document changes elsewhere before it
   * is saved: "patch" (default) re-applies its changes by id; "rerun" runs the
   * mutator again on the newer document (see the module comment).
   */
  rebase?: "patch" | "rerun";
}

export type SaveResult =
  | { status: "saved"; version: number }
  | { status: "conflict"; version: number }
  | { status: "not_found" }
  | { status: "too_large" }
  | { status: "invalid" };

/**
 * Last-resort conflict: only raised if merging failed unexpectedly. The
 * student then chooses between their version and the newer one.
 */
export interface Conflict {
  kind: "remote";
  workspace: Workspace;
  version: number;
}

/** What a merge with changes from elsewhere had to reconcile (for the banner). */
export interface MergeNotice {
  source: "remote" | "draft";
  report: MergeReport;
}

export type Notice = "updatedElsewhere" | "draftRestored" | "undoPartial" | "localCopyFailed";

/** A text field holding typing it has not written to the workspace yet. */
export interface PendingField {
  /** Write the buffered text now (synchronously, through `update`). */
  commit(): void;
  hasPending(): boolean;
}

export type DraftStorage = Pick<Storage, "getItem" | "setItem" | "removeItem"> &
  Partial<Pick<Storage, "key" | "length">>;

export interface SyncDeps {
  save: (id: string, ws: Workspace, baseVersion: number) => Promise<SaveResult>;
  fetchState: (id: string) => Promise<{ workspace: Workspace; version: number } | null>;
  fetchVersion: (id: string) => Promise<number | null>;
  /** localStorage (per-tab drafts and tab liveness). Enumeration enables recovery. */
  storage?: DraftStorage | null;
  now?: () => number;
  isOnline?: () => boolean;
  onRemoval?: (removal: Removal, entryId: number) => void;
  onNotice?: (notice: Notice) => void;
  /** Called after each successful save (used to tell other tabs). */
  onSaved?: (version: number) => void;
  /** This tab's id (drafts are per tab). Random when omitted. */
  tabId?: string;
}

export interface SyncSnapshot {
  workspace: Workspace;
  /** Bumps whenever the document changed other than by a plain edit. */
  rev: number;
  status: SaveStatus;
  canUndo: boolean;
  canRedo: boolean;
  conflict: Conflict | null;
  merge: MergeNotice | null;
  /** True while there are edits the server has not confirmed yet. */
  dirty: boolean;
}

export const SAVE_DEBOUNCE_MS = 800;
const RETRY_DELAYS_MS = [2_000, 5_000, 15_000, 30_000, 60_000];
/** Quick re-read attempts after the agent finishes, before falling back to Retry. */
const RESYNC_RETRY_MS = [1_000, 3_000];
/**
 * A tab that has not said it is alive for this long is treated as closed
 * (browsers run timers of background tabs only about once a minute; a tab
 * that closes normally says goodbye at once, see `releaseTab`).
 */
export const TAB_ALIVE_MS = 90_000;
/** Drafts older than this are discarded (any workspace). */
export const DRAFT_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

const DRAFT_PREFIX = "studyos:draft:";
const DRAFT_V2_PREFIX = `${DRAFT_PREFIX}v2:`;
const TAB_PREFIX = "studyos:tab:";

/**
 * localStorage key of a draft: per tab (`tabId`) since drafts are patches of
 * one tab's unsaved edits. Without `tabId`: the old single-draft key.
 */
export function draftKey(id: string, tabId?: string): string {
  return tabId ? `${DRAFT_V2_PREFIX}${id}:${tabId}` : `${DRAFT_PREFIX}${id}`;
}

export function tabKey(tabId: string): string {
  return `${TAB_PREFIX}${tabId}`;
}

interface StoredDraft {
  v: 2;
  id: string;
  tabId: string;
  baseVersion: number;
  savedAt: number;
  ops: Op[];
  /** Restorable copies of the items the ops touch (see changes.restoreShell). */
  ctx: Record<string, { item: IdItem; prev: string | null }>;
}

type Segment =
  | { kind: "patch"; before: Workspace; after: Workspace }
  | { kind: "rerun"; fns: Mutator[]; before: Workspace; after: Workspace };

function randomId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `t-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function combine(prev: MergeNotice | null, source: MergeNotice["source"], report: MergeReport): MergeNotice {
  if (!prev) return { source, report };
  return {
    source,
    report: {
      keptBoth: prev.report.keptBoth + report.keptBoth,
      restored: prev.report.restored + report.restored,
      keptDeleted: prev.report.keptDeleted + report.keptDeleted,
      overwritten: [...prev.report.overwritten, ...report.overwritten],
      skipped: 0,
      conflicts: 0,
    },
  };
}

export class WorkspaceSync {
  readonly tabId: string;
  private base: Workspace;
  private baseVersion: number;
  private present: Workspace;
  /** Unsaved changes since `base`, oldest first. */
  private segments: Segment[] = [];
  /** How many leading segments were sent and must not grow any more. */
  private sealed = 0;
  private inFlight = false;
  /** A save whose outcome is unknown (the request failed after sending). */
  private uncertain: { doc: Workspace; count: number; baseVersion: number } | null = null;
  private history: History = createHistory();
  private status: SaveStatus = "saved";
  private conflict: Conflict | null = null;
  private merge: MergeNotice | null = null;
  private rev = 0;
  private paused = false;
  private needsPull = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private retryCount = 0;
  private queue: Promise<void> = Promise.resolve();
  private fields = new Set<PendingField>();
  private draftChecked = false;
  /** This tab's own draft (from before a reload) has been merged in. */
  private draftAdoptedOwn = false;
  private storageFailed = false;
  private disposed = false;
  private listeners = new Set<() => void>();
  private snapshot: SyncSnapshot;

  constructor(
    private readonly id: string,
    initial: Workspace,
    initialVersion: number,
    private deps: SyncDeps,
  ) {
    this.tabId = deps.tabId ?? randomId();
    this.base = initial;
    this.present = initial;
    this.baseVersion = initialVersion;
    this.snapshot = this.buildSnapshot();
  }

  /** Swap callbacks (they close over React state that changes per render). */
  setDeps(deps: Partial<SyncDeps>) {
    this.deps = { ...this.deps, ...deps };
  }

  // ---- subscription (useSyncExternalStore) -------------------------------

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): SyncSnapshot => this.snapshot;

  private buildSnapshot(): SyncSnapshot {
    return {
      workspace: this.present,
      rev: this.rev,
      status: this.status,
      canUndo: canUndo(this.history),
      canRedo: canRedo(this.history),
      conflict: this.conflict,
      merge: this.merge,
      dirty: this.segments.length > 0 || this.inFlight,
    };
  }

  private emit() {
    this.snapshot = this.buildSnapshot();
    for (const listener of this.listeners) listener();
  }

  get workspace(): Workspace {
    return this.present;
  }

  /** The server version the editor is based on (the last one it saw). */
  get version(): number | null {
    return this.baseVersion;
  }

  /** Unsaved edits anywhere: in the engine, in flight, or still typed in a field. */
  get hasUnsavedChanges(): boolean {
    if (this.segments.length > 0 || this.inFlight) return true;
    for (const field of this.fields) if (field.hasPending()) return true;
    return false;
  }

  private now() {
    return this.deps.now?.() ?? Date.now();
  }

  // ---- pending text fields ---------------------------------------------------

  /**
   * A text field buffering typing registers here, so the engine can write
   * that typing first whenever it matters: before the tab is hidden or
   * closed, before undo/redo, and before applying a newer version.
   */
  registerField(field: PendingField): () => void {
    this.fields.add(field);
    return () => {
      this.fields.delete(field);
    };
  }

  /** Write every field's buffered typing to the workspace now. */
  commitFields() {
    for (const field of [...this.fields]) {
      try {
        if (field.hasPending()) field.commit();
      } catch {
        // A broken field must not stop the others from being written.
      }
    }
  }

  // ---- editing -------------------------------------------------------------

  /** Apply an edit (see UpdateOptions; a string is the coalescing key). */
  update(mutator: Mutator, options: string | null | UpdateOptions = null) {
    const opts: UpdateOptions =
      typeof options === "object" && options !== null ? options : { coalesceKey: options };
    const prev = this.present;
    const draft = structuredClone(prev);
    mutator(draft);
    const ops = diff(prev, draft);
    if (ops.length === 0) return;
    const next = applyPatch(prev, ops, { mode: "undo" }).doc;
    const removal = detectRemoval(prev, next);
    const entryId = this.commitLocal(prev, next, {
      ops,
      rerun: opts.rebase === "rerun" ? mutator : undefined,
      coalesceKey: removal ? null : (opts.coalesceKey ?? null),
    });
    if (removal) this.deps.onRemoval?.(removal, entryId);
  }

  /**
   * Make `next` the present document as a local change: an unsaved segment,
   * and (unless `history` is false) an undo step. Returns the step id.
   */
  private commitLocal(
    prev: Workspace,
    next: Workspace,
    opts: { ops?: Op[]; rerun?: Mutator; coalesceKey?: string | null; history?: boolean },
  ): number {
    this.present = next;
    this.addSegment(prev, next, opts.rerun);
    let entryId = -1;
    if (opts.history !== false) {
      const recorded = record(this.history, {
        before: prev,
        after: next,
        ops: opts.ops ?? diff(prev, next),
        now: this.now(),
        coalesceKey: opts.coalesceKey ?? null,
      });
      this.history = recorded.history;
      entryId = recorded.entryId;
    }
    this.markDirty();
    return entryId;
  }

  private addSegment(prev: Workspace, next: Workspace, rerun?: Mutator) {
    const last = this.segments[this.segments.length - 1];
    const open = last && this.segments.length > this.sealed;
    if (rerun) {
      if (open && last.kind === "rerun") {
        last.fns.push(rerun);
        last.after = next;
      } else this.segments.push({ kind: "rerun", fns: [rerun], before: prev, after: next });
    } else if (open && last.kind === "patch") {
      last.after = next;
    } else {
      this.segments.push({ kind: "patch", before: prev, after: next });
    }
  }

  undo(): boolean {
    this.commitFields();
    const taken = takeUndo(this.history);
    if (!taken) return false;
    this.history = taken.history;
    this.applyHistory(invertPatch(taken.entry.ops));
    return true;
  }

  redo(): boolean {
    this.commitFields();
    const taken = takeRedo(this.history);
    if (!taken) return false;
    this.history = taken.history;
    this.applyHistory(taken.entry.ops);
    return true;
  }

  /**
   * Undo one specific step (the Undo toast of a removal), on top of the
   * current document; later steps stay. It can be redone.
   */
  undoTo(entryId: number): boolean {
    this.commitFields();
    const taken = takeUndo(this.history, entryId);
    if (!taken) return false;
    this.history = taken.history;
    this.applyHistory(invertPatch(taken.entry.ops));
    return true;
  }

  private applyHistory(ops: Op[]) {
    const prev = this.present;
    const result = applyPatch(prev, ops, { mode: "undo" });
    if (result.report.skipped > 0) this.deps.onNotice?.("undoPartial");
    this.rev += 1;
    if (result.doc === prev) {
      this.emit();
      return;
    }
    this.commitLocal(prev, result.doc, { history: false });
  }

  private markDirty() {
    if (this.status === "saved" || this.status === "tooLarge") this.status = "saving";
    this.writeDraft();
    this.scheduleFlush(SAVE_DEBOUNCE_MS);
    this.emit();
  }

  // ---- saving ----------------------------------------------------------------

  private scheduleFlush(delay: number) {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (this.disposed) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, delay);
  }

  /** Run network steps one at a time. Never rejects. */
  private enqueue(task: () => Promise<void>): Promise<void> {
    const run = this.queue.then(task).catch((error: unknown) => {
      console.error("[StudyOS] workspace sync step failed", error);
    });
    this.queue = run;
    return run;
  }

  /** Save now (skipping the debounce). Safe to call at any time. */
  flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.paused || this.conflict) return Promise.resolve();
    return this.enqueue(() => this.saveStep());
  }

  private async saveStep(): Promise<void> {
    if (this.paused || this.conflict) return;
    if (this.needsPull && !(await this.pullStep())) return;
    if (this.status === "gone") return;
    if (this.segments.length === 0) {
      if (this.status === "saving") {
        this.status = "saved";
        this.emit();
      }
      return;
    }

    const doc = this.present;
    if (workspaceBytes(doc) > MAX_WORKSPACE_BYTES) {
      this.status = "tooLarge";
      this.emit();
      return;
    }
    const count = this.segments.length;
    const baseVersion = this.baseVersion;
    this.sealed = count;
    this.inFlight = true;
    this.status = "saving";
    this.writeDraft();
    this.emit();

    let result: SaveResult | null = null;
    try {
      result = await this.deps.save(this.id, doc, baseVersion);
    } catch {
      result = null;
    }
    this.inFlight = false;

    if (!result) {
      // It may or may not have reached the server; a later save tells.
      this.uncertain = { doc, count, baseVersion };
      this.status = this.deps.isOnline?.() === false ? "offline" : "error";
      this.scheduleRetry();
      this.emit();
      return;
    }
    switch (result.status) {
      case "saved":
        this.uncertain = null;
        this.retryCount = 0;
        this.acceptSaved(doc, count, result.version);
        break;
      case "conflict":
        // A newer version exists: bring our edits over to it and save again.
        await this.pullStep(true);
        return;
      case "not_found":
        this.status = "gone";
        break;
      case "too_large":
        this.status = "tooLarge";
        break;
      default:
        this.status = "error";
    }
    this.emit();
  }

  /** The server stored `doc` (the first `count` segments) as `version`. */
  private acceptSaved(doc: Workspace, count: number, version: number) {
    this.base = doc;
    this.baseVersion = version;
    this.segments = this.segments.slice(count);
    this.sealed = 0;
    this.deps.onSaved?.(version);
    if (this.segments.length === 0) {
      this.clearDraft();
      this.status = "saved";
    } else {
      this.status = "saving";
      this.writeDraft();
      this.scheduleFlush(SAVE_DEBOUNCE_MS);
    }
  }

  private scheduleRetry() {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    if (this.disposed) return;
    const delay = RETRY_DELAYS_MS[Math.min(this.retryCount, RETRY_DELAYS_MS.length - 1)];
    this.retryCount += 1;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      void this.flush();
    }, delay);
  }

  /** The "Retry" button: try again right away. */
  retry() {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    if (this.status === "error" || this.status === "offline" || this.status === "tooLarge") {
      this.status = "saving";
      this.emit();
    }
    void this.flush();
  }

  /**
   * Write everything and wait until the server has it (or saving is stuck).
   * For the AI agent: call before sending a task so the agent starts from the
   * latest saved version. `version` is the version the editor is now on.
   */
  async settle(): Promise<{ ok: boolean; version: number | null }> {
    this.commitFields();
    for (let attempt = 0; attempt < 4; attempt += 1) {
      if (this.paused || this.conflict) break;
      if (this.segments.length === 0 && !this.needsPull) break;
      await this.flush();
      if (["gone", "tooLarge", "error", "offline"].includes(this.status)) break;
    }
    await this.queue;
    return {
      ok: this.segments.length === 0 && !this.needsPull && this.status === "saved",
      version: this.baseVersion,
    };
  }

  // ---- other tabs / the agent ----------------------------------------------

  /** Read the saved document and bring local edits over to it. False on failure. */
  private async pullStep(afterConflict = false): Promise<boolean> {
    let state: { workspace: Workspace; version: number } | null;
    try {
      state = await this.deps.fetchState(this.id);
    } catch {
      this.needsPull = true;
      this.status = this.deps.isOnline?.() === false ? "offline" : "error";
      this.scheduleRetry();
      this.emit();
      return false;
    }
    return this.receive(state, afterConflict);
  }

  private receive(
    state: { workspace: Workspace; version: number } | null,
    afterConflict = false,
  ): boolean {
    if (!state) {
      this.status = "gone";
      this.emit();
      return false;
    }
    this.needsPull = false;
    if (this.conflict) {
      // A newer read replaces a stale last-resort conflict: try merging again.
      this.conflict = null;
      this.status = "saving";
    }
    if (this.status === "gone" || this.status === "error" || this.status === "offline") {
      this.status = this.segments.length > 0 ? "saving" : "saved";
    }
    const before = this.baseVersion;
    this.applyRemote(state.workspace, state.version);
    if (this.conflict || this.paused || this.segments.length === 0) return true;
    // A save refused as stale although the server reports no newer version
    // (a lagging read): back off instead of retrying in a tight loop.
    if (afterConflict && this.baseVersion === before) this.scheduleRetry();
    else this.scheduleFlush(0);
    return true;
  }

  /** A version of the document from the server: merge local edits onto it. */
  private applyRemote(theirs: Workspace, version: number) {
    this.commitFields();
    if (version === this.baseVersion) {
      this.emit();
      return;
    }

    // Our own save that landed although its reply was lost: nothing to merge.
    const own = this.uncertain;
    this.uncertain = null;
    if (own && version === own.baseVersion + 1 && diff(own.doc, theirs).length === 0) {
      this.acceptSaved(own.doc, own.count, version);
      if (this.segments.length === 0) this.status = "saved";
      this.emit();
      return;
    }

    const shown = this.present;
    this.history = breakCoalescing(this.history);
    this.rev += 1;
    if (this.segments.length === 0) {
      this.base = theirs;
      this.present = theirs;
      this.baseVersion = version;
      this.status = "saved";
      this.emit();
      if (diff(shown, theirs).length > 0) this.deps.onNotice?.("updatedElsewhere");
      return;
    }

    let rebased: { doc: Workspace; segments: Segment[]; report: MergeReport };
    try {
      rebased = this.rebaseOnto(theirs);
      if (!safeParseWorkspace(rebased.doc).success) throw new Error("merge produced an invalid workspace");
    } catch (error) {
      console.error("[StudyOS] could not merge with the newer version", error);
      this.conflict = { kind: "remote", workspace: theirs, version };
      this.status = "conflict";
      this.writeDraft();
      this.emit();
      return;
    }
    this.base = theirs;
    this.baseVersion = version;
    this.sealed = 0;
    if (diff(theirs, rebased.doc).length === 0) {
      // Everything unsaved is already there (e.g. our lost-reply save).
      this.present = theirs;
      this.segments = [];
      this.clearDraft();
      this.status = "saved";
    } else {
      this.present = rebased.doc;
      this.segments = rebased.segments;
      this.status = "saving";
      this.writeDraft();
    }
    if (reportHasNews(rebased.report)) this.merge = combine(this.merge, "remote", rebased.report);
    this.emit();
    if (diff(shown, this.present).length > 0) this.deps.onNotice?.("updatedElsewhere");
  }

  /** Replay the unsaved segments on `theirs`, each by its own rule. */
  private rebaseOnto(theirs: Workspace): { doc: Workspace; segments: Segment[]; report: MergeReport } {
    const report = emptyReport();
    const segments: Segment[] = [];
    let cur = theirs;
    for (const seg of this.segments) {
      if (seg.kind === "patch") {
        const ops = diff(seg.before, seg.after);
        const next = applyPatch(cur, ops, { mode: "rebase", lookup: lookupIn(seg.after), report }).doc;
        segments.push({ kind: "patch", before: cur, after: next });
        cur = next;
      } else {
        let next: Workspace;
        try {
          const draft = structuredClone(cur);
          for (const fn of seg.fns) fn(draft);
          next = applyPatch(cur, diff(cur, draft), { mode: "undo" }).doc;
        } catch (error) {
          // A broken re-run must not block the merge: carry its effect over
          // as plain changes instead.
          console.error("[StudyOS] an edit could not be re-run on the newer version", error);
          const ops = diff(seg.before, seg.after);
          next = applyPatch(cur, ops, { mode: "rebase", lookup: lookupIn(seg.after), report }).doc;
        }
        segments.push({ kind: "rerun", fns: seg.fns, before: cur, after: next });
        cur = next;
      }
    }
    return { doc: cur, segments, report };
  }

  /** Cheap check (focus, visibility, polling, other-tab message). */
  checkRemote(): Promise<void> {
    if (this.paused || this.conflict) return Promise.resolve();
    return this.enqueue(async () => {
      if (this.paused || this.conflict || this.inFlight) return;
      let version: number | null;
      try {
        version = await this.deps.fetchVersion(this.id);
      } catch {
        return; // offline: the save path reports it
      }
      if (version === null) {
        if (this.status !== "gone") {
          this.status = "gone";
          this.emit();
        }
        return;
      }
      // Back from the trash, a newer version, or a re-read still owed.
      if (this.status === "gone" || this.needsPull || version !== this.baseVersion) {
        await this.pullStep();
      }
    });
  }

  /** The agent started (true) or finished (false) a task. */
  setAgentBusy(busy: boolean) {
    if (busy === this.paused) return;
    this.paused = busy;
    if (busy) {
      if (this.timer) clearTimeout(this.timer);
      this.timer = null;
      return;
    }
    void this.resync();
  }

  /**
   * Re-read the saved workspace (after the agent changed it, or finished)
   * and bring this tab's unsaved edits over to it. A failed read is retried;
   * if it keeps failing, the next save or check re-reads first.
   */
  resync(): Promise<void> {
    this.commitFields();
    return this.enqueue(async () => {
      for (let attempt = 0; ; attempt += 1) {
        let state: { workspace: Workspace; version: number } | null;
        try {
          state = await this.deps.fetchState(this.id);
        } catch {
          if (attempt < RESYNC_RETRY_MS.length) {
            await new Promise((resolve) => setTimeout(resolve, RESYNC_RETRY_MS[attempt]));
            continue;
          }
          this.needsPull = true;
          this.status = this.deps.isOnline?.() === false ? "offline" : "error";
          this.scheduleRetry();
          this.emit();
          return;
        }
        this.receive(state);
        return;
      }
    });
  }

  /**
   * Last-resort conflict (merging failed): keep this tab's version (saved over
   * the newer one) or load the newer one (undoable: Undo brings mine back).
   */
  resolveConflict(choice: "mine" | "theirs") {
    const conflict = this.conflict;
    if (!conflict) return;
    this.commitFields();
    this.conflict = null;
    const mine = this.present;
    this.base = conflict.workspace;
    this.baseVersion = conflict.version;
    this.sealed = 0;
    this.rev += 1;
    if (choice === "mine") {
      this.segments = [{ kind: "patch", before: conflict.workspace, after: mine }];
      this.status = "saving";
      this.emit();
      void this.flush();
      return;
    }
    this.segments = [];
    this.present = conflict.workspace;
    this.history = record(this.history, {
      before: mine,
      after: conflict.workspace,
      ops: diff(mine, conflict.workspace),
      now: this.now(),
    }).history;
    this.clearDraft();
    this.status = "saved";
    this.emit();
  }

  /** Close the merge banner. */
  dismissMerge() {
    if (!this.merge) return;
    this.merge = null;
    this.emit();
  }

  /**
   * The merge banner's "use their version": put back the values from
   * elsewhere that the student's edits replaced (an undoable step).
   */
  restoreTheirs() {
    const merge = this.merge;
    if (!merge) return;
    this.commitFields();
    this.merge = null;
    const ops: Op[] = merge.report.overwritten.map((o) => ({
      op: "set",
      path: o.path,
      before: o.mine,
      after: o.theirs,
    }));
    const prev = this.present;
    const next = applyPatch(prev, ops, { mode: "undo" }).doc;
    if (next === prev) {
      this.emit();
      return;
    }
    this.rev += 1;
    this.commitLocal(prev, next, {});
  }

  // ---- local drafts (never lose edits to a closed tab) ------------------------

  /** Write this tab's unsaved edits to localStorage (synchronously). */
  writeDraft() {
    const storage = this.deps.storage;
    if (!storage) return;
    const key = draftKey(this.id, this.tabId);
    const ops = this.segments.length > 0 ? diff(this.base, this.present) : [];
    if (ops.length === 0) {
      this.removeKey(key);
      return;
    }
    const find = lookupIn(this.present);
    const ctx: StoredDraft["ctx"] = {};
    for (const op of ops) {
      for (const { arrayPath, id } of opContainers(op)) {
        const k = `${pathKey(arrayPath)}#${id}`;
        if (k in ctx) continue;
        const found = find(arrayPath, id);
        if (found) ctx[k] = { item: restoreShell(found.item), prev: found.prev };
      }
    }
    const draft: StoredDraft = {
      v: 2,
      id: this.id,
      tabId: this.tabId,
      baseVersion: this.baseVersion,
      savedAt: this.now(),
      ops,
      ctx,
    };
    try {
      storage.setItem(key, JSON.stringify(draft));
      storage.setItem(tabKey(this.tabId), String(draft.savedAt));
      this.storageFailed = false;
    } catch {
      // Quota or privacy mode: say so once, so the student keeps the tab open.
      if (!this.storageFailed) {
        this.storageFailed = true;
        this.deps.onNotice?.("localCopyFailed");
      }
    }
  }

  private clearDraft() {
    this.removeKey(draftKey(this.id, this.tabId));
  }

  private removeKey(key: string) {
    try {
      this.deps.storage?.removeItem(key);
    } catch {
      // ignore
    }
  }

  /** Mark this tab alive (its draft must not be adopted by another tab). */
  heartbeat() {
    try {
      this.deps.storage?.setItem(tabKey(this.tabId), String(this.now()));
    } catch {
      // ignore
    }
  }

  /** This tab is closing: its draft may now be recovered by the next visit. */
  releaseTab() {
    this.removeKey(tabKey(this.tabId));
  }

  private tabAlive(tabId: string): boolean {
    try {
      const at = Number(this.deps.storage?.getItem(tabKey(tabId)));
      return Number.isFinite(at) && this.now() - at < TAB_ALIVE_MS;
    } catch {
      return false;
    }
  }

  private storageKeys(): string[] {
    const storage = this.deps.storage;
    if (!storage || typeof storage.key !== "function" || typeof storage.length !== "number") return [];
    const keys: string[] = [];
    try {
      for (let i = 0; i < storage.length; i += 1) {
        const key = storage.key(i);
        if (key) keys.push(key);
      }
    } catch {
      return [];
    }
    return keys;
  }

  /** Remove drafts nobody came back for, and liveness marks of long-gone tabs. */
  private sweep(keys: string[]) {
    const storage = this.deps.storage;
    if (!storage) return;
    const now = this.now();
    for (const key of keys) {
      try {
        if (key.startsWith(TAB_PREFIX)) {
          if (now - Number(storage.getItem(key)) > 24 * 60 * 60 * 1000) storage.removeItem(key);
        } else if (key.startsWith(DRAFT_PREFIX)) {
          const savedAt = Number((JSON.parse(storage.getItem(key) ?? "null") as { savedAt?: number } | null)?.savedAt);
          if (!Number.isFinite(savedAt) || now - savedAt > DRAFT_MAX_AGE_MS) storage.removeItem(key);
        }
      } catch {
        this.removeKey(key);
      }
    }
  }

  /**
   * On open: merge in edits a closed (or crashed) tab left on this device
   * that never reached the server. A draft whose edits the server already
   * holds is cleared without asking; a draft of a tab that is still open is
   * left alone. The merge is an undo step, announced with a notice.
   */
  recoverDraft() {
    const storage = this.deps.storage;
    if (!storage || this.draftChecked) return;
    this.draftChecked = true;
    this.heartbeat();
    this.sweep(this.storageKeys());

    let legacyOps: Op[] | null = null;
    let legacyLookup: Lookup | undefined;
    const legacyKey = draftKey(this.id);
    try {
      const raw = storage.getItem(legacyKey);
      const legacy = raw
        ? (JSON.parse(raw) as { v?: number; baseVersion?: number; workspace?: unknown })
        : null;
      const repaired = legacy?.v === 1 ? repairWorkspace(legacy.workspace, { id: this.id }) : null;
      if (legacy && repaired) {
        const ops = diff(this.present, { ...repaired.workspace, id: this.id });
        // A draft from before drafts were per tab (a whole document). Based on
        // an older version it cannot tell its own edits from newer ones, so
        // then only what it added is merged in.
        legacyOps = legacy.baseVersion === this.baseVersion ? ops : ops.filter((op) => op.op === "ins");
        legacyLookup = lookupIn(repaired.workspace);
      }
    } catch {
      // unreadable: nothing to recover
    }
    this.removeKey(legacyKey);
    this.adoptOrphans(legacyOps ? [{ ops: legacyOps, lookup: legacyLookup }] : []);
  }

  /**
   * Merge in the drafts of tabs that are no longer open (and this tab's own
   * draft from before a reload). Also runs periodically, so a crashed tab's
   * edits are picked up by a tab that was opened right after the crash.
   */
  adoptOrphans(extra: Array<{ ops: Op[]; lookup?: Lookup }> = []) {
    const storage = this.deps.storage;
    if (!storage) return;
    const report = emptyReport();
    let restored = false;
    const mergeIn = (ops: Op[], lookup: Lookup | undefined): boolean => {
      let next = applyPatch(this.present, ops, { mode: "rebase", lookup, report }).doc;
      if (next === this.present || diff(this.present, next).length === 0) return true;
      if (!restored) {
        // Typing still in a field is written first; fields then show the merge.
        this.commitFields();
        next = applyPatch(this.present, ops, { mode: "rebase", lookup }).doc;
      }
      if (!safeParseWorkspace(next).success) return false;
      const prev = this.present;
      this.rev += 1;
      this.commitLocal(prev, next, {});
      restored = true;
      return true;
    };

    const readDraft = (key: string): { ops: Op[]; lookup: Lookup } | null => {
      let draft: StoredDraft | null = null;
      try {
        draft = JSON.parse(storage.getItem(key) ?? "null") as StoredDraft | null;
      } catch {
        draft = null;
      }
      if (!draft || draft.v !== 2 || !Array.isArray(draft.ops)) return null;
      const ctx = draft.ctx ?? {};
      return { ops: draft.ops, lookup: (arrayPath, id) => ctx[`${pathKey(arrayPath)}#${id}`] };
    };

    // 1. This tab's own draft from before a reload (first: merging anything
    //    else rewrites that key). Once running, the key holds our own edits.
    const ownKey = draftKey(this.id, this.tabId);
    let ownLeft = false;
    if (!this.draftAdoptedOwn) {
      this.draftAdoptedOwn = true;
      const own = readDraft(ownKey);
      if (own) ownLeft = !mergeIn(own.ops, own.lookup);
    }
    // 2. What the caller found (an old-format draft).
    for (const { ops, lookup } of extra) mergeIn(ops, lookup);
    // 3. Drafts of tabs that are closed or crashed (no recent sign of life).
    const prefix = `${DRAFT_V2_PREFIX}${this.id}:`;
    for (const key of this.storageKeys()) {
      if (!key.startsWith(prefix) || key === ownKey) continue;
      if (this.tabAlive(key.slice(prefix.length))) continue;
      const draft = readDraft(key);
      if (!draft || mergeIn(draft.ops, draft.lookup)) this.removeKey(key);
    }

    if (restored) {
      this.writeDraft();
      if (reportHasNews(report)) this.merge = combine(this.merge, "draft", report);
      this.emit();
      this.deps.onNotice?.("draftRestored");
    } else if (!ownLeft && this.segments.length === 0) {
      this.clearDraft();
    }
  }

  /** (Re)start after mount: mark the tab alive and recover drafts once. */
  start() {
    this.disposed = false;
    this.heartbeat();
    this.recoverDraft();
  }

  /**
   * Leaving (tab hidden or closing): write buffered typing and the local
   * draft synchronously, then save right away.
   */
  prepareToLeave() {
    this.commitFields();
    this.writeDraft();
    if (this.segments.length > 0) void this.flush();
  }

  /** Stop timers. Pending edits are already in the local draft. */
  dispose() {
    this.commitFields();
    this.writeDraft();
    const pending = this.timer !== null || this.segments.length > 0;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    if (pending) void this.flush();
    this.disposed = true;
  }
}
