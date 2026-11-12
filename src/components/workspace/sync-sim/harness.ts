/**
 * Test helper for sync-sim.test.ts: editor tabs (the real WorkspaceSync)
 * against a "server" that is the app's real store.ts and version-service.ts
 * on an in-memory Prisma (vi.mock of @/lib/db in the test). Everything that
 * crosses the network is JSON round-tripped, and the network can lose
 * replies, fail saves and fail reads. Time is vitest's fake clock.
 */
import { vi } from "vitest";
import { prisma as client } from "@/lib/db";
import * as store from "@/lib/workspace/store";
import * as vs from "@/lib/workspace/version-service";
import { InvalidWorkspaceError, WorkspaceTooLargeError } from "@/lib/workspace/repair";
import type { Workspace } from "@/lib/workspace/types";
import { WorkspaceSync, type SaveResult, type SyncDeps } from "../workspace-sync";
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

const liveTabs: WorkspaceSync[] = [];

export class Server {
  readonly id: string;
  /** The next save commits but its reply is lost (count). */
  dropReplies = 0;
  /** Saves that fail before reaching the server (count). */
  failSaves = 0;
  /** Reads that fail (count). */
  failFetch = 0;
  /** Print every request (debugging one history). */
  trace = false;

  constructor(initial: Workspace) {
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
      version: 1,
      deletedAt: null,
    });
  }

  private get row() {
    const row = db.workspace.rows.find((r) => r.id === this.id);
    if (!row) throw new Error("no workspace row");
    return row as { name: string; data: string; version: number };
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

  // The three server actions the editor uses (app/app/actions.ts), over JSON.
  save = async (id: string, ws: Workspace, baseVersion: number, saveId?: string): Promise<SaveResult> => {
    const say = (what: string) => {
      if (!this.trace) return;
      const texts = ws.pages[0]?.blocks.map((b) => `${b.id}:${(b as { text?: string }).text ?? ""}`);
      console.info(`SAVE t=${Date.now() % 1e6} base=${baseVersion} id=${saveId?.slice(0, 6)} ${what} ${JSON.stringify(texts)}`);
    };
    if (this.failSaves > 0) {
      this.failSaves -= 1;
      say("-> request failed");
      throw new Error("network: request failed");
    }
    let result: SaveResult;
    try {
      result = json(await store.saveWorkspace(id, json(ws), baseVersion, saveId));
    } catch (error) {
      if (error instanceof WorkspaceTooLargeError) return { status: "too_large" };
      if (error instanceof InvalidWorkspaceError) return { status: "invalid" };
      throw error;
    }
    const lost = result.status === "saved" && this.dropReplies > 0;
    say(`-> ${result.status} ${"version" in result ? result.version : ""}${lost ? " (reply lost)" : ""}`);
    if (lost) {
      this.dropReplies -= 1;
      throw new Error("network: reply lost");
    }
    return result;
  };

  fetchState = async (id: string) => {
    if (this.trace) console.info(`FETCH t=${Date.now() % 1e6} ${this.failFetch > 0 ? "fails" : `v${this.version}`}`);
    if (this.failFetch > 0) {
      this.failFetch -= 1;
      throw new Error("network: read failed");
    }
    return json(await store.getWorkspaceState(id));
  };

  fetchVersion = async (id: string) => json(await store.getWorkspaceVersion(id));

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

export function openTab(
  server: Server,
  opts: { storage?: MemoryStorage; tabId?: string; deps?: Partial<SyncDeps> } = {},
): WorkspaceSync {
  const sync = new WorkspaceSync(server.id, server.doc(), server.version, {
    save: server.save,
    fetchState: server.fetchState,
    fetchVersion: server.fetchVersion,
    storage: opts.storage ?? new MemoryStorage(),
    tabId: opts.tabId,
    ...opts.deps,
  });
  sync.start();
  liveTabs.push(sync);
  return sync;
}

/**
 * A tab that dies (crash, killed in the background): no more timers, no
 * goodbye. With `closed`, a normal close: it says goodbye (`releaseTab`).
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
