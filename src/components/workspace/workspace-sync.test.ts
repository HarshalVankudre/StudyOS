import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Workspace } from "@/lib/workspace/types";
import { MAX_WORKSPACE_BYTES } from "@/lib/workspace/repair";
import {
  SAVE_DEBOUNCE_MS,
  WorkspaceSync,
  draftKey,
  type SaveResult,
  type SyncDeps,
} from "./workspace-sync";

function ws(name = "W"): Workspace {
  return {
    id: "w1",
    name,
    pages: [
      { id: "p1", title: "Home", blocks: [{ id: "b1", type: "paragraph", text: "hi" }] },
      { id: "p2", title: "Notes", blocks: [] },
    ],
    databases: [],
  };
}

class MemoryStorage {
  data = new Map<string, string>();
  getItem(k: string) {
    return this.data.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.data.set(k, v);
  }
  removeItem(k: string) {
    this.data.delete(k);
  }
}

/** A fake server holding one workspace row with a version. */
function fakeServer(initial: Workspace, version = 1) {
  const server = { workspace: initial, version };
  const save = vi.fn(async (_id: string, w: Workspace, base: number): Promise<SaveResult> => {
    if (base !== server.version) return { status: "conflict", version: server.version };
    server.workspace = structuredClone(w);
    server.version += 1;
    return { status: "saved", version: server.version };
  });
  const fetchState = vi.fn(async () => ({
    workspace: structuredClone(server.workspace),
    version: server.version,
  }));
  const fetchVersion = vi.fn(async () => server.version);
  return { server, save, fetchState, fetchVersion };
}

function setup(overrides: Partial<SyncDeps> = {}, initial = ws(), version = 1) {
  const fake = fakeServer(structuredClone(initial), version);
  const storage = new MemoryStorage();
  const onNotice = vi.fn();
  const onRemoval = vi.fn();
  const sync = new WorkspaceSync("w1", structuredClone(initial), version, {
    save: fake.save,
    fetchState: fake.fetchState,
    fetchVersion: fake.fetchVersion,
    storage,
    onNotice,
    onRemoval,
    ...overrides,
  });
  return { sync, ...fake, storage, onNotice, onRemoval };
}

async function settle() {
  await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS + 10);
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("WorkspaceSync autosave", () => {
  it("debounces edits into one version-checked save", async () => {
    const { sync, save, server } = setup();
    sync.update((d) => (d.name = "A"));
    sync.update((d) => (d.name = "AB"));
    expect(sync.getSnapshot().status).toBe("saving");
    await settle();
    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0][2]).toBe(1);
    expect(server.workspace.name).toBe("AB");
    expect(sync.getSnapshot().status).toBe("saved");
    expect(sync.version).toBe(2);
  });

  it("keeps unsaved edits in local storage until the server confirms them", async () => {
    let release: (r: SaveResult) => void = () => {};
    const save = vi.fn(
      () => new Promise<SaveResult>((resolve) => (release = resolve)),
    );
    const { sync, storage } = setup({ save });
    sync.update((d) => (d.name = "draft"));
    sync.writeDraft(); // what a tab close / hide does
    expect(JSON.parse(storage.getItem(draftKey("w1"))!).workspace.name).toBe("draft");
    await settle();
    release({ status: "saved", version: 2 });
    await vi.runOnlyPendingTimersAsync();
    expect(storage.getItem(draftKey("w1"))).toBeNull();
  });

  it("rejects a stale-version save and surfaces a conflict instead of overwriting", async () => {
    const { sync, server, save } = setup();
    // Another tab saves first.
    server.workspace = ws("From other tab");
    server.version = 2;
    sync.update((d) => (d.name = "Mine"));
    await settle();

    expect(save).toHaveBeenCalledTimes(1);
    expect(server.workspace.name).toBe("From other tab"); // not overwritten
    const snap = sync.getSnapshot();
    expect(snap.status).toBe("conflict");
    expect(snap.conflict).toMatchObject({ kind: "remote", version: 2 });
    expect(snap.workspace.name).toBe("Mine"); // local work still on screen
  });

  it("conflict: keep mine saves over the newer version on purpose", async () => {
    const { sync, server } = setup();
    server.version = 2;
    sync.update((d) => (d.name = "Mine"));
    await settle();
    sync.resolveConflict("mine");
    await vi.runOnlyPendingTimersAsync();
    expect(server.workspace.name).toBe("Mine");
    expect(server.version).toBe(3);
    expect(sync.getSnapshot().status).toBe("saved");
  });

  it("conflict: load latest replaces local, and Undo brings mine back", async () => {
    const { sync, server } = setup();
    server.workspace = ws("Theirs");
    server.version = 2;
    sync.update((d) => (d.name = "Mine"));
    await settle();
    sync.resolveConflict("theirs");
    expect(sync.workspace.name).toBe("Theirs");
    expect(sync.getSnapshot().status).toBe("saved");
    sync.undo();
    expect(sync.workspace.name).toBe("Mine");
  });

  it("with no unsaved edits, a newer version is loaded and announced", async () => {
    const { sync, server, onNotice } = setup();
    server.workspace = ws("Newer");
    server.version = 5;
    await sync.checkRemote();
    expect(sync.workspace.name).toBe("Newer");
    expect(sync.version).toBe(5);
    expect(sync.getSnapshot().rev).toBe(1);
    expect(onNotice).toHaveBeenCalledWith("updatedElsewhere");
  });

  it("shows a retryable error when the network fails, then saves on retry", async () => {
    const fake = fakeServer(ws());
    let fail = true;
    const save = vi.fn(async (id: string, w: Workspace, base: number) => {
      if (fail) throw new Error("network");
      return fake.save(id, w, base);
    });
    const { sync } = setup({ save });
    sync.update((d) => (d.name = "x"));
    await settle();
    expect(sync.getSnapshot().status).toBe("error");
    fail = false;
    sync.retry();
    await vi.runOnlyPendingTimersAsync();
    expect(sync.getSnapshot().status).toBe("saved");
  });

  it("marks oversized documents instead of sending them", async () => {
    const { sync, save } = setup();
    sync.update((d) => (d.pages[0].title = "x".repeat(MAX_WORKSPACE_BYTES)));
    await settle();
    expect(save).not.toHaveBeenCalled();
    expect(sync.getSnapshot().status).toBe("tooLarge");
  });

  it("stops when the workspace was trashed elsewhere", async () => {
    const { sync } = setup({ save: vi.fn(async () => ({ status: "not_found" }) as SaveResult) });
    sync.update((d) => (d.name = "x"));
    await settle();
    expect(sync.getSnapshot().status).toBe("gone");
  });
});

