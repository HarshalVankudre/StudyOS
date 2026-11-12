/**
 * Test helper for the sync tests: editor tabs (the real WorkspaceSync) against
 * a "server" that is the app's real store.ts and version-service.ts on an
 * in-memory Prisma (vi.mock of @/lib/db in the test). Everything that crosses
 * the network is JSON round-tripped. Time is vitest's fake clock.
 *
 * What can go wrong on the way, per tab (`Net`) or for everyone (`Server`):
 * a reply lost after the save landed, a request that never arrives, a tab
 * offline, a request frozen on its way (it arrives when released), and a
 * request handled by an instance of an OLDER build during a rolling deploy
 * (one that does not keep the save log, or keeps the previous format).
 */
import { vi } from "vitest";
import { prisma as client } from "@/lib/db";
import * as store from "@/lib/workspace/store";
import * as vs from "@/lib/workspace/version-service";
import { InvalidWorkspaceError, WorkspaceTooLargeError, prepareWorkspaceForSave } from "@/lib/workspace/repair";
import type { Workspace } from "@/lib/workspace/types";
import {
  WorkspaceSync,
  type MergeNotice,
  type Notice,
  type RemoteState,
  type SaveResult,
  type SyncDeps,
} from "../workspace-sync";
import type { MemoryPrisma } from "./memory-prisma";

/** The in-memory database the test put in place of Prisma. */
export const db = client as unknown as MemoryPrisma;

export const advance = (ms: number) => vi.advanceTimersByTimeAsync(ms);
export const drain = () => advance(120_000);

const json = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

export class MemoryStorage {
  data = new Map<string, string>();
  getItem(k: string) {
    return this.data.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.data.set(k, String(v));
  }
  removeItem(k: string) {
    this.data.delete(k);
  }
  key(i: number) {
    return [...this.data.keys()][i] ?? null;
  }
  get length() {
    return this.data.size;
  }
}

/**
 * Which build handles a request:
 *  - "current": this code;
 *  - "round3": the previous build (it records save ids in its own format and
 *    knows nothing of the current log);
 *  - "noLog": a build from before save ids (it only bumps the version).
 */
export type Build = "current" | "round3" | "noLog";

/** One tab's connection. */
export interface Net {
  offline: boolean;
  /** Saves that land although their reply is lost (count). */
  dropReplies: number;
  /** While set, this tab's requests wait here (a frozen tab, a stalled connection). */
  frozen: Promise<void> | null;
  release: (() => void) | null;
  /** The build that handles this tab's next saves / reads. */
  saveBuild: Build;
  readBuild: Build;
}

export function newNet(): Net {
  return { offline: false, dropReplies: 0, frozen: null, release: null, saveBuild: "current", readBuild: "current" };
}

export function freeze(net: Net) {
  if (net.frozen) return;
  net.frozen = new Promise<void>((resolve) => {
    net.release = resolve;
  });
}

export function thaw(net: Net) {
  net.release?.();
  net.frozen = null;
  net.release = null;
}

const liveTabs: WorkspaceSync[] = [];

export class Server {
  readonly id: string;
  /** The next save commits but its reply is lost (count; any tab). */
  dropReplies = 0;
  /** Saves that fail before reaching the server (count). */
  failSaves = 0;
  /** Reads that fail (count). */
  failFetch = 0;
  /** Print every request (debugging one history). */
  trace = false;
  /** Every request, for assertions about what was (not) sent. */
  log: string[] = [];
  /** The tab whose save is being handled right now ("" for any other writer). */
  writer = "";

  constructor(initial: Workspace, version = 1) {
    // A fresh world: tabs of the previous history must not write into this one.
    vi.clearAllTimers();
    for (const tab of liveTabs.splice(0)) crash(tab);
    this.id = initial.id;
    db.workspace.rows.splice(0, Infinity);
    db.workspaceChange.rows.splice(0, Infinity);
    db.workspace.rows.push({
      id: initial.id,
      ownerId: "u1",
      name: initial.name,
      icon: initial.icon ?? null,
      data: JSON.stringify(initial),
      saveIds: "",
      version,
      deletedAt: null,
    });
  }

  get row() {
    const row = db.workspace.rows.find((r) => r.id === this.id);
    if (!row) throw new Error("no workspace row");
    return row as { name: string; data: string; version: number; saveIds: string };
  }

