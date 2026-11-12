/**
 * The editor's document engine: undo/redo history, version-aware autosave,
 * crash-safe local drafts and conflict handling. Plain TypeScript (no React)
 * so it can be tested directly; `useWorkspaceSync` wraps it for components.
 *
 * Behaviour, in plain terms:
 *  - Every edit is a history step (typing in one field is merged into one
 *    step). Undo/redo restore exact earlier snapshots.
 *  - Edits are saved 800 ms after the last change, always with the version the
 *    tab last saw. The server refuses a save if someone saved a newer version.
 *  - Unsaved edits are also written to localStorage, so closing the tab (or a
 *    crash) inside the debounce window never loses them; they are restored on
 *    the next visit.
 *  - When a newer version exists (another tab, the AI agent):
 *      no unsaved edits here  -> load it and notify ("updated elsewhere");
 *      unsaved edits here     -> stop saving and ask: keep mine / load latest.
 *    Loading the latest is itself an undoable step, so "mine" stays reachable.
 *  - While the AI agent works, saves pause (so its commit doesn't conflict).
 *    When it finishes, the tab re-fetches the saved workspace and replays the
 *    edits the student made meanwhile on top of the agent's result.
 */
import {
  canRedo,
  canUndo,
  commit,
  createHistory,
  detectRemoval,
  redo as redoHistory,
  undo as undoHistory,
  undoStep,
  type History,
  type Removal,
} from "@/lib/workspace/history";
import { MAX_WORKSPACE_BYTES, repairWorkspace, workspaceBytes } from "@/lib/workspace/repair";
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

type Op = { kind: "mutate"; fn: Mutator } | { kind: "replace" };

export type SaveResult =
  | { status: "saved"; version: number }
  | { status: "conflict"; version: number }
  | { status: "not_found" }
  | { status: "too_large" }
  | { status: "invalid" };

export interface Conflict {
  /** remote: a newer saved version exists; draft: unsaved edits from a past visit. */
  kind: "remote" | "draft";
  workspace: Workspace;
  version?: number;
}

export type Notice = "updatedElsewhere" | "draftRestored";

export interface SyncDeps {
  save: (id: string, ws: Workspace, baseVersion: number) => Promise<SaveResult>;
  fetchState: (id: string) => Promise<{ workspace: Workspace; version: number } | null>;
  fetchVersion: (id: string) => Promise<number | null>;
  storage?: Pick<Storage, "getItem" | "setItem" | "removeItem"> | null;
  now?: () => number;
  isOnline?: () => boolean;
  onRemoval?: (removal: Removal, entryId: number) => void;
  onNotice?: (notice: Notice) => void;
  /** Called after each successful save (used to tell other tabs). */
  onSaved?: (version: number) => void;
}

export interface SyncSnapshot {
  workspace: Workspace;
  rev: number;
  status: SaveStatus;
  canUndo: boolean;
  canRedo: boolean;
  conflict: Conflict | null;
  /** True while there are edits the server has not confirmed yet. */
  dirty: boolean;
}

export const SAVE_DEBOUNCE_MS = 800;
const RETRY_DELAYS_MS = [2_000, 5_000, 15_000, 30_000, 60_000];

interface StoredDraft {
  v: 1;
  baseVersion: number | null;
  savedAt: number;
  workspace: unknown;
}

export function draftKey(id: string): string {
  return `studyos:draft:${id}`;
}

export class WorkspaceSync {
  private history: History;
  private baseVersion: number | null;
  private ops: Op[] = [];
  private inFlight = false;
  private queued = false;
  private paused = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private retryCount = 0;
  private status: SaveStatus = "saved";
  private conflict: Conflict | null = null;
  private rev = 0;
  private resyncChain: Promise<void> = Promise.resolve();
  private draftChecked = false;
  private listeners = new Set<() => void>();
  private snapshot: SyncSnapshot;

