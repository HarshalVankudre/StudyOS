/**
 * The editor's document engine: undo/redo, autosave, local drafts and merging
 * with changes made elsewhere. Plain TypeScript (no React) so it can be tested
 * directly; `useWorkspaceSync` wraps it for components.
 *
 * ============================================================================
 * THE DESIGN (fourth version; what a reviewer should check the code against)
 * ============================================================================
 *
 * ONE WAY TO THE SERVER. A save is the whole document plus the version it was
 * edited on. The server stores it only if the workspace is still at that
 * version (a compare-and-swap, lib/workspace/store.ts `saveWorkspace`), and
 * then it becomes exactly that version + 1. The server never merges an
 * editor's changes into anything; there is no other route by which a tab's
 * edits reach it (nothing is sent while the page closes). All merging happens
 * here, in the tab, which holds both documents.
 *
 * THE MODEL IN THE TAB.
 *   base      the document at `baseVersion`, exactly as a save of this tab or
 *             a read gave it
 *   segments  the student's unsaved changes since `base`, oldest first (each
 *             one a pair of documents; a new one starts at every save)
 *   present   base + segments: what the editor shows
 *   sends     saves of this tab that got no reply. All of them were made on
 *             `baseVersion`, so at most one of them can have landed, and only
 *             as version baseVersion + 1.
 * When the server holds a newer version, the segments are replayed on it as
 * id-addressed changes (lib/workspace/changes.ts): "page p1 / block b7 /
 * text: 'hi' -> 'hi there'".
 *
 * THE GUARANTEES.
 *  G1  On this device first. Every edit is written to this browser's storage
 *      (localStorage, one draft per tab) in the same task that made it. It is
 *      removed only when the server confirmed a save that contains it, or
 *      when another tab of this browser took it over to finish the job. If
 *      storage refuses, the student is told once ("localCopyFailed") and the
 *      status stops saying the edits are kept on this device (`localCopy`).
 *  G2  Applied once. A save without a reply is never "applied again over
 *      whatever happened since". Whether it landed is read from the server's
 *      save log (lib/workspace/save-ids.ts), which answers with certainty or
 *      says that it cannot. When it answers (always, among instances of this
 *      build, however many saves were made meanwhile) each change of the
 *      student's is applied to the server's document exactly once. When it
 *      cannot, nothing is re-applied in place (see "uncertain"): what might
 *      be applied a second time is only ever added next to what is there.
 *  G3  Nothing replaced without a trace. Replaying changes on a document that
 *      moved on never drops or overwrites silently. Each change either lands;
 *      or merges (prose, three-way, lib/workspace/text-merge.ts: a clean
 *      merge holds everything either side added exactly once and nothing
 *      either removed, anything less sure is a conflict); or both versions
 *      are kept (a marked copy of the paragraph); or it is listed in the
 *      banner with the item it belongs to and a button to take the other
 *      value. Which of these depends on how sure the engine is:
 *        "rebase"   this tab's own live edits on a newer version: the
 *                   student's value wins a collision, the replaced one is
 *                   offered back;
 *        "recover"  edits from a tab that is gone (its draft), merged later.
 *                   If the workspace is exactly as that tab left it (same
 *                   version, nothing edited in this browser since), they
 *                   simply apply. Otherwise they only add: new items, text
 *                   added to text, fields that held nothing, re-run edits.
 *                   A value they would replace stays and theirs is offered;
 *                   text they would shorten is kept as a second, marked
 *                   version; their deletions and moves are not repeated.
 *                   ("Still the value I started from" cannot tell untouched
 *                   from changed and changed back, so it is not relied on.)
 *        "keep"     edits of which it is not known whether they were already
 *                   saved once: additive only (see "uncertain" below).
 *  G4  Said in the same tab, about the item, when it happens. Every outcome
 *      other than "landed as typed" raises the merge banner (snapshot
 *      `merge`) in the tab where it happened, with the affected items
 *      (`report.where`, `overwritten`, `unapplied`, `replaced`).
 *
 * WHAT HAPPENS IN EACH UNCERTAIN SITUATION, AND WHAT THE STUDENT IS TOLD.
 *  - The reply to a save is lost. The save stays in `sends`; the status shows
 *    "not saved, trying again" and the edits are in the local draft. The tab
 *    retries on the same version (a compare-and-swap: if the lost one landed,
 *    the retry is refused). On the next read the log tells (`fateOfSends`):
 *      landed   base becomes that save's document, only later edits remain;
 *      none     the workspace moved on without it: all edits are replayed;
 *      pending  the workspace is still at that version: nothing to do yet;
 *      unknown  see "uncertain".
 *  - The tab is closed, crashes, or the phone kills it. Nothing is sent. The
 *    draft stays in this browser. The next time the workspace is open in any
 *    tab of this browser, that tab takes the draft over and merges it in
 *    "recover" mode as one undoable step, with a notice ("draftRestored")
 *    and, for whatever did not simply go in, the banner.
 *    If the dead tab had saves without a reply while the workspace is still
 *    at their version, the adopting tab first saves once itself on that
 *    version: the compare-and-swap lets exactly one of the two through, so
 *    the question is settled before anything is merged. A draft the log
 *    shows to be older than its own tab's last save (storage refused the
 *    later writes) is treated as "uncertain". Until that browser is opened
 *    again, the edits exist only there: the product says "not saved yet ·
 *    kept on this device", never "saved", for them, and asks before the tab
 *    is closed with unsaved edits.
 *  - A device sleeps (laptop lid, a phone freezing the tab). However many
 *    saves other devices made meanwhile, the log still answers: it keeps one
 *    entry per tab, not per save. On waking the tab first checks whether
 *    another tab of this browser took its draft over (then those edits are
 *    that tab's to save and are dropped here), then reads and resolves.
 *  - A deploy is in progress. (a) An instance of an older build wrote a
 *    version: it does not keep the log in step, the log shows the gap, and a
 *    tab asking about a save in that gap gets "unknown". (b) This tab IS the
 *    older build and the server no longer knows its actions: status
 *    "outdated", the student is asked to reload; the edits are in the draft
 *    and are merged after the reload.
 *  - A draft in an older format (written by an earlier build). Formats that
 *    recorded their saves are resolved like any other draft; where that is
 *    not possible, see "uncertain".
 *  - Uncertain (the log cannot tell whether a save landed). First: if every
 *    possibility gives the same document (the server still holds what that
 *    save wrote, or the edits apply the same either way), there is nothing
 *    to decide, and the banner says what the "none landed" possibility has
 *    to say (a value that did not go in, a deletion that was not repeated).
 *    Otherwise every possibility is applied in "keep" mode, which
 *    only adds: the whole unsaved patch (as if nothing landed), then what
 *    would remain after each save that may have landed. Missing items are
 *    added back; a paragraph whose text differs is kept as a marked copy
 *    next to the current one; any other value that differs is left as it is
 *    and listed with "use my values"; deletions and moves are not repeated.
 *    Nothing on the server's document is replaced or removed, and the banner
 *    says that the edits "could not be confirmed as saved" and what was done
 *    with each.
 *
 * WHAT ELSE RUNS ON THE SAME MODEL.
 *  - Undo/redo: each history step is the student's own patch. Undo applies
 *    its inverse on top of the current document, so it never reverts what
 *    arrived from elsewhere (updates from outside are not history steps).
 *    An unsaved undo replayed on a newer version keeps that rule for single
 *    values (one changed elsewhere since stays, and the banner lists the
 *    undone value as not applied); text still merges or keeps both versions.
 *  - A change made and taken back before it was saved (typed, then undone)
 *    is no change: what cancels out over the unsaved segments is dropped
 *    before they are replayed, so it cannot come back as an edit.
 *  - A value this tab saved that is changed elsewhere afterwards (the other
 *    device's edit won, or was simply made later) is reported here too
 *    (`merge.replaced`), with "use my values".
 *  - Edits that compute from the current state (a flashcard review) ask to be
 *    re-run on the newer document instead (`update(fn, { rebase: "rerun" })`).
 *    Such an edit must be idempotent and order-independent (a review is keyed
 *    by its time, lib/study/review-log.ts). Given a `replay` description it
 *    is also re-run, not patched, when recovered from a draft, and stays a
 *    re-run edit in the tab that recovered it. Undoing one that is not saved
 *    yet switches it off (it is not run again, and the document is computed
 *    again without it), redo switches it on; only once it is saved is its
 *    undo a patch like any other.
 *  - Tabs of one browser: a tab that shows no sign of life for TAB_ALIVE_MS
 *    is presumed closed and its draft is taken over; the taker leaves a mark
 *    and the tab, should it wake, gives those edits up (`checkHandedOver`,
 *    called before it edits, saves, reads or writes its draft) together with
 *    its undo history (undoing or redoing steps that are now another tab's
 *    to save would act on a document that is no longer this one's). Tab ids
 *    are made per page load and never reused, so two live tabs never share
 *    one.
 *
 * HOW A COMPONENT'S EDITS TAKE PART (for new block types): call `update` with
 * a mutator that finds what it edits by id (page id, block id, card id...) and
 * changes it in place. That is all; the patch is derived automatically and
 * merges field by field. Use `rebase: "rerun"` only for edits whose result
 * depends on the value they start from (counters, schedules, scores); such a
 * mutator must also be idempotent (it can run again on a document that
 * already contains its effect): give it a natural key such as the answer's
 * timestamp, and never create random ids or timestamps inside it
 * (lib/workspace/stable-id.ts).
 *
 * Edits run on a copy-on-write draft (lib/workspace/draft.ts): only what an
 * edit touches is copied, so editing a large workspace costs what the edit
 * costs. Versions of the document share everything they have in common.
 *
 * Network calls (save, read, version check) run one at a time through an
 * internal queue, so a read can never race a save of the same tab.
 */
