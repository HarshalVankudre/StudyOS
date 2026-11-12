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
 * newer version (another tab or device, the AI agent), the unsaved changes
 * are re-applied on top of it by id. Edits that do not overlap simply
 * combine. Where they overlap, nothing is dropped silently: prose is merged
 * three ways against the text as it was when the edits diverged; if both
 * changed the same words of a block, both versions are kept (the student's as
 * a new block right after); other values (dates, links, choices) are single
 * values: the student's wins and the banner offers the other one back; an
 * edit to something deleted elsewhere brings it back.
 *
 * A change is applied once. Every save carries an id the server records with
 * the version it produced (lib/workspace/save-ids.ts). A save that landed
 * although its reply was lost, or a draft left by a tab closed mid-save, is
 * recognised by that id: its changes are dropped and only later ones are
 * merged, on top of the version that save produced. Never "applied again
 * over whatever happened since" (which would undo another device's edits).
 *
 * The same model runs everything else:
 *  - Undo/redo: each history step is the student's own patch. Undo applies
 *    its inverse on top of the current document, so it never reverts what
 *    arrived from elsewhere (updates from outside are not history steps).
 *  - Drafts: the unsaved changes are written to localStorage as a patch, per
 *    tab, with which of them were sent under which save id. A draft left by a
 *    closed or crashed tab is merged in when the workspace is opened again,
 *    after asking the server which of its saves landed; never restored over
 *    newer content. A draft that cannot be matched with certainty (very old,
 *    or from an older version of the app) is salvaged: its text is kept as
 *    copies and nothing is overwritten or deleted.
 *  - Edits that compute from the current state (a flashcard grade) can ask to
 *    be re-run on the newer document instead (`update(fn, { rebase: "rerun" })`).
 *
 * HOW A COMPONENT'S EDITS TAKE PART (for new block types): call `update` with
 * a mutator that finds what it edits by id (page id, block id, card id...) and
 * changes it in place. That is all; the patch is derived automatically and
 * merges field by field. Use `rebase: "rerun"` only for edits whose result
 * depends on the value they start from (counters, schedules, scores); such a
 * mutator must also be idempotent (it can run again on a document that
 * already contains its effect): give it a natural key such as the answer's
 * timestamp, skip it when an equal or later one is there, and never create
 * random ids or timestamps inside it (lib/workspace/stable-id.ts).
 *
 * Edits run on a copy-on-write draft (lib/workspace/draft.ts): only what an
 * edit touches is copied, so editing a large workspace costs what the edit
 * costs. Versions of the document share everything they have in common.
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
  shareWith,
  type ApplyMode,
  type IdItem,
  type Lookup,
  type MergeReport,
  type Op,
} from "@/lib/workspace/changes";
import { produce } from "@/lib/workspace/draft";
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
import { landedVersion, logCovers, newSaveId, type SaveLog } from "@/lib/workspace/save-ids";
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
  | { status: "conflict"; version: number; saves?: SaveLog }
  | { status: "not_found" }
  | { status: "too_large" }
  | { status: "invalid" };

export interface RemoteState {
  workspace: Workspace;
  version: number;
  /** Recent editor saves (absent from servers older than save ids). */
  saves?: SaveLog;
}

/**
 * Last-resort conflict: only raised if merging failed unexpectedly (and the
 * result could not be repaired). The student then chooses between their
 * version and the newer one; either choice is an undoable step.
 */