describe("WorkspaceSync history", () => {
  it("undo/redo restore exact states and are saved", async () => {
    const initial = ws();
    const { sync, server } = setup({}, initial);
    sync.update((d) => d.pages.pop());
    const afterDelete = structuredClone(sync.workspace);
    sync.undo();
    expect(sync.workspace).toEqual(initial);
    sync.redo();
    expect(sync.workspace).toEqual(afterDelete);
    sync.undo();
    await settle();
    expect(server.workspace).toEqual(initial);
  });

  it("reports removals with the step id the Undo toast should revert", () => {
    const { sync, onRemoval } = setup();
    sync.update((d) => d.pages.splice(1, 1));
    expect(onRemoval).toHaveBeenCalledTimes(1);
    const [removal, entryId] = onRemoval.mock.calls[0];
    expect(removal).toMatchObject({ kind: "page", name: "Notes" });
    sync.update((d) => (d.name = "later edit"));
    expect(sync.undoTo(entryId)).toBe(true);
    expect(sync.workspace.pages.map((p) => p.id)).toEqual(["p1", "p2"]);
    // The later edit is not lost: it is on the redo stack.
    expect(sync.getSnapshot().canRedo).toBe(true);
  });
});

describe("WorkspaceSync and the AI agent", () => {
  it("pauses saving while the agent works and replays edits on its result", async () => {
    const { sync, server, save } = setup();
    sync.setAgentBusy(true);
    sync.update((d) => (d.pages[0].title = "Typed during agent"));
    await settle();
    expect(save).not.toHaveBeenCalled();

    // The agent commits its change server-side.
    server.workspace = {
      ...structuredClone(server.workspace),
      pages: [...server.workspace.pages, { id: "p3", title: "Agent page", blocks: [] }],
    };
    server.version = 2;

    sync.setAgentBusy(false);
    await vi.runOnlyPendingTimersAsync();
    await vi.runOnlyPendingTimersAsync();

    expect(sync.workspace.pages.map((p) => p.title)).toEqual([
      "Typed during agent",
      "Notes",
      "Agent page",
    ]);
    expect(server.workspace.pages.map((p) => p.title)).toEqual([
      "Typed during agent",
      "Notes",
      "Agent page",
    ]);
    expect(save.mock.calls.at(-1)?.[2]).toBe(2);
  });

  it("loads the agent's result when nothing was typed meanwhile", async () => {
    const { sync, server, save } = setup();
    server.workspace = ws("Agent renamed");
    server.version = 2;
    await sync.resync();
    expect(sync.workspace.name).toBe("Agent renamed");
    expect(sync.version).toBe(2);
    expect(save).not.toHaveBeenCalled();
  });
});

describe("WorkspaceSync draft recovery", () => {
  it("restores edits left on this device when they match the loaded version", async () => {
    const storage = new MemoryStorage();
    storage.setItem(
      draftKey("w1"),
      JSON.stringify({ v: 1, baseVersion: 1, savedAt: 0, workspace: ws("Unsaved") }),
    );
    const { sync, server, onNotice } = setup({ storage });
    sync.recoverDraft();
    expect(sync.workspace.name).toBe("Unsaved");
    expect(onNotice).toHaveBeenCalledWith("draftRestored");
    await vi.runOnlyPendingTimersAsync();
    expect(server.workspace.name).toBe("Unsaved");
  });

  it("asks when the draft was based on an older version", () => {
    const storage = new MemoryStorage();
    storage.setItem(
      draftKey("w1"),
      JSON.stringify({ v: 1, baseVersion: 1, savedAt: 0, workspace: ws("Old draft") }),
    );
    const { sync } = setup({ storage }, ws(), 3);
    sync.recoverDraft();
    expect(sync.workspace.name).toBe("W");
    expect(sync.getSnapshot().conflict).toMatchObject({ kind: "draft" });
    sync.resolveConflict("theirs");
    expect(storage.getItem(draftKey("w1"))).toBeNull();
  });
});