import {
  addReport,
  applyPatch,
  deepEqual,
  diff,
  emptyReport,
  getAt,
  invertPatch,
  lookupIn,
  opContainers,
  pathKey,
  proseLimit,
  reportHasNews,
  restoreShell,
  shareWith,
  type ApplyMode,
  type IdItem,
  type Lookup,
  type MergeReport,
  type Op,
  type Overwrite,
  type Path,
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
import { fateOfSends, isSaveLog, newSaveId, newTabId } from "@/lib/workspace/save-ids";
import { safeParseWorkspace } from "@/lib/workspace/schema";
import type { Workspace } from "@/lib/workspace/types";

export type SaveStatus =
  | "saved"
  | "saving"
  | "offline"
  | "error"
  | "conflict"
  | "tooLarge"
  | "gone"
  /** This tab runs an older build the server no longer serves: reload to go on saving. */
  | "outdated";

export type Mutator = (draft: Workspace) => void;

/**
 * A re-run edit as data, so it can be re-run (not patched) when it is
 * recovered from a draft: the name of a replayer the editor registered
 * (`SyncDeps.replayers`) and its JSON arguments.
 */
export interface Replay {
  name: string;
  args: unknown;
}

export interface UpdateOptions {
  /** Same key within a short time merges a typing burst into one undo step. */
  coalesceKey?: string | null;
  /**
   * How the edit is carried over if the document changes elsewhere before it
   * is saved: "patch" (default) re-applies its changes by id; "rerun" runs the
   * mutator again on the newer document (see the module comment).
   */
  rebase?: "patch" | "rerun";
  /** With "rerun": the same edit as data, for recovery from a draft. */
  replay?: Replay;
}

/** The reply to a save. `saves` (on a refusal) is the server's save log. */
export type SaveResult =
  | { status: "saved"; version: number }
  | { status: "conflict"; version: number; saves?: unknown }
  | { status: "not_found" }
  | { status: "too_large" }
  | { status: "invalid" };

export interface RemoteState {
  workspace: Workspace;
  version: number;
  /** The server's save log as of this read (lib/workspace/save-ids.ts). */
  saves?: unknown;
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

/**
 * What the student is told after something other than "landed as typed":
 *  - "remote": this tab's unsaved edits were merged with a newer version;
 *  - "draft": edits of a closed tab were recovered;
 *  - "unconfirmed": edits that could not be confirmed as saved were added
 *    back without replacing anything ("keep" mode).
 * `replaced`: values this tab had saved that were changed elsewhere since
 * (`mine` is the value saved here, `theirs` the one in place now).
 */
export interface MergeNotice {
  source: "remote" | "draft" | "unconfirmed";
  report: MergeReport;
  replaced: Overwrite[];
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
  save: (
    id: string,
    ws: Workspace,
    baseVersion: number,
    saveId?: string,
    tabId?: string,
  ) => Promise<SaveResult>;
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
  /**
   * This tab's id: one per page load, never reused. Random when omitted. It
   * must be a token (lib/workspace/save-ids.ts `isTabId`) for the server to
   * record this tab's saves; with any other value every lost reply is
   * "unknown" (safe, never wrong).
   */
  tabId?: string;
  /** Re-run edits by name, for drafts that recorded them (`UpdateOptions.replay`). */
  replayers?: Record<string, (args: unknown) => Mutator | null>;
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
  /**
   * Unsaved edits are stored in this browser (G1). False when there is no
   * storage or the last write was refused: the interface must not say "kept
   * on this device" then.
   */
  localCopy: boolean;
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
/** Values this tab saved are watched for a change from elsewhere for this long. */
const OWN_VALUE_WATCH_MS = 30 * 60 * 1000;
const OWN_VALUES_MAX = 200;

const DRAFT_PREFIX = "studyos:draft:";
const DRAFT_V2_PREFIX = `${DRAFT_PREFIX}v2:`;
const TAB_PREFIX = "studyos:tab:";

/**
 * localStorage key of a draft: per tab (`tabId`), since a draft is one tab's
 * unsaved edits. Without `tabId`: the single-draft key of the first editor.
 * A key "<tab>~<n>" holds a draft that tab took over (from a closed tab) and
 * has not finished merging yet.
 */
export function draftKey(id: string, tabId?: string): string {
  return tabId ? `${DRAFT_V2_PREFIX}${id}:${tabId}` : `${DRAFT_PREFIX}${id}`;
}

export function tabKey(tabId: string): string {
  return `${TAB_PREFIX}${tabId}`;
}

const TAKEN_PREFIX = "studyos:taken:";
const EDITED_PREFIX = "studyos:edited:";

/**
 * When the student last edited this workspace in any tab of this browser. A
 * draft whose own last edit is not older than that is the latest thing that
 * happened here (see "recover" in the module comment).
 */
export function editedKey(id: string): string {
  return `${EDITED_PREFIX}${id}`;
}

/**
 * Set when another tab took over this tab's draft (it looked closed: no sign
 * of life for TAB_ALIVE_MS, as when a phone froze it in the background). If
 * the tab was only asleep and wakes up, the edits it still holds are the
 * other tab's to save now; this tab must not replay them (twice the text).
 */
export function takenKey(id: string, tabId: string): string {
  return `${TAKEN_PREFIX}${id}:${tabId}`;
}

/**
 * Unsaved edits as stored: the changes (one patch between two real documents,
 * never a chain of patches), and the re-run edits among them as data. Where
 * every one of those can be re-run (`replays`), `replayKeys` names the changes
 * that re-running redoes, so they are not applied a second time as a patch.
 */
interface StoredPatch {
  ops: Op[];
  replays?: Replay[];
  replayKeys?: string[];
}

/** A tab's unsaved edits as written to localStorage (the tab's sync state, serialised). */
interface StoredDraft extends StoredPatch {
  v: 4;
  id: string;
  tabId: string;
  /** The version the edits are based on. `ops`: that version -> the tab's document. */
  baseVersion: number;
  savedAt: number;
  /** When the student last edited in that tab (see editedKey). */
  editedAt?: number;
  /** Saves sent without a reply, each with what would remain had it landed. */
  sends?: Array<{ saveId: string } & StoredPatch>;
  /** Restorable copies of the items the changes touch (see changes.restoreShell). */
  ctx: Record<string, { item: IdItem; prev: string | null }>;
}

/** Drafts of the second and third engine: one patch, v3 with its saves. */
interface PatchDraft {
  v: 2 | 3;
  id?: string;
  tabId?: string;
  baseVersion: number;
  savedAt?: number;
  ops: Op[];
  ctx?: Record<string, { item: IdItem; prev: string | null }>;
  /** v3: each save sent without a reply, with the changes made after it. */
  sends?: Array<{ saveId: string; ops: Op[] }>;
}

/** A whole-document draft written by the first version of the editor. */
interface LegacyDraft {
  v: 1;
  baseVersion: number | null;
  savedAt?: number;
  workspace: unknown;
}

/** A draft taken over from a closed tab, in one shape whatever its format. */
interface Recovered {
  tabId: string;
  /** Null: the version it was based on is not known. */
  baseVersion: number | null;
  /** Everything unsaved. */
  all: StoredPatch;
  /** Its saves without a reply, each with what would remain had it landed. */
  sends: Array<{ saveId: string; rest: StoredPatch }>;
  lookup: Lookup;
  /** The format cannot say what was sent: certain only while the server is still at `baseVersion`. */
  sentUnknown: boolean;
  /** When the student last edited in that tab; null when the draft does not say. */
  editedAt: number | null;
}

type Segment =
  /**
   * `undo`: made by undo/redo. Replayed on a newer version it keeps the rule
   * of undo for single values: one that was changed elsewhere since is left
   * alone (never "the student's value wins"; an undone count or date must
   * not overwrite a newer one). Text still merges or keeps both versions.
   */
  | { kind: "patch"; undo?: boolean; entry?: number; before: Workspace; after: Workspace }
  /**
   * `entries`: the undo step of each edit (-1: none). Undoing a re-run edit
   * that is still unsaved does not add "its inverse" for good: the edit is
   * switched off (`WorkspaceSync.cancelled`) and simply not run again, and
   * the undo's own patch (`entry` above) is left out while the edit is here.
   * A patch that takes back a count could not be replayed correctly.
   */
  | {
      kind: "rerun";
      fns: Mutator[];
      replays: Array<Replay | null>;
      entries: number[];
      before: Workspace;
      after: Workspace;
    };

/** A save sent whose reply never arrived (it may or may not have landed). */
interface Sent {
  saveId: string;
  doc: Workspace;
  /** How many segments it carried. */
  count: number;
}

/** A single value this tab saved, watched for a change from elsewhere. */
interface OwnValue {
  path: Path;
  mine: unknown;
  at: number;
  /** Typed in this tab and given up to another tab unsaved (see settleHanded). */
  handed?: boolean;
}

/** What a change is about, to tell whether two patches hold "the same" change. */
function opKey(op: Op): string {
  if (op.op === "set") return pathKey(op.path);
  return `${pathKey(op.path)}#${op.op === "mov" ? op.id : op.item.id}`;
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

function sameDoc(a: Workspace, b: Workspace): boolean {
  return a === b || diff(a, b).length === 0;
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
  /** Saves made on `baseVersion` whose outcome is unknown, oldest first. */
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
  /** Keys of the drafts this tab took over and has not finished merging. */
  private claimed = new Set<string>();
  private merging = false;
  private storageFailed = false;
  /** When the student last edited in this tab (0: not yet), or in a tab whose draft it holds. */
  private editedAt = 0;
  /** The version a confirmed save of this tab made last. */
  private ownSave = 0;
  /**
   * A save of this tab that changed nothing (made only to settle a dead
   * tab's saves, see mergeClaims): version `to` is version `from`.
   */
  private fenced: { from: number; to: number } | null = null;
  /** This tab said goodbye (pagehide): no sign of life until it is shown again. */
  private released = false;
  /** Bumped when this tab's unsaved edits were handed to another tab. */
  private epoch = 0;
  private disposed = false;
  /** Single values this tab saved recently (to say when they change elsewhere). */
  private ownValues: OwnValue[] = [];
  /** Undo steps of re-run edits that are undone at the moment (see Segment). */
  private cancelled = new Set<number>();
  /** The changes of segments that can no longer change (sent ones). */
  private segmentOps = new WeakMap<Segment, Op[]>();
  private listeners = new Set<() => void>();
  private snapshot: SyncSnapshot;

  constructor(
    private readonly id: string,
    initial: Workspace,
    initialVersion: number,
    private deps: SyncDeps,
  ) {
    this.tabId = deps.tabId ?? newTabId();
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
      localCopy: Boolean(this.deps.storage) && !this.storageFailed,
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

  /** Statuses in which nothing is sent until the student acts. */
  private get halted(): boolean {
    return this.status === "gone" || this.status === "outdated";
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

  /** True while a field (or an exam in progress) holds work not yet written. */
  hasBufferedWork(): boolean {
    for (const field of this.fields) if (field.hasPending()) return true;
    return false;
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
      rerun: opts.rebase === "rerun" ? { fn: mutator, replay: opts.replay ?? null } : undefined,
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
    opts: {
      ops?: Op[];
      rerun?: { fn: Mutator; replay: Replay | null };
      coalesceKey?: string | null;
      history?: boolean;
      /** The change is an undo or redo (see Segment), of undo step `entry`. */
      undo?: boolean;
      entry?: number;
    },
  ): number {
    this.present = next;
    this.editedAt = this.now();
    try {
      this.deps.storage?.setItem(editedKey(this.id), String(this.editedAt));
    } catch {
      // The draft write that follows reports a full or blocked storage.
    }
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
    this.addSegment(
      prev,
      next,
      opts.rerun ? { ...opts.rerun, entry: entryId } : undefined,
      opts.undo === true ? { entry: opts.entry ?? -1 } : undefined,
    );
    this.markDirty();
    return entryId;
  }

  private addSegment(
    prev: Workspace,
    next: Workspace,
    rerun?: { fn: Mutator; replay: Replay | null; entry?: number },
    undo?: { entry: number },
  ) {
    const last = this.segments[this.segments.length - 1];
    const open = last && this.segments.length > this.sealed;
    if (rerun) {
      // Re-run edits that can be replayed from a draft and ones that cannot
      // are kept in separate segments (a segment is stored one way or the other).
      const sameKind =
        open && last.kind === "rerun" && last.replays.every((r) => r !== null) === (rerun.replay !== null);
      if (sameKind && last.kind === "rerun") {
        last.fns.push(rerun.fn);
        last.replays.push(rerun.replay);
        last.entries.push(rerun.entry ?? -1);
        last.after = next;
      } else {
        this.segments.push({
          kind: "rerun",
          fns: [rerun.fn],
          replays: [rerun.replay],
          entries: [rerun.entry ?? -1],
          before: prev,
          after: next,
        });
      }
    } else if (undo) {
      // Each undo or redo is a segment of its own (it may be left out, see Segment).
      this.segments.push({ kind: "patch", undo: true, entry: undo.entry, before: prev, after: next });
    } else if (open && last.kind === "patch" && !last.undo) {
      last.after = next;
    } else {
      this.segments.push({ kind: "patch", before: prev, after: next });
    }
  }

  /** Is the re-run edit recorded as undo step `entry` still among the unsaved segments? */
  private holdsRerun(entry: number, segments: readonly Segment[] = this.segments): boolean {
    return entry >= 0 && segments.some((seg) => seg.kind === "rerun" && seg.entries.includes(entry));
  }

  /** The edits of a re-run segment that are not undone at the moment. */
  private active<T>(seg: Extract<Segment, { kind: "rerun" }>, list: readonly T[]): T[] {
    return list.filter((_, i) => !this.cancelled.has(seg.entries[i]));
  }

  undo(): boolean {
    this.checkHandedOver();
    this.commitFields();
    const taken = takeUndo(this.history);
    if (!taken) return false;
    this.history = taken.history;
    this.applyHistory(invertPatch(taken.entry.ops), taken.entry.id, true);
    return true;
  }

  redo(): boolean {
    this.checkHandedOver();
    this.commitFields();
    const taken = takeRedo(this.history);
    if (!taken) return false;
    this.history = taken.history;
    this.applyHistory(taken.entry.ops, taken.entry.id, false);
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
    this.applyHistory(invertPatch(taken.entry.ops), taken.entry.id, true);
    return true;
  }

  private applyHistory(ops: Op[], entry: number, undone: boolean) {
    const prev = this.present;
    let next: Workspace | null = null;
    if (this.holdsRerun(entry)) {
      // A re-run edit that is still unsaved is switched off (or on again),
      // and the document is what the unsaved edits give without it (with
      // it). Its recorded change is not what is applied: the edit may have
      // been run again on a newer version since and no longer be that change.
      if (undone) this.cancelled.add(entry);
      else this.cancelled.delete(entry);
      try {
        const replayed = shareWith(prev, this.rebaseOnto(this.base, this.segments).doc);
        next = replayed.changed ? replayed.doc : prev;
      } catch (error) {
        console.error("[StudyOS] could not replay the unsaved edits", error);
      }
    }
    if (next === null) {
      const result = applyPatch(prev, ops, { mode: "undo" });
      if (result.report.skipped > 0) this.deps.onNotice?.("undoPartial");
      next = result.doc;
    }
    this.rev += 1;
    if (next === prev) {
      this.writeDraft(); // (which re-run edits are switched off is part of it)
      this.emit();
      return;
    }
    this.commitLocal(prev, next, { history: false, undo: true, entry });
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

  /**
   * One save: the present document, on `baseVersion`. `evenIfClean` saves
   * although nothing changed (used once before a closed tab's draft is
   * merged, see `mergeClaims`).
   */
  private async saveStep(evenIfClean = false): Promise<void> {
    if (this.paused || this.conflict) return;
    this.checkHandedOver();
    if (this.needsPull && !(await this.pullStep())) return;
    if (this.halted || this.conflict || this.paused) return;
    if (this.segments.length === 0 && !evenIfClean) {
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
    const sent: Sent = { saveId: newSaveId(), doc, count: this.segments.length };
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
    const baseVersion = this.baseVersion;
    try {
      result = await this.deps.save(this.id, doc, baseVersion, sent.saveId, this.tabId);
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
    if ((this.status as SaveStatus) === "outdated") {
      this.emit();
      return;
    }

    if (!result) {
      // It may or may not have reached the server: the save log tells later.
      this.status = this.deps.isOnline?.() === false ? "offline" : "error";
      this.scheduleRetry();
      this.emit();
      return;
    }
    // The server answered: this save's own outcome is known.
    this.sends = this.sends.filter((s) => s !== sent);
    switch (result.status) {
      case "saved":
        // It produced baseVersion + 1, so no earlier save on that version did.
        this.sends = [];
        this.retryCount = 0;
        this.acceptSaved(doc, sent.count, result.version);
        break;
      case "conflict":
        // A newer version exists: bring our edits over to it and save again.
        this.sealed = this.sends.reduce((n, s) => Math.max(n, s.count), 0);
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
    this.ownSave = version;
    this.watchOwnValues(this.segments.slice(0, count));
    this.base = doc;
    this.baseVersion = version;
    this.segments = this.segments.slice(count);
    this.sealed = 0;
    for (const entry of [...this.cancelled]) if (!this.holdsRerun(entry)) this.cancelled.delete(entry);
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
   * The server no longer knows this build's actions (a newer version of the
   * app was deployed): stop sending. The unsaved edits are in the local
   * draft and are merged after the reload the student is asked for.
   */
  markOutdated() {
    if (this.status === "outdated") return;
    this.commitFields();
    this.writeDraft();
    if (this.timer) clearTimeout(this.timer);
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.timer = null;
    this.retryTimer = null;
    this.status = "outdated";
    this.emit();
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
      if (["gone", "outdated", "tooLarge", "error", "offline"].includes(this.status)) break;
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
      if (this.status === "outdated") return false;
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
    if (this.status === "outdated") return false;
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

  /** A version of the document from the server: resolve what was sent, merge local edits onto it. */
  private applyRemote(theirs: Workspace, version: number, saves?: unknown) {
    this.commitFields();
    // A read older than what this tab is based on tells nothing new.
    if (version < this.baseVersion) {
      this.emit();
      return;
    }
    this.settleHanded(theirs);
    if (this.sends.length > 0) {
      const fate = fateOfSends(
        saves,
        version,
        this.tabId,
        this.baseVersion,
        this.sends.map((s) => s.saveId),
      );
      if (fate.fate === "pending") {
        // Still at our version: a request on its way may yet land.
        this.emit();
        return;
      }
      if (fate.fate === "unknown") {
        this.resolveUncertain(theirs, version);
        return;
      }
      const sends = this.sends;
      this.sends = [];
      if (fate.fate === "landed") {
        // Its changes are the server's version B + 1: only what came after it is still ours.
        const landed = sends.find((s) => s.saveId === fate.saveId)!;
        this.retryCount = 0;
        this.acceptSaved(landed.doc, landed.count, fate.version);
      }
      // "none": the workspace moved on without any of them; everything is still ours.
    }
    if (version === this.baseVersion) {
      this.emit();
      return;
    }

    const shown = this.present;
    const prevBase = this.base;
    this.history = breakCoalescing(this.history);
    this.rev += 1;
    if (this.segments.length === 0) {
      // Share what did not change with what is on screen, so only the
      // changed parts of the editor re-render.
      const shared = shareWith(shown, theirs);
      this.base = shared.doc;
      this.present = shared.doc;
      this.baseVersion = version;
      this.sealed = 0;
      this.status = "saved";
      this.noteReplaced(prevBase, shared.doc);
      this.emit();
      if (shared.changed) this.deps.onNotice?.("updatedElsewhere");
      return;
    }

    let rebased: { doc: Workspace; segments: Segment[]; report: MergeReport } | null = null;
    let doc: Workspace | null = null;
    try {
      rebased = this.rebaseOnto(theirs, this.segments);
      doc = this.validOrRepaired(rebased.doc, rebased.report);
    } catch (error) {
      console.error("[StudyOS] could not merge with the newer version", error);
      doc = null;
    }
    if (!doc || !rebased) {
      this.raiseConflict(theirs, version);
      return;
    }
    this.adoptRebased(theirs, version, shown, doc, rebased.segments);
    this.noteReplaced(prevBase, this.base);
    if (reportHasNews(rebased.report)) this.addNotice("remote", rebased.report);
    this.emit();
    if (!sameDoc(shown, this.present)) this.deps.onNotice?.("updatedElsewhere");
  }

  /** Merging failed and could not be repaired: let the student choose (last resort). */
  private raiseConflict(theirs: Workspace, version: number) {
    this.conflict = {
      kind: "remote",
      workspace: theirs,
      version,
      discards: diff(this.base, theirs).length,
    };
    this.status = "conflict";
    this.writeDraft();
    this.emit();
  }

  /** Make `theirs` (at `version`) the base and `doc` the present document, with `segments` between them. */
  private adoptRebased(
    theirs: Workspace,
    version: number,
    shown: Workspace,
    doc: Workspace,
    segments: Segment[],
  ) {
    this.baseVersion = version;
    this.sealed = 0;
    const present = shareWith(shown, doc).doc;
    const base = shareWith(present, theirs);
    this.base = base.doc;
    if (segments.length === 0 || sameDoc(base.doc, present)) {
      // Everything unsaved is already there.
      this.present = base.doc;
      this.segments = [];
      this.clearDraft();
      this.status = "saved";
      return;
    }
    this.present = present;
    this.segments = segments;
    // The same content, sharing with what is shown.
    this.segments[0].before = base.doc;
    this.segments[this.segments.length - 1].after = present;
    this.status = "saving";
    this.writeDraft();
  }

  /**
   * The log cannot tell whether one of the saves without a reply landed (see
   * "uncertain" in the module comment). If every possibility gives the same
   * document there is nothing to decide. Otherwise the unsaved edits are
   * added back in "keep" mode, replacing nothing, and the student is told.
   */
  private resolveUncertain(theirs: Workspace, version: number) {
    const shown = this.present;
    const prevBase = this.base;
    const sends = this.sends;
    this.sends = [];
    this.history = breakCoalescing(this.history);
    this.rev += 1;
    try {
      // "None landed" replays everything; "save k landed" only what came after it.
      const counts = [...new Set([0, ...sends.map((s) => s.count)])].sort((a, b) => a - b);
      const outcomes = counts.map((count) => this.rebaseOnto(theirs, this.segments.slice(count)));
      const last = outcomes[outcomes.length - 1];
      const agree = outcomes.every((o) => sameDoc(o.doc, last.doc));
      const chosen = agree ? last : this.keepOnto(theirs, sends);
      const sent = this.segments.slice(0, counts[counts.length - 1]);
      // The same document either way does not mean the same to say: if none
      // landed, a deletion that was not repeated or a value that did not go
      // in was never anywhere but here. What "none landed" reports is said.
      const report = agree && reportHasNews(outcomes[0].report) ? outcomes[0].report : chosen.report;
      const doc = this.validOrRepaired(chosen.doc, report);
      if (!doc) {
        this.raiseConflict(theirs, version);
        return;
      }
      this.adoptRebased(theirs, version, shown, doc, chosen.segments);
      this.noteReplaced(prevBase, this.base);
      // Sent, and (whichever way) in place on the server now: watched like
      // any saved value of this tab, to say so if it changes elsewhere later.
      if (agree) this.watchOwnValues(sent);
      if (!agree) this.addNotice("unconfirmed", report, true);
      else if (reportHasNews(report)) this.addNotice("remote", report);
    } catch (error) {
      console.error("[StudyOS] could not merge with the newer version", error);
      this.raiseConflict(theirs, version);
      return;
    }
    this.emit();
    if (!sameDoc(shown, this.present)) this.deps.onNotice?.("updatedElsewhere");
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

  /**
   * Replay `segments` on `theirs`, each by its own rule: a patch as changes
   * re-applied by id ("rebase"; an undo's single values never win), a re-run
   * edit by running it again.
   */
  private rebaseOnto(
    theirs: Workspace,
    segments: readonly Segment[],
  ): { doc: Workspace; segments: Segment[]; report: MergeReport } {
    const report = emptyReport();
    const out: Segment[] = [];
    let cur = theirs;
    // What the student changed over all of them together. A change made in
    // one segment and taken back in a later one (typed, then undone) is no
    // change at all: replayed one by one on a document that moved on, the
    // first half could turn out to be nothing and the second half an edit.
    const net =
      segments.length > 1
        ? diff(segments[0].before, segments[segments.length - 1].after).map(opKey)
        : null;
    const stands = (op: Op) => {
      if (!net) return true;
      const key = opKey(op);
      // (A change inside something inserted or removed as a whole counts with it.)
      return net.some((k) => k.startsWith(key) || key.startsWith(k));
    };
    for (const seg of segments) {
      // The patch of an undo (or redo) of a re-run edit that is among these
      // segments: said by that edit being off (or on), not replayed.
      if (seg.kind === "patch" && seg.entry !== undefined && this.holdsRerun(seg.entry, segments)) continue;
      const asPatch = (yieldValues = false) =>
        applyPatch(cur, diff(seg.before, seg.after).filter(stands), {
          mode: "rebase",
          yieldValues,
          lookup: lookupIn(seg.after),
          report,
        }).doc;
      let next: Workspace;
      if (seg.kind === "patch") {
        next = asPatch(seg.undo === true);
        if (next !== cur) {
          out.push({
            kind: "patch",
            ...(seg.undo ? { undo: true, entry: seg.entry } : {}),
            before: cur,
            after: next,
          });
        }
      } else {
        const fns = this.active(seg, seg.fns);
        try {
          next = fns.length
            ? edit(cur, (d) => {
                for (const fn of fns) fn(d);
              })
            : cur;
        } catch (error) {
          // A broken re-run must not block the merge: carry its effect over
          // as plain changes instead.
          console.error("[StudyOS] an edit could not be re-run on the newer version", error);
          next = asPatch();
        }
        // Kept even when it changes nothing (all of it undone): a redo switches it on again.
        if (next !== cur || fns.length < seg.fns.length) {
          out.push({ kind: "rerun", fns: seg.fns, replays: seg.replays, entries: seg.entries, before: cur, after: next });
        }
      }
      cur = next;
    }
    return { doc: cur, segments: out, report };
  }

  /**
   * All unsaved edits on `theirs` in "keep" mode (their ancestor is not
   * known): re-run edits are run again (they are idempotent, so that is right
   * either way); everything else is ONE patch from the base to the present
   * document, so a paragraph typed in over several saves is kept as one copy
   * holding all of it. Then the same from each save that may have landed
   * (`sends`): if it did, what the student did after it (bringing back
   * something that save removed, say) is not in the first patch. "Keep" only
   * adds, so applying every possibility loses nothing and replaces nothing.
   */
  private keepOnto(
    theirs: Workspace,
    sends: readonly Sent[],
  ): { doc: Workspace; segments: Segment[]; report: MergeReport } {
    const report = emptyReport();
    const out: Segment[] = [];
    const reruns = this.segments.filter((seg) => seg.kind === "rerun");
    let cur = theirs;
    let redone = new Set<string>();
    if (reruns.length > 0) {
      try {
        const next = edit(cur, (d) => {
          for (const seg of reruns) if (seg.kind === "rerun") for (const fn of this.active(seg, seg.fns)) fn(d);
        });
        redone = this.keysOf(reruns, this.segments.filter((seg) => seg.kind === "patch"));
        if (next !== cur) {
          out.push({
            kind: "rerun",
            fns: reruns.flatMap((seg) => (seg.kind === "rerun" ? this.active(seg, seg.fns) : [])),
            replays: reruns.flatMap((seg) => (seg.kind === "rerun" ? this.active(seg, seg.replays) : [])),
            entries: reruns.flatMap((seg) => (seg.kind === "rerun" ? this.active(seg, seg.entries) : [])),
            before: cur,
            after: next,
          });
        }
        cur = next;
      } catch (error) {
        console.error("[StudyOS] an edit could not be re-run on the newer version", error);
        redone = new Set();
      }
    }
    let next = cur;
    for (const from of [this.base, ...sends.map((sent) => sent.doc)]) {
      const ops = diff(from, this.present).filter((op) => !redone.has(opKey(op)));
      next = applyPatch(next, ops, { mode: "keep", lookup: lookupIn(this.present), report }).doc;
    }
    if (next !== cur) out.push({ kind: "patch", before: cur, after: next });
    return { doc: next, segments: out, report };
  }

  private opsOf(seg: Segment): Op[] {
    const cached = this.segmentOps.get(seg);
    if (cached) return cached;
    const ops = diff(seg.before, seg.after);
    // A sent segment no longer changes.
    if (this.segments.indexOf(seg) < this.sealed) this.segmentOps.set(seg, ops);
    return ops;
  }

  /** The changes `redo` segments make that none of `others` touches too. */
  private keysOf(redo: readonly Segment[], others: readonly Segment[]): Set<string> {
    const keys = new Set<string>();
    for (const seg of redo) for (const op of this.opsOf(seg)) keys.add(opKey(op));
    for (const seg of others) for (const op of this.opsOf(seg)) keys.delete(opKey(op));
    return keys;
  }

  /** Add to the merge banner. */
  private addNotice(source: MergeNotice["source"], report: MergeReport, always = false) {
    if (!always && !reportHasNews(report)) return;
    const prev = this.merge;
    this.merge = {
      // "Could not be confirmed" is the most important thing to say; it stays.
      source: prev?.source === "unconfirmed" ? "unconfirmed" : source,
      report: prev ? addReport(prev.report, report) : report,
      replaced: prev?.replaced ?? [],
    };
  }

  /** Remember the single values (not prose) a confirmed save of this tab set. */
  private watchOwnValues(saved: readonly Segment[], handed = false) {
    const now = this.now();
    for (const seg of saved) {
      if (seg.kind !== "patch") continue;
      for (const op of diff(seg.before, seg.after)) {
        if (op.op !== "set") continue;
        if (typeof op.after === "object" && op.after !== null) continue;
        if (typeof op.after === "string" && proseLimit(seg.after, op.path) !== null) continue;
        const key = pathKey(op.path);
        this.ownValues = this.ownValues.filter((v) => pathKey(v.path) !== key);
        this.ownValues.push({ path: op.path, mine: op.after, at: now, ...(handed ? { handed: true } : {}) });
      }
    }
    this.ownValues = this.ownValues.filter((v) => now - v.at <= OWN_VALUE_WATCH_MS).slice(-OWN_VALUES_MAX);
  }

  /**
   * A newer version arrived: say which values this tab saved recently are no
   * longer in place (changed on another device after, or at the same time
   * as, this one set them), so the student is told on this device too.
   */
  private noteReplaced(prevBase: Workspace, nextBase: Workspace) {
    if (this.ownValues.length === 0) return;
    const now = this.now();
    const replaced: Overwrite[] = [];
    this.ownValues = this.ownValues.filter((v) => {
      if (now - v.at > OWN_VALUE_WATCH_MS) return false;
      const was = getAt(prevBase, v.path);
      const is = getAt(nextBase, v.path);
      if (deepEqual(was, is)) return true;
      // It is in place now (this tab's save was confirmed late, or the tab
      // that took its edits over saved them): watched from here on.
      if (deepEqual(is, v.mine)) return true;
      // Ours was in place, the thing it belongs to is still there, and it holds another value now.
      if (
        deepEqual(was, v.mine) &&
        getAt(nextBase, v.path.slice(0, -1)) !== undefined &&
        deepEqual(getAt(this.present, v.path), is)
      ) {
        replaced.push({ path: v.path, theirs: is, mine: v.mine });
      }
      return false;
    });
    if (replaced.length === 0) return;
    const prev = this.merge;
    this.merge = {
      source: prev?.source ?? "remote",
      report: prev?.report ?? emptyReport(),
      replaced: [...(prev?.replaced ?? []), ...replaced],
    };
  }

  /**
   * The first read after this tab gave its unsaved edits up to another tab
   * (`checkHandedOver`): a value typed here that the workspace does not hold
   * (the other tab did not put it in, or it was changed since) is said here,
   * with "use my values"; one that it holds is watched like any saved value.
   */
  private settleHanded(theirs: Workspace) {
    if (!this.ownValues.some((v) => v.handed)) return;
    const replaced: Overwrite[] = [];
    this.ownValues = this.ownValues.filter((v) => {
      if (!v.handed) return true;
      const is = getAt(theirs, v.path);
      if (deepEqual(is, v.mine)) {
        v.handed = false;
        return true;
      }
      const untouchedHere = deepEqual(getAt(this.present, v.path), getAt(this.base, v.path));
      if (untouchedHere && getAt(theirs, v.path.slice(0, -1)) !== undefined) {
        replaced.push({ path: v.path, theirs: is, mine: v.mine });
      }
      return false;
    });
    if (replaced.length === 0) return;
    const prev = this.merge;
    this.merge = {
      source: prev?.source ?? "remote",
      report: prev?.report ?? emptyReport(),
      replaced: [...(prev?.replaced ?? []), ...replaced],
    };
  }

  /** Cheap check (focus, visibility, polling, other-tab message). */
  checkRemote(): Promise<void> {
    if (this.paused || this.conflict) return Promise.resolve();
    return this.enqueue(async () => {
      if (this.paused || this.conflict || this.inFlight || this.status === "outdated") return;
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
          if (this.status === "outdated") return;
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
    this.cancelled.clear();
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
   * The merge banner's "use the other version": put back the values from
   * elsewhere that the student's edits replaced (an undoable step).
   */
  restoreTheirs() {
    const merge = this.merge;
    if (!merge) return;
    this.applyChoice(
      merge.report.overwritten.map((o) => ({ op: "set", path: o.path, before: o.mine, after: o.theirs })),
    );
  }

  /**
   * The merge banner's "use my values": write the student's values that were
   * not applied (a recovered draft, unconfirmed edits) or that were changed
   * elsewhere after this tab saved them, wherever the other value is still
   * in place (an undoable step).
   */
  applyMine() {
    const merge = this.merge;
    if (!merge) return;
    this.applyChoice(
      [...merge.report.unapplied, ...merge.replaced].map((o) => ({
        op: "set",
        path: o.path,
        before: o.theirs,
        after: o.mine,
      })),
    );
  }

  private applyChoice(ops: Op[]) {
    this.checkHandedOver();
    this.commitFields();
    this.merge = null;
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

  /**
   * What is left to apply if the first `count` segments are on the server
   * (0: none of them): one patch from that document to the present one.
   */
  private remaining(count: number): StoredPatch {
    const from = count === 0 ? this.base : this.segments[count - 1].after;
    const rest = this.segments.slice(count);
    const out: StoredPatch = { ops: diff(from, this.present) };
    const replayable = rest.filter((seg) => seg.kind === "rerun" && seg.replays.every((r) => r !== null));
    if (replayable.length > 0) {
      // (Without the ones that are undone at the moment.)
      out.replays = replayable.flatMap((seg) => (seg.kind === "rerun" ? (this.active(seg, seg.replays) as Replay[]) : []));
      out.replayKeys = [...this.keysOf(replayable, rest.filter((seg) => !replayable.includes(seg)))];
    }
    return out;
  }

  /** Write this tab's unsaved edits to localStorage (synchronously). */
  writeDraft() {
    const storage = this.deps.storage;
    if (!storage) return;
    this.checkHandedOver();
    const key = draftKey(this.id, this.tabId);
    if (this.segments.length === 0) {
      this.removeKey(key);
      return;
    }
    const all = this.remaining(0);
    const sends = this.sends.map((s) => ({ saveId: s.saveId, ...this.remaining(s.count) }));
    const find = lookupIn(this.present);
    const ctx: StoredDraft["ctx"] = {};
    for (const op of [...all.ops, ...sends.flatMap((s) => s.ops)]) {
      for (const { arrayPath, id } of opContainers(op)) {
        const k = `${pathKey(arrayPath)}#${id}`;
        if (k in ctx) continue;
        const found = find(arrayPath, id);
        if (found) ctx[k] = { item: restoreShell(found.item), prev: found.prev };
      }
    }
    const draft: StoredDraft = {
      v: 4,
      id: this.id,
      tabId: this.tabId,
      baseVersion: this.baseVersion,
      savedAt: this.now(),
      ...(this.editedAt > 0 ? { editedAt: this.editedAt } : {}),
      ...all,
      ...(sends.length ? { sends } : {}),
      ctx,
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
    // Values typed here are still this student's: the next read says which
    // of them the workspace does not hold (`settleHanded`), and the others
    // are watched like any saved value.
    this.watchOwnValues(this.segments, true);
    this.epoch += 1;
    this.present = this.base;
    this.segments = [];
    this.cancelled.clear();
    this.sealed = 0;
    this.sends = [];
    this.conflict = null;
    // The steps in the undo history are about edits that are no longer this
    // tab's: undoing or redoing them here would be a new edit against a
    // document the other tab is about to change.
    this.history = createHistory();
    this.rev += 1; // fields show the stored values again
    this.needsPull = true;
    if (!this.halted) this.status = "saving";
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
      const mine = draftKey(this.id, `${this.tabId}~${this.now().toString(36)}${this.claimSeq}`);
      storage.setItem(mine, raw);
      this.claimed.add(mine);
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
    // (Also the ones this tab remembers taking: a storage that cannot list its keys.)
    const keys = new Set([...this.storageKeys().filter((k) => k.startsWith(prefix)), ...this.claimed]);
    return [...keys].filter((k) => {
      try {
        return this.deps.storage?.getItem(k) != null;
      } catch {
        return false;
      }
    });
  }

  /**
   * On open: take over the edits closed (or crashed) tabs left in this
   * browser that never reached the server, and a draft in the first editor's
   * format, then merge them (see adoptOrphans).
   */
  recoverDraft() {
    const storage = this.deps.storage;
    if (!storage || this.draftChecked) return;
    this.draftChecked = true;
    this.heartbeat();
    this.sweep(this.storageKeys());
    this.claim(draftKey(this.id));
    this.adoptOrphans();
  }

  /**
   * Take over the drafts of tabs that are no longer open and merge them in.
   * Also runs periodically, so a crashed tab's edits are picked up by a tab
   * that was opened right after the crash. Taking a draft over is immediate
   * (two open tabs never both take one); the merge reads the server first
   * and settles which of the draft's saves landed (see mergeClaims). A draft
   * of a tab that is still open is left alone.
   */
  adoptOrphans() {
    if (!this.deps.storage || this.status === "outdated") return;
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

  /** The claimed draft under `key` in one shape, or null if it is not a draft. */
  private readClaim(key: string, state: RemoteState): Recovered | null {
    type AnyDraft = StoredDraft | PatchDraft | LegacyDraft | null;
    let parsed: AnyDraft;
    try {
      parsed = JSON.parse(this.deps.storage?.getItem(key) ?? "null") as AnyDraft;
    } catch {
      return null;
    }
    if (!parsed || typeof parsed !== "object") return null;
    const base =
      typeof parsed.baseVersion === "number" && Number.isInteger(parsed.baseVersion) ? parsed.baseVersion : null;
    if (parsed.v === 1) {
      const repaired = repairWorkspace(parsed.workspace, { id: this.id });
      if (!repaired) return null;
      const doc = { ...repaired.workspace, id: this.id };
      // Compared with the server's document now: what that has and the draft
      // lacks is not something the student deleted, unless nothing was saved since.
      const exact = base !== null && base === state.version;
      const ops = diff(state.workspace, doc).filter((op) => exact || op.op === "ins" || op.op === "set");
      return {
        tabId: "",
        baseVersion: base,
        all: { ops },
        sends: [],
        lookup: lookupIn(doc),
        sentUnknown: true,
        editedAt: null,
      };
    }
    if ((parsed.v !== 2 && parsed.v !== 3 && parsed.v !== 4) || !Array.isArray(parsed.ops) || base === null) return null;
    const patch = (p: StoredPatch): StoredPatch => ({
      ops: p.ops,
      ...(Array.isArray(p.replays) && Array.isArray(p.replayKeys) ? { replays: p.replays, replayKeys: p.replayKeys } : {}),
    });
    const ctx = parsed.ctx ?? {};
    const sends = (Array.isArray(parsed.sends) ? (parsed.sends as Array<{ saveId: string } & StoredPatch>) : [])
      .filter((s) => s && typeof s.saveId === "string" && Array.isArray(s.ops))
      .map((s) => ({ saveId: s.saveId, rest: patch(s) }));
    return {
      tabId: String(parsed.tabId ?? ""),
      baseVersion: base,
      all: patch(parsed as StoredPatch),
      sends,
      lookup: (arrayPath, id) => ctx[`${pathKey(arrayPath)}#${id}`],
      // The second engine did not record its saves at all.
      sentUnknown: parsed.v === 2,
      editedAt: parsed.v === 4 && typeof parsed.editedAt === "number" ? parsed.editedAt : null,
    };
  }

  /**
   * How a recovered draft is merged, given a read of the server:
   *  - "wait": it is based on a version this read does not have yet;
   *  - "fence": it has saves without a reply and the server is still at their
   *    version: one of them may yet land (see mergeClaims);
   *  - otherwise what to apply and how: "recover" when it is certain which of
   *    its changes the server already has, "keep" when it is not. `sameVersion`:
   *    nothing was saved since the version that patch starts from.
   */
  private planRecovered(
    rec: Recovered,
    state: RemoteState,
  ): "wait" | "fence" | { patch: StoredPatch; mode: "recover" | "keep"; also?: StoredPatch[]; sameVersion?: boolean } {
    if (rec.baseVersion === null) return { patch: rec.all, mode: "keep" };
    if (rec.baseVersion > state.version) return "wait";
    // (A save of this tab that changed nothing does not count as "saved since".)
    const same = (version: number) =>
      version === state.version ||
      (this.fenced !== null && this.fenced.to === state.version && this.fenced.from === version);
    if (rec.sentUnknown) {
      // Nothing was saved since its version, so nothing of it was either.
      return rec.baseVersion === state.version
        ? { patch: rec.all, mode: "recover", sameVersion: true }
        : { patch: rec.all, mode: "keep" };
    }
    // The log knows a later save of that tab than this draft does (its last
    // draft writes failed: storage full): the draft is not that tab's last
    // word, and which of its changes are saved cannot be told from it.
    const last = isSaveLog(state.saves) ? state.saves.tabs[rec.tabId] : undefined;
    if (last && last[1] > rec.baseVersion && !rec.sends.some((s) => s.saveId === last[0])) {
      return { patch: rec.all, mode: "keep", also: rec.sends.map((s) => s.rest) };
    }
    const fate = fateOfSends(
      state.saves,
      state.version,
      rec.tabId,
      rec.baseVersion,
      rec.sends.map((s) => s.saveId),
    );
    if (fate.fate === "pending") return "fence";
    if (fate.fate === "none") return { patch: rec.all, mode: "recover", sameVersion: same(rec.baseVersion) };
    if (fate.fate === "landed") {
      const landed = rec.sends.find((s) => s.saveId === fate.saveId)!;
      return { patch: landed.rest, mode: "recover", sameVersion: same(fate.version) };
    }
    // Unknown: nothing to decide if every possibility gives the same document.
    const outcomes = [rec.all, ...rec.sends.map((s) => s.rest)].map(
      (patch) => this.applyStored(this.present, patch, "recover", rec.lookup, emptyReport()).doc,
    );
    const agree = outcomes.every((doc) => sameDoc(doc, outcomes[0]));
    // Then the whole patch is merged (as if none landed): the same document,
    // and whatever of it did not go in (a value that collides, a deletion not
    // repeated) is said; if none landed it was never anywhere but in the draft.
    // Otherwise every possibility is applied in "keep" mode (it only adds).
    return agree
      ? { patch: rec.all, mode: "recover" }
      : { patch: rec.all, mode: "keep", also: rec.sends.map((s) => s.rest) };
  }

  /**
   * `doc` with a stored patch applied in `mode`. Its re-run edits are run
   * again when every one of them can be (and then not applied as changes
   * too); otherwise all of it is applied as changes. `rerun` is what was
   * re-run and the document after it, before the other changes.
   */
  private applyStored(
    doc: Workspace,
    patch: StoredPatch,
    mode: ApplyMode,
    lookup: Lookup,
    report: MergeReport,
    asLeft = false,
  ): { doc: Workspace; rerun: { fns: Mutator[]; replays: Replay[]; after: Workspace } | null } {
    const replays = patch.replays ?? [];
    const fns = replays.map((r) => {
      try {
        return this.deps.replayers?.[r?.name]?.(r.args) ?? null;
      } catch {
        return null;
      }
    });
    let cur = doc;
    let ops = patch.ops;
    let rerun: { fns: Mutator[]; replays: Replay[]; after: Workspace } | null = null;
    if (fns.length > 0 && fns.every((fn) => fn !== null) && Array.isArray(patch.replayKeys)) {
      try {
        const all = fns as Mutator[];
        cur = edit(doc, (d) => {
          for (const fn of all) fn(d);
        });
        const redone = new Set(patch.replayKeys);
        ops = ops.filter((op) => !redone.has(opKey(op)));
        rerun = { fns: all, replays, after: cur };
      } catch (error) {
        console.error("[StudyOS] a recovered edit could not be re-run", error);
        cur = doc;
        ops = patch.ops;
      }
    }
    return { doc: applyPatch(cur, ops, { mode, lookup, report, asLeft }).doc, rerun };
  }

  /**
   * Merge the drafts this tab took over. Reads the server first and brings
   * this tab's own edits onto that version; then, per draft, settles which of
   * its changes the server already has (`planRecovered`) and merges the rest
   * as one undoable step, announced with a notice. A draft whose saves may
   * still land is not merged yet: this tab saves once on the same version
   * (even with nothing to save), which the compare-and-swap lets through
   * only if none of them landed, and then reads again.
   */
  private async mergeClaims(): Promise<void> {
    const storage = this.deps.storage;
    if (!storage) return;
    for (let round = 0; round < 3; round += 1) {
      const keys = this.claimKeys();
      if (keys.length === 0 || this.paused || this.conflict || this.status === "outdated") return;
      let state: RemoteState | null;
      try {
        state = await this.deps.fetchState(this.id);
      } catch {
        return; // offline: tried again at the next periodic check
      }
      if (!state) return;
      // Our own unsaved edits first, onto the latest version.
      if (!this.receive(state) || this.conflict) return;
      if (state.version !== this.baseVersion) return; // our own saves are unsettled: next time

      const report = emptyReport();
      let restored = false;
      let unconfirmed = false;
      let fence = false;
      // Is the workspace as a dead tab left it? Nothing saved since (the
      // plan says), this tab has nothing of its own, and nobody edited in
      // this browser after that tab's last edit.
      const pristine = this.segments.length === 0;
      const lastEdit = this.lastEditHere();
      for (const key of keys) {
        const rec = this.readClaim(key, state);
        if (!rec) {
          this.removeKey(key);
          continue;
        }
        const plan = this.planRecovered(rec, state);
        if (plan === "wait") continue;
        if (plan === "fence") {
          fence = true;
          continue;
        }
        const asLeft =
          plan.mode === "recover" &&
          plan.sameVersion === true &&
          pristine &&
          rec.editedAt !== null &&
          lastEdit !== null &&
          lastEdit <= rec.editedAt;
        const result = this.mergeIn(plan.patch, plan.mode, rec.lookup, report, !restored, plan.also, asLeft);
        if (result === "invalid") continue; // kept, tried again later
        if (result === "merged") {
          restored = true;
          if (plan.mode === "keep") unconfirmed = true;
          // Should this tab die too, its draft carries those edits on.
          this.editedAt = Math.max(this.editedAt, rec.editedAt ?? 0);
        }
        this.removeKey(key);
      }
      if (restored) {
        this.writeDraft();
        this.addNotice(unconfirmed ? "unconfirmed" : "draft", report, unconfirmed);
        this.emit();
        this.deps.onNotice?.("draftRestored");
      }
      if (!fence) return;
      const from = this.baseVersion;
      const unchanged = this.segments.length === 0;
      await this.saveStep(true);
      if (unchanged && this.ownSave === from + 1 && this.baseVersion === from + 1) {
        this.fenced = { from, to: from + 1 };
      }
      // Not settled (offline, a lost reply): the drafts stay claimed, tried again later.
      if (this.status === "error" || this.status === "offline" || this.halted) return;
    }
  }

  /** When the student last edited this workspace in this browser; null if that is not known. */
  private lastEditHere(): number | null {
    try {
      const raw = this.deps.storage?.getItem(editedKey(this.id));
      if (raw == null) return null;
      const at = Number(raw);
      return Number.isFinite(at) ? at : null;
    } catch {
      return null;
    }
  }

  /** Merge a draft's changes into the present document (one undo step). */
  private mergeIn(
    patch: StoredPatch,
    mode: "recover" | "keep",
    lookup: Lookup,
    report: MergeReport,
    commitFieldsFirst: boolean,
    also: readonly StoredPatch[] = [],
    asLeft = false,
  ): "merged" | "nothing" | "invalid" {
    /** `patch`, then (uncertain drafts) what would remain after each of its saves. */
    const run = (into: MergeReport) => {
      const first = this.applyStored(this.present, patch, mode, lookup, into, asLeft);
      let doc = first.doc;
      for (const more of also) {
        const redone = new Set(first.rerun ? (more.replayKeys ?? []) : []);
        const ops = more.ops.filter((op) => !redone.has(opKey(op)));
        doc = applyPatch(doc, ops, { mode, lookup, report: into }).doc;
      }
      return { doc, rerun: first.rerun };
    };
    const probe = emptyReport();
    const tried = run(probe).doc;
    if (sameDoc(this.present, tried) && !reportHasNews(probe)) return "nothing";
    if (commitFieldsFirst) this.commitFields();
    const local = emptyReport();
    const applied = run(local);
    const valid = this.validOrRepaired(applied.doc, local);
    if (!valid) return "invalid";
    Object.assign(report, addReport(report, local));
    const prev = this.present;
    if (sameDoc(prev, valid)) return "merged";
    this.rev += 1;
    // What was re-run stays a re-run edit of this tab (it is re-run again if
    // the document changes elsewhere before it is saved); the rest is a patch.
    const mid = applied.rerun && valid === applied.doc ? applied.rerun.after : prev;
    if (applied.rerun && mid !== prev) {
      applied.rerun.fns.forEach((fn, i) => {
        this.addSegment(i === 0 ? prev : mid, mid, { fn, replay: applied.rerun!.replays[i] });
      });
    }
    this.present = valid;
    if (valid !== mid) this.addSegment(mid, valid);
    this.history = record(this.history, {
      before: prev,
      after: valid,
      ops: diff(prev, valid),
      now: this.now(),
    }).history;
    this.markDirty();
    return "merged";
  }

  /** (Re)start after mount: mark the tab alive and recover drafts once. */
  start() {
    this.disposed = false;
    this.heartbeat();
    this.recoverDraft();
  }

  /**
   * The tab is being hidden or closed: write buffered typing and the local
   * draft synchronously (the page may be frozen or gone right after), then
   * start a save. Nothing else is sent: if the save does not finish, the
   * edits are in this browser's draft and are merged the next time the
   * workspace is opened here. Returns true when nothing is unsaved.
   */
  prepareToLeave(): boolean {
    this.checkHandedOver();
    this.commitFields();
    this.writeDraft();
    if (this.segments.length === 0 && !this.inFlight) return true;
    void this.flush();
    return false;
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