  get version(): number {
    return this.row.version;
  }

  /** The stored document, as the editor would load it. */
  doc(): Workspace {
    const doc = store.parseStoredWorkspace({ id: this.id, name: this.row.name, data: this.row.data });
    if (!doc) throw new Error("stored document unreadable");
    return doc;
  }

  /** A save handled by an instance of an older build (see `Build`). */
  private async saveOld(build: Build, ws: Workspace, baseVersion: number, saveId?: string): Promise<SaveResult> {
    const { data } = prepareWorkspaceForSave(json(ws), this.id);
    const row = this.row;
    if (row.version !== baseVersion) return { status: "conflict", version: row.version };
    const patch: Record<string, unknown> = { data, version: { increment: 1 } };
    if (build === "round3" && saveId) {
      // That build's log: { t: through, s: [[saveId, version], ...] }.
      let old: { t?: number; s?: Array<[string, number]> } = {};
      try {
        old = JSON.parse(row.saveIds || "{}") as typeof old;
      } catch {
        old = {};
      }
      patch.saveIds = JSON.stringify({ t: old.t ?? 0, s: [...(Array.isArray(old.s) ? old.s : []), [saveId, baseVersion + 1]] });
    }
    const updated = await db.workspace.updateMany({ where: { id: this.id, version: baseVersion }, data: patch });
    return updated.count === 1 ? { status: "saved", version: baseVersion + 1 } : { status: "conflict", version: this.row.version };
  }

  /** The save action (app/app/actions.ts), over JSON, for a tab on `net`. */
  saveVia(net: Net | null) {
    return async (id: string, ws: Workspace, baseVersion: number, saveId?: string, tabId?: string): Promise<SaveResult> => {
      const say = (what: string) => {
        this.log.push(`save base=${baseVersion} tab=${tabId} ${what}`);
        if (!this.trace) return;
        const texts = ws.pages[0]?.blocks.map((b) => `${b.id}:${(b as { text?: string }).text ?? ""}`);
        console.info(`SAVE t=${Date.now() % 1e7} base=${baseVersion} tab=${tabId} ${what} ${JSON.stringify(texts)}`);
      };
      const body = json(ws); // what left the tab when it was sent
      while (net?.frozen) await net.frozen;
      if (net?.offline || this.failSaves > 0) {
        if (!net?.offline) this.failSaves -= 1;
        say("-> request failed");
        throw new Error("network: request failed");
      }
      const build = net?.saveBuild ?? "current";
      let result: SaveResult;
      this.writer = tabId ?? "";
      try {
        result =
          build === "current"
            ? json(await store.saveWorkspace(id, body, baseVersion, saveId, tabId))
            : await this.saveOld(build, body, baseVersion, saveId);
      } catch (error) {
        if (error instanceof WorkspaceTooLargeError) return { status: "too_large" };
        if (error instanceof InvalidWorkspaceError) return { status: "invalid" };
        throw error;
      } finally {
        this.writer = "";
      }
      const lost = result.status === "saved" && ((net?.dropReplies ?? 0) > 0 || this.dropReplies > 0);
      say(`-> ${result.status} ${"version" in result ? result.version : ""}${lost ? " (reply lost)" : ""}`);
      if (lost) {
        if (net && net.dropReplies > 0) net.dropReplies -= 1;
        else this.dropReplies -= 1;
        throw new Error("network: reply lost");
      }
      return result;
    };
  }

  fetchStateVia(net: Net | null) {
    return async (id: string): Promise<RemoteState | null> => {
      while (net?.frozen) await net.frozen;
      if (this.trace) console.info(`FETCH t=${Date.now() % 1e7} ${this.failFetch > 0 ? "fails" : `v${this.version}`}`);
      if (net?.offline || this.failFetch > 0) {
        if (!net?.offline) this.failFetch -= 1;
        throw new Error("network: read failed");
      }
      const state = json(await store.getWorkspaceState(id)) as RemoteState | null;
      const build = net?.readBuild ?? "current";
      if (state && build === "noLog") delete state.saves;
      if (state && build === "round3") {
        // That build parses the column as its own format: an empty log of its kind.
        let old: { t?: number; s?: unknown[] } = {};
        try {
          old = JSON.parse(this.row.saveIds || "{}") as typeof old;
        } catch {
          old = {};
        }
        state.saves = { through: old.t ?? 0, ids: Array.isArray(old.s) ? old.s : [] };
      }
      return state;
    };
  }