  constructor(
    private readonly id: string,
    initial: Workspace,
    initialVersion: number,
    private deps: SyncDeps,
  ) {
    this.history = createHistory(initial);
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
      workspace: this.history.present.workspace,
      rev: this.rev,
      status: this.status,
      canUndo: canUndo(this.history),
      canRedo: canRedo(this.history),
      conflict: this.conflict,
      dirty: this.ops.length > 0 || this.inFlight,
    };
  }

  private emit() {
    this.snapshot = this.buildSnapshot();
    for (const listener of this.listeners) listener();
  }

  get workspace(): Workspace {
    return this.history.present.workspace;
  }

  get version(): number | null {
    return this.baseVersion;
  }

  get hasUnsavedChanges(): boolean {
    return this.ops.length > 0 || this.inFlight;
  }

  private now() {
    return this.deps.now?.() ?? Date.now();
  }

  // ---- editing -------------------------------------------------------------

  /** Apply an edit. `coalesceKey` merges a typing burst into one undo step. */
  update(mutator: Mutator, coalesceKey: string | null = null) {
    const prev = this.history.present.workspace;
    const next = structuredClone(prev);
    mutator(next);
    const removal = detectRemoval(prev, next);
    this.history = commit(this.history, next, {
      now: this.now(),
      coalesceKey: removal ? null : coalesceKey,
    });
    this.ops.push({ kind: "mutate", fn: mutator });
    this.markDirty();
    if (removal) this.deps.onRemoval?.(removal, this.history.present.id);
  }

  undo(): boolean {
    if (!canUndo(this.history)) return false;
    this.history = undoHistory(this.history);
    this.afterLocalReplace();
    return true;
  }

  redo(): boolean {
    if (!canRedo(this.history)) return false;
    this.history = redoHistory(this.history);
    this.afterLocalReplace();
    return true;
  }

  /** Undo back to just before history step `entryId` (the Undo toast). */
  undoTo(entryId: number): boolean {
    const next = undoStep(this.history, entryId);
    if (!next) return false;
    this.history = next;
    this.afterLocalReplace();
    return true;
  }

  private afterLocalReplace() {
    this.ops.push({ kind: "replace" });
    this.rev += 1;
    this.markDirty();
  }

  /** Replace the document with a version from outside (server, draft). */
  private replaceFromOutside(workspace: Workspace) {
    this.history = commit(this.history, workspace, { now: this.now() });
    this.rev += 1;
  }

  private markDirty() {
    if (this.status === "saved" || this.status === "tooLarge") {
      this.status = "saving";
    }
    this.scheduleFlush(SAVE_DEBOUNCE_MS);
    this.emit();
  }

  // ---- saving ----------------------------------------------------------------

  private scheduleFlush(delay: number) {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      this.writeDraft();
      void this.flush();
    }, delay);
  }

  /** Save now (skipping the debounce). Safe to call at any time. */
  async flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.inFlight) {
      this.queued = true;
      return;
    }
    if (this.paused || this.conflict || this.status === "gone") return;
    if (this.ops.length === 0) {
      if (this.status === "saving") {
        this.status = "saved";
        this.emit();
      }
      return;
    }
    if (this.baseVersion === null) {
      await this.resync();
      return;
    }

    const workspace = this.history.present.workspace;
    if (workspaceBytes(workspace) > MAX_WORKSPACE_BYTES) {
      this.writeDraft();
      this.status = "tooLarge";
      this.emit();
      return;
    }

    const sentOps = this.ops.length;
    const baseVersion = this.baseVersion;
    this.writeDraft();
    this.inFlight = true;
    this.status = "saving";
    this.emit();

    let result: SaveResult | null = null;
    try {
      result = await this.deps.save(this.id, workspace, baseVersion);
    } catch {
      result = null;
    }
    this.inFlight = false;

    if (!result) {
      this.status = this.deps.isOnline?.() === false ? "offline" : "error";
      this.scheduleRetry();
    } else if (result.status === "saved") {
      this.baseVersion = result.version;
      this.ops.splice(0, sentOps);
      this.retryCount = 0;
      this.deps.onSaved?.(result.version);
      if (this.ops.length === 0) {
        this.clearDraft();
        this.status = "saved";
      } else {
        this.status = "saving";
        this.scheduleFlush(SAVE_DEBOUNCE_MS);
      }
    } else if (result.status === "conflict") {
      this.queued = false;
      this.emit();
      await this.handleNewerVersion();
      return;
    } else if (result.status === "not_found") {
      this.status = "gone";
    } else if (result.status === "too_large") {
      this.status = "tooLarge";
    } else {
      this.status = "error";
    }
    this.emit();

    if (this.queued) {
      this.queued = false;
      if (this.status === "saving") this.scheduleFlush(0);
    }
  }

  private scheduleRetry() {
    if (this.retryTimer) clearTimeout(this.retryTimer);
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

  // ---- other tabs / the agent ----------------------------------------------

  /**
   * A newer version exists on the server. With no unsaved edits here, load it
   * and say so; with unsaved edits, stop and let the student choose.
   */
  private async handleNewerVersion(): Promise<void> {
    let state: { workspace: Workspace; version: number } | null;
    try {
      state = await this.deps.fetchState(this.id);
    } catch {
      this.status = this.deps.isOnline?.() === false ? "offline" : "error";
      this.emit();
      return;
    }
    if (!state) {
      this.status = "gone";
      this.emit();
      return;
    }
    if (state.version === this.baseVersion) {
      if (this.ops.length) this.scheduleFlush(0);
      return;
    }
    if (this.ops.length === 0) {
      this.replaceFromOutside(state.workspace);
      this.baseVersion = state.version;
      this.status = "saved";
      this.emit();
      this.deps.onNotice?.("updatedElsewhere");
      return;
    }
    this.conflict = { kind: "remote", workspace: state.workspace, version: state.version };
    this.status = "conflict";
    this.writeDraft();
    this.emit();
  }

  /** Cheap check (focus, visibility, polling, other-tab message). */
  async checkRemote(): Promise<void> {
    if (this.inFlight || this.paused || this.conflict || this.status === "gone") return;
    let version: number | null;
    try {
      version = await this.deps.fetchVersion(this.id);
    } catch {
      return; // offline: the save path reports it
    }
    if (version === null) {
      this.status = "gone";
      this.emit();
      return;
    }
    if (version !== this.baseVersion && !this.inFlight && !this.paused) {
      await this.handleNewerVersion();
    }
  }

  /** The agent started (true) or finished (false) a task. */
  setAgentBusy(busy: boolean) {
    if (busy === this.paused) return;
    this.paused = busy;
    if (!busy) void this.resync();
  }

  /**
   * Re-read the saved workspace after the agent changed it (or finished), and
   * replay this tab's unsaved edits on top of it so nothing typed meanwhile is
   * lost. Serialized: overlapping calls run one after another.
   */
  resync(): Promise<void> {
    this.resyncChain = this.resyncChain.then(() => this.doResync());
    return this.resyncChain;
  }

  private async doResync(): Promise<void> {
    let state: { workspace: Workspace; version: number } | null;
    try {
      state = await this.deps.fetchState(this.id);
    } catch {
      // Keep the edits; the next flush or Retry resyncs first.
      this.baseVersion = null;
      this.status = this.deps.isOnline?.() === false ? "offline" : "error";
      this.writeDraft();
      this.emit();
      return;
    }
    if (!state) {
      this.status = "gone";
      this.emit();
      return;
    }
    if (state.version === this.baseVersion) {
      if (this.ops.length && !this.paused) void this.flush();
      return;
    }

    if (this.ops.length === 0) {
      this.replaceFromOutside(state.workspace);
      this.baseVersion = state.version;
      this.status = "saved";
      this.emit();
      return;
    }

    // Replay the student's edits on the newer document. A whole-document step
    // (undo/redo) cannot be replayed safely, so that case asks instead.
    const rebased = structuredClone(state.workspace);
    let replayable = this.ops.every((op) => op.kind === "mutate");
    if (replayable) {
      try {
        for (const op of this.ops) if (op.kind === "mutate") op.fn(rebased);
      } catch {
        replayable = false;
      }
    }
    if (!replayable) {
      this.conflict = { kind: "remote", workspace: state.workspace, version: state.version };
      this.status = "conflict";
      this.writeDraft();
      this.emit();
      return;
    }
    this.replaceFromOutside(rebased);
    this.baseVersion = state.version;
    this.status = "saving";
    this.emit();
    if (!this.paused) void this.flush();
  }

  /** The student's answer to a conflict banner. */
  resolveConflict(choice: "mine" | "theirs") {
    const conflict = this.conflict;
    if (!conflict) return;
    this.conflict = null;
    if (conflict.kind === "remote") {
      if (choice === "mine") {
        this.baseVersion = conflict.version ?? this.baseVersion;
        if (this.ops.length === 0) this.ops.push({ kind: "replace" });
        this.status = "saving";
        this.emit();
        void this.flush();
      } else {
        this.replaceFromOutside(conflict.workspace);
        this.baseVersion = conflict.version ?? this.baseVersion;
        this.ops = [];
        this.clearDraft();
        this.status = "saved";
        this.emit();
      }
      return;
    }
    // Draft from an earlier visit.
    if (choice === "mine") {
      this.replaceFromOutside(conflict.workspace);
      this.ops.push({ kind: "replace" });
      this.status = "saving";
      this.emit();
      void this.flush();
    } else {
      this.clearDraft();
      this.emit();
    }
  }

  // ---- local drafts (never lose edits to a closed tab) ------------------------

  writeDraft() {
    const storage = this.deps.storage;
    if (!storage || this.ops.length === 0) return;
    const draft: StoredDraft = {
      v: 1,
      baseVersion: this.baseVersion,
      savedAt: this.now(),
      workspace: this.history.present.workspace,
    };
    try {
      storage.setItem(draftKey(this.id), JSON.stringify(draft));
    } catch {
      // Quota or privacy mode: the server save is still the main path.
    }
  }

  private clearDraft() {
    try {
      this.deps.storage?.removeItem(draftKey(this.id));
    } catch {
      // ignore
    }
  }

  /**
   * On open: if this device holds edits that never reached the server, bring
   * them back. Restored automatically when they were based on the version we
   * just loaded; otherwise the student chooses.
   */
  recoverDraft() {
    const storage = this.deps.storage;
    if (!storage || this.draftChecked) return;
    this.draftChecked = true;
    let draft: StoredDraft | null = null;
    try {
      const raw = storage.getItem(draftKey(this.id));
      draft = raw ? (JSON.parse(raw) as StoredDraft) : null;
    } catch {
      draft = null;
    }
    if (!draft || draft.v !== 1) return;
    const repaired = repairWorkspace(draft.workspace, { id: this.id });
    if (!repaired) {
      this.clearDraft();
      return;
    }
    const workspace = { ...repaired.workspace, id: this.id };
    if (JSON.stringify(workspace) === JSON.stringify(this.workspace)) {
      this.clearDraft();
      return;
    }
    if (draft.baseVersion === this.baseVersion && this.ops.length === 0) {
      this.replaceFromOutside(workspace);
      this.ops.push({ kind: "replace" });
      this.status = "saving";
      this.emit();
      this.deps.onNotice?.("draftRestored");
      void this.flush();
      return;
    }
    this.conflict = { kind: "draft", workspace };
    this.emit();
  }

  /** Stop timers. Pending edits are already in the local draft. */
  dispose() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
      this.writeDraft();
      void this.flush();
    }
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
  }
}