export interface Conflict {
  kind: "remote";
  workspace: Workspace;
  version: number;
  /** How many changes made elsewhere "Keep my version" would replace. */
  discards: number;
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
  save: (id: string, ws: Workspace, baseVersion: number, saveId?: string) => Promise<SaveResult>;
  fetchState: (id: string) => Promise<RemoteState | null>;
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
  /**
   * Send a request that outlives the page (fetch with keepalive) to
   * /api/workspace/save; true when it was handed to the browser. Used when
   * the tab closes, so the last edits reach the server, not only this device.
   */
  beacon?: (body: string) => boolean;
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
/** Requests that outlive the page are small (browsers cap them near 64 KB). */
export const BEACON_MAX_CHARS = 60_000;

const DRAFT_PREFIX = "studyos:draft:";
const DRAFT_V2_PREFIX = `${DRAFT_PREFIX}v2:`;
const TAB_PREFIX = "studyos:tab:";

/**
 * localStorage key of a draft: per tab (`tabId`) since drafts are patches of
 * one tab's unsaved edits. Without `tabId`: the old single-draft key.
 * A key "<tab>~<n>" holds a draft that tab took over (from a closed tab, or
 * its own from before a reload) and has not finished merging yet.
 */
export function draftKey(id: string, tabId?: string): string {
  return tabId ? `${DRAFT_V2_PREFIX}${id}:${tabId}` : `${DRAFT_PREFIX}${id}`;
}

export function tabKey(tabId: string): string {
  return `${TAB_PREFIX}${tabId}`;
}

const TAKEN_PREFIX = "studyos:taken:";

/**
 * Set when another tab took over this tab's draft (it looked closed: no sign
 * of life for TAB_ALIVE_MS, as when a phone froze it in the background). If
 * the tab was only asleep and wakes up, the edits it still holds are the
 * other tab's to save now; this tab must not replay them (twice the text).
 */
export function takenKey(id: string, tabId: string): string {
  return `${TAKEN_PREFIX}${id}:${tabId}`;
}

interface StoredDraft {
  v: 2 | 3;
  id: string;
  tabId: string;
  /** The version the edits are based on. */
  baseVersion: number;
  savedAt: number;
  /** base -> the tab's document. */
  ops: Op[];
  /** Restorable copies of the items the ops touch (see changes.restoreShell). */
  ctx: Record<string, { item: IdItem; prev: string | null }>;
  /**
   * v3: saves sent without a reply, each with the changes made after it
   * (that save's document -> the tab's document).
   */
  sends?: Array<{ saveId: string; ops: Op[] }>;
}

/** A whole-document draft written by the first version of the editor. */
interface LegacyDraft {
  v: 1;
  baseVersion: number | null;
  savedAt?: number;
  workspace: unknown;
}

type Segment =
  | { kind: "patch"; before: Workspace; after: Workspace }
  | { kind: "rerun"; fns: Mutator[]; before: Workspace; after: Workspace };

/** A save sent whose reply never arrived (it may or may not have landed). */
interface Sent {
  saveId: string;
  doc: Workspace;
  /** How many segments it carried. */
  count: number;
  baseVersion: number;
}

function randomId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `t-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/** Run `fn` on a copy-on-write draft of `doc` (a JSON clone if the draft cannot take part). */
function edit(doc: Workspace, fn: Mutator): Workspace {
  try {
    return produce(doc, fn);
  } catch {
    const clone = JSON.parse(JSON.stringify(doc)) as Workspace;
    fn(clone);
    const ops = diff(doc, clone);
    return ops.length ? applyPatch(doc, ops, { mode: "undo" }).doc : doc;
  }
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
      skipped: prev.report.skipped + report.skipped,
      repaired: prev.report.repaired + report.repaired,
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
  /** Saves sent since `base` whose outcome is unknown, oldest first. */
  private sends: Sent[] = [];
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
  private claimSeq = 0;
  private merging = false;
  private storageFailed = false;
  /** This tab said goodbye (pagehide): no sign of life until it is shown again. */
  private released = false;
  /** The document last sent by `sendOnLeave` (not sent twice). */
  private beaconed: Workspace | null = null;
  /** Bumped when this tab's unsaved edits were handed to another tab. */
  private epoch = 0;
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
    // Woken up after another tab took our edits over: this edit is ours,
    // those are not (checked before the edit is made on top of them).
    this.checkHandedOver();
    const opts: UpdateOptions =
      typeof options === "object" && options !== null ? options : { coalesceKey: options };
    const prev = this.present;
    const next = edit(prev, mutator);
    if (next === prev) return;
    // Only what the edit touched differs, so this compares little.
    const ops = diff(prev, next);
    if (ops.length === 0) return;
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
    this.checkHandedOver();
    this.commitFields();
    const taken = takeUndo(this.history);
    if (!taken) return false;
    this.history = taken.history;
    this.applyHistory(invertPatch(taken.entry.ops));
    return true;
  }

  redo(): boolean {
    this.checkHandedOver();
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
    this.checkHandedOver();
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
    this.checkHandedOver();
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
    const sent: Sent = {
      saveId: newSaveId(),
      doc,
      count: this.segments.length,
      baseVersion: this.baseVersion,
    };
    // Recorded (and in the local draft) before the request leaves, so a tab
    // that dies while waiting for the reply leaves enough behind to tell.
    this.sends.push(sent);
    this.sealed = sent.count;
    this.inFlight = true;
    this.status = "saving";
    this.writeDraft();
    this.emit();

    let result: SaveResult | null = null;
    const epoch = this.epoch;
    try {
      result = await this.deps.save(this.id, doc, sent.baseVersion, sent.saveId);
    } catch {
      result = null;
    }
    this.inFlight = false;
    this.checkHandedOver();
    if (epoch !== this.epoch) {
      // Handed over while waiting (the other tab knows this save by its id):
      // whatever the reply, read what the server has now.
      this.needsPull = true;
      this.scheduleFlush(0);
      this.emit();
      return;
    }

    if (!result) {
      // It may or may not have reached the server: its id tells later.
      this.status = this.deps.isOnline?.() === false ? "offline" : "error";
      this.scheduleRetry();
      this.emit();
      return;
    }
    // This save's outcome is known now.
    this.sends = this.sends.filter((s) => s !== sent);
    switch (result.status) {
      case "saved":
        // Earlier saves without a reply share its base: none of them landed.
        this.sends = [];
        this.retryCount = 0;
        this.acceptSaved(doc, sent.count, result.version);
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
    let state: RemoteState | null;
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

  private receive(state: RemoteState | null, afterConflict = false): boolean {
    this.checkHandedOver();
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
    this.applyRemote(state.workspace, state.version, state.saves);
    if (this.conflict || this.paused || this.segments.length === 0) return true;
    // A save refused as stale although the server reports no newer version
    // (a lagging read): back off instead of retrying in a tight loop.
    if (afterConflict && this.baseVersion === before) this.scheduleRetry();
    else this.scheduleFlush(0);
    return true;
  }

  /**
   * Did one of the saves without a reply land? Then its changes are in the
   * server's history already: take the version it produced as the base and
   * keep only what came after it.
   */
  private resolveSends(theirs: Workspace, version: number, saves: SaveLog | undefined) {
    if (this.sends.length === 0) return;
    const sends = this.sends;
    this.sends = [];
    for (let i = sends.length - 1; i >= 0; i -= 1) {
      const landed = landedVersion(saves, sends[i].saveId);
      if (landed !== null) {
        this.acceptSaved(sends[i].doc, sends[i].count, landed);
        return;
      }
    }
    if (saves && logCovers(saves, sends[0].baseVersion)) return; // none of them landed
    // A server without save ids (an older deploy), or a log that no longer
    // reaches back that far: recognise our own save by its content.
    const own = sends[sends.length - 1];
    if (version === own.baseVersion + 1 && diff(own.doc, theirs).length === 0) {
      this.acceptSaved(own.doc, own.count, version);
    }
  }

  /** A version of the document from the server: merge local edits onto it. */
  private applyRemote(theirs: Workspace, version: number, saves?: SaveLog) {
    this.commitFields();
    this.resolveSends(theirs, version, saves);
    if (version === this.baseVersion) {
      this.emit();
      return;
    }

    const shown = this.present;
    this.history = breakCoalescing(this.history);
    this.rev += 1;
    if (this.segments.length === 0) {
      // Share what did not change with what is on screen, so only the
      // changed parts of the editor re-render.
      const shared = shareWith(shown, theirs);
      this.base = shared.doc;
      this.present = shared.doc;
      this.baseVersion = version;
      this.status = "saved";
      this.emit();
      if (shared.changed) this.deps.onNotice?.("updatedElsewhere");
      return;
    }

    let rebased: { doc: Workspace; segments: Segment[]; report: MergeReport };
    let doc: Workspace | null = null;
    try {
      rebased = this.rebaseOnto(theirs);
      doc = this.validOrRepaired(rebased.doc, rebased.report);
    } catch (error) {
      console.error("[StudyOS] could not merge with the newer version", error);
      doc = null;
    }
    if (!doc) {
      this.conflict = {
        kind: "remote",
        workspace: theirs,
        version,
        discards: diff(this.base, theirs).length,
      };
      this.status = "conflict";
      this.writeDraft();
      this.emit();
      return;
    }
    this.baseVersion = version;
    this.sealed = 0;
    const present = shareWith(shown, doc).doc;
    const base = shareWith(present, theirs);
    this.base = base.doc;
    if (diff(base.doc, present).length === 0) {
      // Everything unsaved is already there (a save of ours that landed).
      this.present = base.doc;
      this.segments = [];
      this.clearDraft();
      this.status = "saved";
    } else {
      this.present = present;
      this.segments = rebased!.segments;
      // The same content, sharing with what is shown.
      this.segments[0].before = base.doc;
      this.segments[this.segments.length - 1].after = present;
      this.status = "saving";
      this.writeDraft();
    }
    if (reportHasNews(rebased!.report)) this.merge = combine(this.merge, "remote", rebased!.report);
    this.emit();
    if (diff(shown, this.present).length > 0) this.deps.onNotice?.("updatedElsewhere");
  }

  /**
   * A merged document that breaks a schema limit (a deck over 200 cards, a
   * text over its limit) is repaired the way stored documents are: a deck is
   * split, nothing is dropped. Null if it cannot be repaired without loss.
   */
  private validOrRepaired(doc: Workspace, report: MergeReport): Workspace | null {
    if (safeParseWorkspace(doc).success) return doc;
    const repaired = repairWorkspace(doc, { id: this.id });
    if (!repaired || repaired.issues.some((issue) => issue.startsWith("dropped"))) return null;
    report.repaired += 1;
    return repaired.workspace;
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
          next = edit(cur, (d) => {
            for (const fn of seg.fns) fn(d);
          });
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
        let state: RemoteState | null;
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
   * the newer one) or load the newer one. Either is an undo step: Undo after
   * "Keep my version" puts the other version's changes back, Undo after
   * "Load the latest" brings this tab's version back.
   */
  resolveConflict(choice: "mine" | "theirs") {
    this.checkHandedOver();
    const conflict = this.conflict;
    if (!conflict) return;
    this.commitFields();
    this.conflict = null;
    const mine = this.present;
    const theirs = conflict.workspace;
    this.base = theirs;
    this.baseVersion = conflict.version;
    this.sealed = 0;
    this.sends = [];
    this.rev += 1;
    if (choice === "mine") {
      this.segments = [];
      this.present = theirs;
      this.commitLocal(theirs, mine, { ops: diff(theirs, mine) });
      void this.flush();
      return;
    }
    this.segments = [];
    this.present = theirs;
    this.history = record(this.history, {
      before: mine,
      after: theirs,
      ops: diff(mine, theirs),
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
    this.checkHandedOver();
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
    this.checkHandedOver();
    const key = draftKey(this.id, this.tabId);
    const ops = this.segments.length > 0 ? diff(this.base, this.present) : [];
    if (ops.length === 0) {
      this.removeKey(key);
      return;
    }
    const sends = this.sends.map((s) => ({ saveId: s.saveId, ops: diff(s.doc, this.present) }));
    const find = lookupIn(this.present);
    const ctx: StoredDraft["ctx"] = {};
    for (const op of [...ops, ...sends.flatMap((s) => s.ops)]) {
      for (const { arrayPath, id } of opContainers(op)) {
        const k = `${pathKey(arrayPath)}#${id}`;
        if (k in ctx) continue;
        const found = find(arrayPath, id);
        if (found) ctx[k] = { item: restoreShell(found.item), prev: found.prev };
      }
    }
    const draft: StoredDraft = {
      v: 3,
      id: this.id,
      tabId: this.tabId,
      baseVersion: this.baseVersion,
      savedAt: this.now(),
      ops,
      ctx,
      ...(sends.length ? { sends } : {}),
    };
    try {
      storage.setItem(key, JSON.stringify(draft));
      if (!this.released) storage.setItem(tabKey(this.tabId), String(draft.savedAt));
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

  /**
   * Did another tab take this tab's draft over while this one was asleep
   * (see takenKey)? Then the unsaved edits held here are in its hands, to be
   * merged and saved there: this tab must neither save nor replay them (the
   * text would come twice). It goes back to the last version it knows the
   * server has, and the next read brings the other tab's save of them. Only
   * edits made from now on are this tab's. Called first by every entry point
   * that edits, saves or reads, before anything is built on top of them.
   */
  private checkHandedOver() {
    const storage = this.deps.storage;
    if (!storage) return;
    const key = takenKey(this.id, this.tabId);
    try {
      if (storage.getItem(key) === null) return;
      storage.removeItem(key);
    } catch {
      return;
    }
    if (this.segments.length === 0 && this.sends.length === 0) return;
    this.epoch += 1;
    this.present = this.base;
    this.segments = [];
    this.sealed = 0;
    this.sends = [];
    this.beaconed = null;
    this.conflict = null;
    this.history = breakCoalescing(this.history);
    this.rev += 1; // fields show the stored values again
    this.needsPull = true;
    if (this.status !== "gone") this.status = "saving";
    this.writeDraft();
    this.scheduleFlush(0);
    this.emit();
  }

  /** Mark this tab alive (its draft must not be adopted by another tab). */
  heartbeat() {
    this.checkHandedOver();
    this.released = false;
    try {
      this.deps.storage?.setItem(tabKey(this.tabId), String(this.now()));
    } catch {
      // ignore
    }
  }

  /**
   * This tab is closing (a clean exit): its draft may be recovered by the
   * next tab at once. Nothing until the next `heartbeat` (the page shown
   * again) marks it alive, not even the events that follow pagehide.
   */
  releaseTab() {
    this.released = true;
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
        if (key.startsWith(TAB_PREFIX) || key.startsWith(TAKEN_PREFIX)) {
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

  /** Move a draft under a key of this tab (so no other tab takes it too). */
  private claim(key: string): boolean {
    const storage = this.deps.storage;
    if (!storage) return false;
    try {
      const raw = storage.getItem(key);
      if (raw === null) return false;
      this.claimSeq += 1;
      storage.setItem(draftKey(this.id, `${this.tabId}~${this.now().toString(36)}${this.claimSeq}`), raw);
      storage.removeItem(key);
      // If its tab was only asleep, it learns on waking that these edits
      // are ours to save now.
      const prefix = `${DRAFT_V2_PREFIX}${this.id}:`;
      const owner = key.startsWith(prefix) ? key.slice(prefix.length).split("~")[0] : null;
      if (owner && owner !== this.tabId) storage.setItem(takenKey(this.id, owner), String(this.now()));
      return true;
    } catch {
      return false;
    }
  }

  private claimKeys(): string[] {
    const prefix = draftKey(this.id, `${this.tabId}~`);
    return this.storageKeys().filter((k) => k.startsWith(prefix));
  }

  /**
   * On open: take over edits a closed (or crashed) tab left on this device
   * that never reached the server, this tab's own from before a reload, and
   * a draft in the first editor's format, then merge them (see adoptOrphans).
   */
  recoverDraft() {
    const storage = this.deps.storage;
    if (!storage || this.draftChecked) return;
    this.draftChecked = true;
    this.heartbeat();
    this.sweep(this.storageKeys());
    // Our own key is rewritten by our next edit: take what it holds now.
    this.claim(draftKey(this.id, this.tabId));
    this.claim(draftKey(this.id));
    this.adoptOrphans();
  }

  /**
   * Take over the drafts of tabs that are no longer open and merge them in.
   * Also runs periodically, so a crashed tab's edits are picked up by a tab
   * that was opened right after the crash. Taking a draft over is immediate
   * (two open tabs never both take one); the merge asks the server first
   * which of the draft's saves already landed. The merge is an undo step,
   * announced with a notice; a draft whose edits the server already holds is
   * cleared without asking; a draft of a tab that is still open is left alone.
   */
  adoptOrphans() {
    if (!this.deps.storage) return;
    const prefix = `${DRAFT_V2_PREFIX}${this.id}:`;
    for (const key of this.storageKeys()) {
      if (!key.startsWith(prefix)) continue;
      const owner = key.slice(prefix.length).split("~")[0];
      if (owner === this.tabId || this.tabAlive(owner)) continue;
      this.claim(key);
    }
    if (this.claimKeys().length === 0 || this.merging) return;
    this.merging = true;
    void this.enqueue(() => this.mergeClaims()).finally(() => {
      this.merging = false;
    });
  }

  private async mergeClaims(): Promise<void> {
    const storage = this.deps.storage;
    const keys = this.claimKeys();
    if (!storage || keys.length === 0) return;
    let state: RemoteState | null;
    try {
      state = await this.deps.fetchState(this.id);
    } catch {
      return; // offline: tried again at the next periodic check
    }
    if (!state) return;
    // Our own unsaved edits first, onto the latest version.
    this.receive(state);

    const report = emptyReport();
    let restored = false;
    for (const key of keys) {
      let parsed: StoredDraft | LegacyDraft | null = null;
      try {
        parsed = JSON.parse(storage.getItem(key) ?? "null") as StoredDraft | LegacyDraft | null;
      } catch {
        parsed = null;
      }
      const plan = parsed ? this.planDraft(parsed, state) : null;
      if (!plan) {
        this.removeKey(key);
        continue;
      }
      const result = this.mergeIn(plan.ops, plan.mode, plan.lookup, report, !restored);
      if (result === "invalid") continue; // kept, tried again later
      if (result === "merged") restored = true;
      this.removeKey(key);
    }
    if (restored) {
      this.writeDraft();
      if (reportHasNews(report)) this.merge = combine(this.merge, "draft", report);
      this.emit();
      this.deps.onNotice?.("draftRestored");
    }
  }

  /**
   * What of a draft still has to be applied, and how sure we are of it:
   *  - a save it sent landed: only what came after that save, as a rebase;
   *  - it sent nothing, or the server shows none of its saves landed (or
   *    nothing was saved since its base): all of it, as a rebase;
   *  - otherwise (an old draft format, or a server log that cannot tell):
   *    salvaged, never overwriting or deleting anything.
   */
  private planDraft(
    draft: StoredDraft | LegacyDraft,
    state: RemoteState,
  ): { ops: Op[]; mode: ApplyMode; lookup: Lookup } | null {
    if (draft.v === 1) {
      const repaired = repairWorkspace(draft.workspace, { id: this.id });
      if (!repaired) return null;
      const doc = { ...repaired.workspace, id: this.id };
      return {
        ops: diff(state.workspace, doc),
        mode: draft.baseVersion === state.version ? "rebase" : "salvage",
        lookup: lookupIn(doc),
      };
    }
    if ((draft.v !== 2 && draft.v !== 3) || !Array.isArray(draft.ops)) return null;
    const ctx = draft.ctx ?? {};
    const lookup: Lookup = (arrayPath, id) => ctx[`${pathKey(arrayPath)}#${id}`];
    const sends = draft.v === 3 ? (draft.sends ?? []) : null;
    if (sends) {
      for (let i = sends.length - 1; i >= 0; i -= 1) {
        if (landedVersion(state.saves, sends[i].saveId) !== null) {
          return { ops: sends[i].ops, mode: "rebase", lookup };
        }
      }
      const sure =
        sends.length === 0 ||
        draft.baseVersion === state.version ||
        logCovers(state.saves, draft.baseVersion);
      return { ops: draft.ops, mode: sure ? "rebase" : "salvage", lookup };
    }
    // v2 did not record its saves: sure only if nothing was saved since.
    return { ops: draft.ops, mode: draft.baseVersion === state.version ? "rebase" : "salvage", lookup };
  }

  /** Merge a draft's changes into the present document (one undo step). */
  private mergeIn(
    ops: Op[],
    mode: ApplyMode,
    lookup: Lookup,
    report: MergeReport,
    commitFieldsFirst: boolean,
  ): "merged" | "nothing" | "invalid" {
    const probe = emptyReport();
    let next = applyPatch(this.present, ops, { mode, lookup, report: probe }).doc;
    if (next === this.present || diff(this.present, next).length === 0) return "nothing";
    if (commitFieldsFirst) this.commitFields();
    const local = emptyReport();
    next = applyPatch(this.present, ops, { mode, lookup, report: local }).doc;
    const valid = this.validOrRepaired(next, local);
    if (!valid) return "invalid";
    const prev = this.present;
    this.rev += 1;
    this.commitLocal(prev, valid, {});
    const merged = combine({ source: "draft", report }, "draft", local).report;
    Object.assign(report, merged);
    return "merged";
  }

  /** (Re)start after mount: mark the tab alive and recover drafts once. */
  start() {
    this.disposed = false;
    this.heartbeat();
    this.recoverDraft();
  }

  /**
   * Leaving (tab hidden, or with `final` closing): write buffered typing and
   * the local draft synchronously, then save right away. When closing, the
   * unsaved edits are sent as a patch with a request that outlives the page
   * (`deps.beacon`), so they reach the server and every other device, not
   * only this browser's draft. Returns true when nothing unsaved is left
   * without a way to the server (no leave prompt needed for the document).
   */
  prepareToLeave(final = false): boolean {
    this.checkHandedOver();
    this.commitFields();
    this.writeDraft();
    if (this.segments.length === 0) return true;
    if (final && this.sendOnLeave()) return true;
    void this.flush();
    return false;
  }

  /** True while a field (or an exam in progress) holds work not yet written. */
  hasBufferedWork(): boolean {
    for (const field of this.fields) if (field.hasPending()) return true;
    return false;
  }

  private sendOnLeave(): boolean {
    if (!this.deps.beacon || this.paused || this.conflict) return false;
    if (this.status === "gone" || this.status === "tooLarge" || this.deps.isOnline?.() === false) return false;
    if (this.beaconed === this.present) return true;
    const saveId = newSaveId();
    const body = JSON.stringify({
      id: this.id,
      baseVersion: this.baseVersion,
      saveId,
      ops: diff(this.base, this.present),
    });
    if (body.length > BEACON_MAX_CHARS) return false;
    let sent = false;
    try {
      sent = this.deps.beacon(body);
    } catch {
      sent = false;
    }
    if (!sent) return false;
    // Like any save without a reply: its id tells later whether it landed.
    this.sends.push({ saveId, doc: this.present, count: this.segments.length, baseVersion: this.baseVersion });
    this.sealed = this.segments.length;
    this.beaconed = this.present;
    this.writeDraft();
    return true;
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