  fetchVersionVia(net: Net | null) {
    return async (id: string): Promise<number | null> => {
      while (net?.frozen) await net.frozen;
      if (net?.offline) throw new Error("network: read failed");
      return json(await store.getWorkspaceVersion(id));
    };
  }

  // The three server actions without a per-tab connection.
  save = this.saveVia(null);
  fetchState = this.fetchStateVia(null);
  fetchVersion = this.fetchVersionVia(null);

  /** A server-side writer (the Today check-off, a feed sync on the server): read, edit, version-checked save. */
  async write(change: (d: Workspace) => void) {
    const result = await store.updateWorkspaceWith(this.id, (d) => {
      change(d);
      return { changed: true, result: null };
    });
    if (result.status !== "saved") throw new Error(`write failed: ${result.status}`);
  }

  /** The AI agent: start from the current snapshot; apply its result later. */
  async agentStart() {
    const snap = await vs.getWorkspaceSnapshot(this.id);
    if (!snap) throw new Error("no snapshot");
    const base = json(snap.workspace);
    return {
      base,
      baseVersion: snap.version,
      apply: (change: (d: Workspace) => void) => {
        const result = structuredClone(base);
        change(result);
        return vs.applyAgentWorkspaceChange(this.id, snap.version, json(result), base);
      },
    };
  }
}

/** A tab with what it told the student. */
export interface Tab extends WorkspaceSync {
  notices: Notice[];
  /** Entry ids of the Undo toasts for removals. */
  removals: number[];
  /** Every merge banner this tab showed, when it appeared. */
  banners: Array<{ at: number; merge: MergeNotice }>;
  net: Net;
}

/** Tab ids the server records (a save-id token); short names are padded. */
export function tabName(name: string): string {
  return name.length >= 8 ? name : `tab-${name}`.padEnd(8, "0");
}

export function openTab(
  server: Server,
  opts: { storage?: MemoryStorage; tabId?: string; deps?: Partial<SyncDeps>; net?: Net; start?: boolean } = {},
): Tab {
  const net = opts.net ?? newNet();
  const notices: Notice[] = [];
  const removals: number[] = [];
  const banners: Tab["banners"] = [];
  const sync = new WorkspaceSync(server.id, server.doc(), server.version, {
    save: server.saveVia(net),
    fetchState: server.fetchStateVia(net),
    fetchVersion: server.fetchVersionVia(net),
    storage: opts.storage ?? new MemoryStorage(),
    tabId: opts.tabId ? tabName(opts.tabId) : undefined,
    onNotice: (n) => notices.push(n),
    onRemoval: (_r, id) => removals.push(id),
    ...opts.deps,
  });
  let shown: MergeNotice | null = null;
  sync.subscribe(() => {
    const merge = sync.getSnapshot().merge;
    if (merge && merge !== shown) banners.push({ at: Date.now(), merge });
    shown = merge;
  });
  if (opts.start !== false) sync.start();
  liveTabs.push(sync);
  return Object.assign(sync, { notices, removals, banners, net }) as Tab;
}

/**
 * A tab that dies (crash, killed in the background): no more timers, no
 * goodbye, nothing more is sent. A request it already sent still arrives if
 * the network delivers it (a frozen `Net` that is thawed later). With
 * `closed`, a normal close: it says goodbye (`releaseTab`).
 */
export function crash(tab: WorkspaceSync, closed = false) {
  const t = tab as unknown as Record<string, unknown>;
  for (const key of ["timer", "retryTimer"]) {
    if (t[key]) clearTimeout(t[key] as ReturnType<typeof setTimeout>);
    t[key] = null;
  }
  tab.flush = () => Promise.resolve();
  tab.writeDraft = () => {};
  tab.checkRemote = () => Promise.resolve();
  tab.adoptOrphans = () => {};
  tab.prepareToLeave = () => false;
  tab.heartbeat = () => {};
  const deps = t.deps as SyncDeps;
  const never = () => new Promise<never>(() => {});
  t.deps = { ...deps, save: never, fetchState: never, fetchVersion: never };
  t.disposed = true;
  if (closed) tab.releaseTab();
}
