import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Block, Workspace } from "@/lib/workspace/types";
import { MAX_WORKSPACE_BYTES } from "@/lib/workspace/repair";
import { applyGrade } from "./study/gradeEdit";
import {
  DRAFT_MAX_AGE_MS,
  SAVE_DEBOUNCE_MS,
  TAB_ALIVE_MS,
  WorkspaceSync,
  draftKey,
  type Notice,
  type SaveResult,
  type SyncDeps,
} from "./workspace-sync";

// ---------------------------------------------------------------------------
// Stand-ins: a server holding one workspace row, localStorage, a clock (vitest
// fake timers drive both setTimeout and Date.now), and the broadcast channel.
// ---------------------------------------------------------------------------

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
  draftKeys() {
    return [...this.data.keys()].filter((k) => k.startsWith("studyos:draft:"));
  }
}

/** A fake server: version-checked saves, reads, and writes from elsewhere. */
function fakeServer(initial: Workspace = ws(), version = 1) {
  const server = {
    workspace: structuredClone(initial),
    version,
    trashed: false,
    /** The next save commits but its reply is lost. */
    dropNextResponse: false,
    /** How many reads fail before they work again. */
    failFetch: 0,
  };
  const save = vi.fn(async (_id: string, w: Workspace, base: number): Promise<SaveResult> => {
    if (server.trashed) return { status: "not_found" };
    if (base !== server.version) return { status: "conflict", version: server.version };
    server.workspace = structuredClone(w);
    server.version += 1;
    if (server.dropNextResponse) {
      server.dropNextResponse = false;
      throw new Error("network: response lost");
    }
    return { status: "saved", version: server.version };
  });
  const fetchState = vi.fn(async () => {
    if (server.failFetch > 0) {
      server.failFetch -= 1;
      throw new Error("network");
    }
    if (server.trashed) return null;
    return { workspace: structuredClone(server.workspace), version: server.version };
  });
  const fetchVersion = vi.fn(async () => (server.trashed ? null : server.version));
  /** Another device, tab or the AI agent saves a change. */
  const write = (fn: (d: Workspace) => void) => {
    const draft = structuredClone(server.workspace);
    fn(draft);
    server.workspace = draft;
    server.version += 1;
  };
  return { server, save, fetchState, fetchVersion, write };
}

type Fake = ReturnType<typeof fakeServer>;

/** Open the editor in a tab (as the page load does) and start it. */
function openTab(
  fake: Fake,
  opts: { storage?: MemoryStorage; tabId?: string; deps?: Partial<SyncDeps> } = {},
) {
  const notices: Notice[] = [];
  const sync = new WorkspaceSync("w1", structuredClone(fake.server.workspace), fake.server.version, {
    save: fake.save,
    fetchState: fake.fetchState,
    fetchVersion: fake.fetchVersion,
    storage: opts.storage ?? new MemoryStorage(),
    tabId: opts.tabId,
    onNotice: (n) => notices.push(n),
    ...opts.deps,
  });
  sync.start();
  return Object.assign(sync, { notices });
}

/** The same workspace open in two tabs, telling each other about saves. */
function connect(...tabs: WorkspaceSync[]) {
  for (const tab of tabs) {
    tab.setDeps({
      onSaved: () => {
        for (const other of tabs) if (other !== tab) void other.checkRemote();
      },
    });
  }
}

/** A text field holding typing it has not written yet (BlockText, DraftInput). */
function bufferedField(sync: WorkspaceSync, blockId: string) {
  let pending: string | null = null;
  sync.registerField({
    hasPending: () => pending !== null,
    commit() {
      if (pending === null) return;
      const text = pending;
      pending = null;
      sync.update((d) => {
        for (const page of d.pages) {
          const b = page.blocks.find((x) => x.id === blockId);
          if (b && "text" in b) b.text = text;
        }
      });
    },
  });
  return {
    type(text: string) {
      pending = text;
    },
  };
}

/**
 * The tab is killed (crash, phone reclaiming memory): its timers never run
 * again. With `closed`, it said goodbye (pagehide) on the way out.
 */
function crash(tab: WorkspaceSync, closed = false) {
  const now = Date.now();
  vi.clearAllTimers(); // (this also resets the fake clock; put it back)
  vi.setSystemTime(now);
  if (closed) tab.releaseTab();
}

const texts = (w: Workspace, page = 0) =>
  w.pages[page].blocks.map((b) => ("text" in b ? b.text : `[${b.type}]`));
const setText = (id: string, text: string) => (d: Workspace) => {
  for (const page of d.pages) {
    const b = page.blocks.find((x) => x.id === id);
    if (b && "text" in b) b.text = text;
  }
};
const para = (id: string, text: string): Block => ({ id, type: "paragraph", text });

async function settle() {
  await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS + 10);
}

/** Let every timer and promise run (debounces, retries, quick re-reads). */
async function drain() {
  for (let i = 0; i < 8; i += 1) await vi.advanceTimersByTimeAsync(5_000);
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-12T10:00:00Z"));
});
afterEach(() => {
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------

describe("autosave", () => {
  it("debounces edits into one version-checked save", async () => {
    const fake = fakeServer();
    const sync = openTab(fake);
    sync.update((d) => (d.name = "A"));
    sync.update((d) => (d.name = "AB"));
    expect(sync.getSnapshot().status).toBe("saving");
    await settle();
    expect(fake.save).toHaveBeenCalledTimes(1);
    expect(fake.save.mock.calls[0][2]).toBe(1);
    expect(fake.server.workspace.name).toBe("AB");
    expect(sync.getSnapshot().status).toBe("saved");
    expect(sync.version).toBe(2);
  });

  it("keeps unsaved edits in local storage until the server confirms them", async () => {
    let release: (r: SaveResult) => void = () => {};
    const fake = fakeServer();
    const storage = new MemoryStorage();
    const sync = openTab(fake, {
      storage,
      deps: { save: vi.fn(() => new Promise<SaveResult>((resolve) => (release = resolve))) },
    });
    sync.update((d) => (d.name = "draft"));
    const key = draftKey("w1", sync.tabId);
    expect(storage.getItem(key)).toContain('"after":"draft"');
    await settle();
    release({ status: "saved", version: 2 });
    await vi.runOnlyPendingTimersAsync();
    expect(storage.getItem(key)).toBeNull();
  });

  it("shows a retryable error when the network fails, then saves on retry", async () => {
    const fake = fakeServer();
    let fail = true;
    const save = vi.fn(async (id: string, w: Workspace, base: number) => {
      if (fail) throw new Error("network");
      return fake.save(id, w, base);
    });
    const sync = openTab(fake, { deps: { save } });
    sync.update((d) => (d.name = "x"));
    await settle();
    expect(sync.getSnapshot().status).toBe("error");
    fail = false;
    sync.retry();
    await vi.runOnlyPendingTimersAsync();
    expect(sync.getSnapshot().status).toBe("saved");
    expect(fake.server.workspace.name).toBe("x");
  });

  it("marks oversized documents instead of sending them", async () => {
    const fake = fakeServer();
    const sync = openTab(fake);
    sync.update((d) => (d.pages[0].title = "x".repeat(MAX_WORKSPACE_BYTES)));
    await settle();
    expect(fake.save).not.toHaveBeenCalled();
    expect(sync.getSnapshot().status).toBe("tooLarge");
  });

  it("stops when the workspace was trashed elsewhere", async () => {
    const fake = fakeServer();
    const sync = openTab(fake);
    fake.server.trashed = true;
    sync.update((d) => (d.name = "x"));
    await settle();
    expect(sync.getSnapshot().status).toBe("gone");
  });

  it("with no unsaved edits, a newer version is loaded and announced", async () => {
    const fake = fakeServer();
    const sync = openTab(fake);
    fake.write((d) => (d.name = "Newer"));
    await sync.checkRemote();
    expect(sync.workspace.name).toBe("Newer");
    expect(sync.version).toBe(2);
    expect(sync.getSnapshot().rev).toBe(1);
    expect(sync.notices).toContain("updatedElsewhere");
  });

  it("merges a stale-version save with the newer version instead of overwriting it", async () => {
    const fake = fakeServer();
    const sync = openTab(fake);
    fake.write((d) => d.pages[1].blocks.push(para("other", "from the other tab")));
    sync.update(setText("b1", "mine"));
    await drain();
    expect(texts(fake.server.workspace)).toEqual(["mine"]);
    expect(texts(fake.server.workspace, 1)).toEqual(["from the other tab"]);
    expect(sync.getSnapshot()).toMatchObject({ status: "saved", conflict: null, merge: null });
  });

  it("reports a value it replaced and can put the other version back", async () => {
    const fake = fakeServer();
    const sync = openTab(fake);
    fake.write((d) => (d.name = "From other tab"));
    sync.update((d) => (d.name = "Mine"));
    await drain();
    expect(fake.server.workspace.name).toBe("Mine");
    const merge = sync.getSnapshot().merge!;
    expect(merge.report.overwritten).toEqual([
      expect.objectContaining({ theirs: "From other tab", mine: "Mine" }),
    ]);
    sync.restoreTheirs();
    await drain();
    expect(fake.server.workspace.name).toBe("From other tab");
    expect(sync.getSnapshot().merge).toBeNull();
    // Restoring is itself undoable.
    sync.undo();
    expect(sync.workspace.name).toBe("Mine");
  });
});

describe("history", () => {
  it("undo/redo restore exact states and are saved", async () => {
    const fake = fakeServer();
    const sync = openTab(fake);
    const initial = structuredClone(sync.workspace);
    sync.update((d) => d.pages.pop());
    const afterDelete = structuredClone(sync.workspace);
    sync.undo();
    expect(sync.workspace).toEqual(initial);
    sync.redo();
    expect(sync.workspace).toEqual(afterDelete);
    sync.undo();
    await settle();
    expect(fake.server.workspace).toEqual(initial);
  });

  it("reports removals with the step the Undo toast reverts, keeping later edits", () => {
    const onRemoval = vi.fn();
    const sync = openTab(fakeServer(), { deps: { onRemoval } });
    sync.update((d) => d.pages.splice(1, 1));
    expect(onRemoval).toHaveBeenCalledTimes(1);
    const [removal, entryId] = onRemoval.mock.calls[0];
    expect(removal).toMatchObject({ kind: "page", name: "Notes" });
    sync.update((d) => (d.name = "later edit"));
    expect(sync.undoTo(entryId)).toBe(true);
    expect(sync.workspace.pages.map((p) => p.id)).toEqual(["p1", "p2"]);
    expect(sync.workspace.name).toBe("later edit");
    expect(sync.getSnapshot().canRedo).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// The reviewer's findings. Each test failed on commit 0d24a1c.
// ---------------------------------------------------------------------------

describe("finding 1: undo never crosses an update from elsewhere", () => {
  it("Ctrl+Z after another device's update reverts only the student's change", async () => {
    const fake = fakeServer();
    const a = openTab(fake);
    a.update((d) => d.pages[0].blocks.push(para("mine", "laptop edit")));
    await a.flush();
    fake.write((d) => d.pages[0].blocks.push(para("phone", "PHONE NOTES")));
    await a.checkRemote();
    expect(texts(a.workspace)).toEqual(["hi", "laptop edit", "PHONE NOTES"]);

    expect(a.undo()).toBe(true);
    await a.flush();
    expect(texts(fake.server.workspace)).toEqual(["hi", "PHONE NOTES"]);
    // Nothing else to undo: the outside update is not a step.
    expect(a.getSnapshot().canUndo).toBe(false);
    expect(a.undo()).toBe(false);
    expect(a.getSnapshot().status).toBe("saved");
  });

  it("the Undo toast of an earlier deletion keeps the agent's later work", async () => {
    const fake = fakeServer();
    const onRemoval = vi.fn();
    const a = openTab(fake, { deps: { onRemoval } });
    a.update((d) => d.pages.splice(1, 1));
    const entryId = onRemoval.mock.calls[0][1] as number;
    await a.flush();
    a.setAgentBusy(true);
    fake.write((d) => d.pages.push({ id: "agent", title: "Agent page", blocks: [] }));
    a.setAgentBusy(false);
    await drain();

    expect(a.undoTo(entryId)).toBe(true);
    await drain();
    expect(fake.server.workspace.pages.map((p) => p.id)).toEqual(["p1", "p2", "agent"]);
  });
});

describe("finding 2: replayed edits never vanish or overwrite silently", () => {
  it("typing in a block the agent replaced (new ids) is kept as a block", async () => {
    const fake = fakeServer();
    const a = openTab(fake);
    a.setAgentBusy(true);
    a.update(setText("b1", "hi + 5 minutes of student typing"));
    fake.write((d) => (d.pages[0].blocks = [para("agent-new", "hi (rewritten by agent)")]));
    a.setAgentBusy(false);
    await drain();

    expect(texts(fake.server.workspace)).toEqual([
      "hi (rewritten by agent)",
      "hi + 5 minutes of student typing",
    ]);
    expect(a.getSnapshot().merge?.report.restored).toBe(1);
    expect(a.getSnapshot().status).toBe("saved");
  });

  it("an agent rewrite and words the student added right after it are combined", async () => {
    const fake = fakeServer();
    const a = openTab(fake);
    a.setAgentBusy(true);
    a.update(setText("b1", "hi and my new sentence"));
    fake.write(setText("b1", "Hello (agent fixed grammar, added summary)"));
    a.setAgentBusy(false);
    await drain();

    expect(texts(fake.server.workspace)).toEqual([
      "Hello (agent fixed grammar, added summary) and my new sentence",
    ]);
    expect(a.getSnapshot().merge).toBeNull();
  });

  it("the same words rewritten by the agent and the student keep both versions, the other one marked", async () => {
    const fake = fakeServer();
    const a = openTab(fake);
    a.setAgentBusy(true);
    a.update(setText("b1", "hey"));
    fake.write(setText("b1", "Hello"));
    a.setAgentBusy(false);
    await drain();

    // The student's version stays where it is (their cursor is not moved);
    // the other one follows, marked as a kept copy of it.
    expect(texts(fake.server.workspace)).toEqual(["hey", "Hello"]);
    const [mine, copy] = fake.server.workspace.pages[0].blocks as Array<{ id: string; keptFrom?: string }>;
    expect(mine.id).toBe("b1");
    expect(mine.keptFrom).toBeUndefined();
    expect(copy.keptFrom).toBe("b1");
    expect(a.getSnapshot().merge?.report.keptBoth).toBe(1);
  });

  it("edits to different parts of one paragraph are merged three ways", async () => {
    const fake = fakeServer(ws());
    fake.write(setText("b1", "Mitochondria make ATP. Ribosomes make proteins."));
    const a = openTab(fake);
    a.setAgentBusy(true);
    a.update(setText("b1", "Mitochondria make ATP via respiration. Ribosomes make proteins."));
    fake.write(setText("b1", "Mitochondria make ATP. Ribosomes build proteins."));
    a.setAgentBusy(false);
    await drain();

    expect(texts(fake.server.workspace)).toEqual([
      "Mitochondria make ATP via respiration. Ribosomes build proteins.",
    ]);
    expect(a.getSnapshot().merge).toBeNull();
  });
});

describe("finding 3: recovering a draft merges, never replaces", () => {
  it("a draft whose save already reached the server is cleared without asking", async () => {
    const fake = fakeServer();
    const storage = new MemoryStorage();
    const a = openTab(fake, { storage, tabId: "A" });
    a.update(setText("b1", "laptop text"));
    // The save reached the server, the tab died before the reply.
    await fake.save("w1", a.workspace, 1);
    crash(a, true);
    fake.write((d) => d.pages[0].blocks.push(para("phone", "PHONE NOTES")));
    fake.save.mockClear();

    const b = openTab(fake, { storage, tabId: "B" });
    await drain();
    expect(b.getSnapshot().conflict).toBeNull();
    expect(b.getSnapshot().merge).toBeNull();
    expect(b.notices).not.toContain("draftRestored");
    expect(storage.draftKeys()).toEqual([]);
    expect(fake.save).not.toHaveBeenCalled();
    expect(texts(fake.server.workspace)).toEqual(["laptop text", "PHONE NOTES"]);
  });

  it("unsaved edits from a closed tab are merged into newer content", async () => {
    const fake = fakeServer();
    const storage = new MemoryStorage();
    const a = openTab(fake, { storage, tabId: "A" });
    a.update(setText("b1", "laptop text"));
    crash(a, true); // closed before it could save
    fake.write((d) => d.pages[0].blocks.push(para("phone", "PHONE NOTES")));

    const b = openTab(fake, { storage, tabId: "B" });
    await drain(); // the server is asked which of the draft's saves landed
    expect(b.notices).toContain("draftRestored");
    expect(texts(fake.server.workspace)).toEqual(["laptop text", "PHONE NOTES"]);
    // The merge is one undoable step.
    b.undo();
    await drain();
    expect(texts(fake.server.workspace)).toEqual(["hi", "PHONE NOTES"]);
  });
});

describe("finding 4: a save whose reply was lost is recognised as our own", () => {
  it("continues saving instead of showing a conflict against the student's own save", async () => {
    const fake = fakeServer();
    const a = openTab(fake);
    a.update(setText("b1", "edit 1"));
    fake.server.dropNextResponse = true;
    await a.flush();
    expect(a.getSnapshot().status).toBe("error");

    a.update(setText("b1", "edit 2"));
    a.retry();
    await drain();
    expect(a.getSnapshot()).toMatchObject({ status: "saved", conflict: null, merge: null });
    expect(texts(fake.server.workspace)).toEqual(["edit 2"]);
    expect(fake.server.version).toBe(3);
  });
});

describe("finding 5: a failed re-read after the agent is retried", () => {
  it("merges the edits made during the agent's task instead of offering a conflict", async () => {
    const fake = fakeServer();
    const a = openTab(fake);
    a.setAgentBusy(true);
    a.update(setText("b1", "typed during agent"));
    fake.write((d) => d.pages[0].blocks.push(para("ag", "AGENT CONTENT")));
    fake.server.failFetch = 1;
    a.setAgentBusy(false);
    await drain();
    expect(a.getSnapshot()).toMatchObject({ status: "saved", conflict: null });
    expect(texts(fake.server.workspace)).toEqual(["typed during agent", "AGENT CONTENT"]);
  });

  it("when every quick re-read fails, a later save re-reads first and still merges", async () => {
    const fake = fakeServer();
    const a = openTab(fake);
    const seen: string[] = [];
    a.subscribe(() => {
      const snap = a.getSnapshot();
      seen.push(snap.conflict ? "conflict" : snap.status);
    });
    a.setAgentBusy(true);
    a.update(setText("b1", "typed during agent"));
    fake.write((d) => d.pages[0].blocks.push(para("ag", "AGENT CONTENT")));
    fake.server.failFetch = 5;
    a.setAgentBusy(false);
    await drain();
    await drain();
    expect(seen).toContain("error");
    expect(seen).not.toContain("conflict");
    expect(a.getSnapshot()).toMatchObject({ status: "saved", conflict: null });
    expect(texts(fake.server.workspace)).toEqual(["typed during agent", "AGENT CONTENT"]);
  });
});

describe("finding 6: drafts are per tab", () => {
  it("a second tab never adopts the draft of a tab that is still open", async () => {
    const fake = fakeServer();
    const storage = new MemoryStorage();
    const a = openTab(fake, { storage, tabId: "A" });
    a.update(setText("b1", "tab A typing in progress"));
    const b = openTab(fake, { storage, tabId: "B" });
    expect(texts(b.workspace)).toEqual(["hi"]);
    expect(b.notices).not.toContain("draftRestored");
    expect(storage.getItem(draftKey("w1", "A"))).not.toBeNull();
    b.adoptOrphans(); // the periodic check, while A is alive
    expect(texts(b.workspace)).toEqual(["hi"]);
  });

  it("one tab's save does not delete the other tab's crash copy", async () => {
    const fake = fakeServer();
    const storage = new MemoryStorage();
    const a = openTab(fake, { storage, tabId: "A" });
    const b = openTab(fake, { storage, tabId: "B" });
    connect(a, b);
    b.update((d) => (d.pages[1].title = "B is typing"));
    a.update(setText("b1", "A saves"));
    await a.flush();
    expect(storage.getItem(draftKey("w1", "B"))).toContain("B is typing");
    await drain();
    expect(fake.server.workspace.pages[1].title).toBe("B is typing");
    expect(texts(fake.server.workspace)).toEqual(["A saves"]);
    expect(texts(b.workspace)).toEqual(["A saves"]);
  });

  it("the draft of a tab that crashed is picked up by an open tab", async () => {
    const fake = fakeServer();
    const storage = new MemoryStorage();
    const a = openTab(fake, { storage, tabId: "A" });
    const b = openTab(fake, { storage, tabId: "B" });
    a.update(setText("b1", "typed before the crash"));
    crash(a); // no more saves, no more signs of life
    vi.setSystemTime(Date.now() + TAB_ALIVE_MS + 1_000);
    b.adoptOrphans();
    await drain();
    expect(texts(fake.server.workspace)).toEqual(["typed before the crash"]);
    expect(storage.getItem(draftKey("w1", "A"))).toBeNull();
  });
});

describe("finding 7: typing still buffered in a field is never missed", () => {
  it("is written to the local copy synchronously when the tab is hidden", () => {
    const fake = fakeServer();
    const storage = new MemoryStorage();
    const a = openTab(fake, { storage });
    const field = bufferedField(a, "b1");
    field.type("the last second of typing");
    expect(a.hasUnsavedChanges).toBe(true); // the leave prompt
    a.prepareToLeave(); // what visibilitychange / pagehide / beforeunload do
    // Synchronously: before any timer or promise runs (a suspended phone).
    expect(storage.getItem(draftKey("w1", a.tabId))).toContain("the last second of typing");
  });

  it("is written before a newer version is merged in", async () => {
    const fake = fakeServer();
    const a = openTab(fake);
    const field = bufferedField(a, "b1");
    field.type("hi, typed but not committed");
    a.setAgentBusy(true);
    fake.write((d) => d.pages[0].blocks.push(para("ag", "AGENT CONTENT")));
    a.setAgentBusy(false);
    await drain();
    expect(texts(fake.server.workspace)).toEqual(["hi, typed but not committed", "AGENT CONTENT"]);
  });
});

describe("finding 8: a recovered draft and new edits both survive", () => {
  it("editing right after recovery keeps the recovered edits", async () => {
    const fake = fakeServer();
    const storage = new MemoryStorage();
    const old = openTab(fake, { storage, tabId: "old" });
    old.update((d) => d.pages[0].blocks.push(para("x", "LAST VISIT ESSAY")));
    crash(old, true);
    fake.write((d) => (d.pages[1].title = "Renamed on the phone"));

    const b = openTab(fake, { storage, tabId: "B" });
    b.update((d) => (d.name = "renamed"));
    await drain();
    expect(texts(fake.server.workspace)).toEqual(["hi", "LAST VISIT ESSAY"]);
    expect(fake.server.workspace.name).toBe("renamed");
    expect(fake.server.workspace.pages[1].title).toBe("Renamed on the phone");
    expect(storage.draftKeys()).toEqual([]);
  });

  it("an old-format draft (whole document, older version) adds what it created", async () => {
    const fake = fakeServer(ws(), 2);
    const storage = new MemoryStorage();
    const old = ws();
    old.pages[0].blocks.push(para("x", "LAST VISIT ESSAY"));
    storage.setItem(
      draftKey("w1"),
      JSON.stringify({ v: 1, baseVersion: 1, savedAt: Date.now(), workspace: old }),
    );
    const b = openTab(fake, { storage });
    b.update((d) => (d.name = "renamed"));
    await drain();
    expect(texts(fake.server.workspace)).toEqual(["hi", "LAST VISIT ESSAY"]);
    expect(fake.server.workspace.name).toBe("renamed");
    expect(storage.draftKeys()).toEqual([]);
  });
});

describe("finding 10: the agent can wait for every pending save", () => {
  it("settle() writes buffered typing and pending edits and returns the saved version", async () => {
    const fake = fakeServer();
    const a = openTab(fake);
    a.update((d) => (d.name = "pending"));
    bufferedField(a, "b1").type("buffered");
    const result = await a.settle();
    expect(result).toEqual({ ok: true, version: 2 });
    expect(fake.server.workspace.name).toBe("pending");
    expect(texts(fake.server.workspace)).toEqual(["buffered"]);
  });
});

describe("finding 11: flashcard grades are computed from the card as it is now", () => {
  const deck = (): Workspace => ({
    ...ws(),
    pages: [
      {
        id: "p1",
        title: "Home",
        blocks: [{ id: "deck", type: "flashcards", cards: [{ id: "c1", front: "Q", back: "A" }] }],
      },
    ],
  });
  const card = (w: Workspace) => (w.pages[0].blocks[0] as { cards: { reps?: number; lastReviewedAt?: string }[] }).cards[0];
  const ref = { pageId: "p1", blockId: "deck", cardId: "c1" };

  it("a grade given meanwhile on another device is built upon, not overwritten", async () => {
    const fake = fakeServer(deck());
    const a = openTab(fake);
    const phoneAt = new Date("2026-11-12T09:00:00Z");
    fake.write((d) => applyGrade(d, ref, "good", phoneAt));
    const at = new Date("2026-11-12T10:00:00Z");
    a.update((d) => applyGrade(d, ref, "good", at), { rebase: "rerun" });
    await drain();
    expect(card(fake.server.workspace).reps).toBe(2);
    expect(card(fake.server.workspace).lastReviewedAt).toBe(at.toISOString());
    expect(a.getSnapshot().merge).toBeNull();
  });

  it("a grade replayed onto a document that already holds it is not counted twice", async () => {
    const fake = fakeServer(deck());
    const a = openTab(fake);
    const at = new Date("2026-11-12T10:00:00Z");
    a.update((d) => applyGrade(d, ref, "good", at), { rebase: "rerun" });
    fake.server.dropNextResponse = true;
    await a.flush(); // landed, reply lost
    fake.write((d) => (d.name = "renamed elsewhere")); // so it is not recognised by content
    a.retry();
    await drain();
    expect(card(fake.server.workspace).reps).toBe(1);
    expect(fake.server.workspace.name).toBe("renamed elsewhere");
  });
});

describe("finding 12: nothing goes stale when the agent finishes mid-merge", () => {
  it("another tab's save, then the agent: everything is merged, no stale conflict", async () => {
    const fake = fakeServer();
    const a = openTab(fake);
    a.update(setText("b1", "mine"));
    fake.write((d) => (d.pages[1].title = "other tab"));
    await drain();
    expect(a.getSnapshot().conflict).toBeNull();
    a.setAgentBusy(true);
    a.update((d) => d.pages[0].blocks.push(para("more", "typed during the agent")));
    fake.write((d) => d.pages.push({ id: "agent", title: "Agent page", blocks: [] }));
    a.setAgentBusy(false);
    await drain();
    expect(a.getSnapshot()).toMatchObject({ conflict: null, status: "saved" });
    expect(texts(fake.server.workspace)).toEqual(["mine", "typed during the agent"]);
    expect(fake.server.workspace.pages.map((p) => p.title)).toEqual(["Home", "other tab", "Agent page"]);
  });
});

describe("finding 14: memory and storage", () => {
  function big(): Workspace {
    const pages = Array.from({ length: 20 }, (_, p) => ({
      id: `p${p}`,
      title: `Page ${p}`,
      blocks: Array.from({ length: 200 }, (_, b) => para(`${p}-${b}`, `lorem ipsum `.repeat(40) + b)),
    }));
    return { id: "w1", name: "W", pages, databases: [] };
  }

  it("history steps and the local copy hold changes, not copies of the document", () => {
    const fake = fakeServer(big());
    const storage = new MemoryStorage();
    const a = openTab(fake, { storage });
    const before = a.workspace;
    for (let i = 0; i < 100; i += 1) a.update(setText(`0-${i}`, `edited ${i}`));
    const after = a.workspace;
    // Unchanged pages and blocks are the very same objects (shared, not copied).
    expect(after.pages.slice(1).every((p, i) => p === before.pages[i + 1])).toBe(true);
    expect(after.pages[0].blocks[150]).toBe(before.pages[0].blocks[150]);
    expect(a.getSnapshot().canUndo).toBe(true);
    // The local copy is a patch: tiny next to the ~2 MB document.
    const draft = storage.getItem(draftKey("w1", a.tabId))!;
    expect(JSON.stringify(after).length).toBeGreaterThan(1_500_000);
    expect(draft.length).toBeLessThan(150_000);
  });

  it("says once when the local safety copy cannot be written", () => {
    const storage = new MemoryStorage();
    storage.setItem = () => {
      throw new DOMException("quota", "QuotaExceededError");
    };
    const a = openTab(fakeServer(), { storage });
    a.update((d) => (d.name = "1"));
    a.update((d) => (d.name = "2"));
    expect(a.notices.filter((n) => n === "localCopyFailed")).toHaveLength(1);
  });

  it("cleans up drafts nobody came back for", () => {
    const storage = new MemoryStorage();
    const old = { v: 2, ops: [], ctx: {}, savedAt: Date.now() - DRAFT_MAX_AGE_MS - 1 };
    storage.setItem(draftKey("never-reopened", "t1"), JSON.stringify(old));
    storage.setItem(draftKey("never-reopened", "t2"), JSON.stringify({ ...old, savedAt: Date.now() }));
    openTab(fakeServer(), { storage });
    expect(storage.getItem(draftKey("never-reopened", "t1"))).toBeNull();
    expect(storage.getItem(draftKey("never-reopened", "t2"))).not.toBeNull();
  });
});

describe("finding 16: undo with typing still buffered", () => {
  it("writes the typing first and undoes that, keeping it redoable", () => {
    const a = openTab(fakeServer());
    const field = bufferedField(a, "b1");
    field.type("typed on the phone");
    expect(a.undo()).toBe(true);
    expect(texts(a.workspace)).toEqual(["hi"]);
    expect(a.hasUnsavedChanges).toBe(true);
    // Nothing is written after the undo (the field has nothing pending).
    a.commitFields();
    expect(a.getSnapshot().canRedo).toBe(true);
    a.redo();
    expect(texts(a.workspace)).toEqual(["typed on the phone"]);
  });
});

describe("finding 17: smaller gaps", () => {
  it("a tab stuck in 'gone' recovers when the workspace is restored from the trash", async () => {
    const fake = fakeServer();
    const a = openTab(fake);
    fake.server.trashed = true;
    a.update((d) => (d.name = "edited while trashed"));
    await drain();
    expect(a.getSnapshot().status).toBe("gone");
    fake.server.trashed = false; // restored from the trash
    await a.checkRemote();
    await drain();
    expect(a.getSnapshot().status).toBe("saved");
    expect(fake.server.workspace.name).toBe("edited while trashed");
  });

  it("a dragged block lands after the same neighbour although the page changed", async () => {
    const fake = fakeServer({
      ...ws(),
      pages: [{ id: "p1", title: "Home", blocks: [para("a", "A"), para("b", "B"), para("c", "C")] }],
    });
    const a = openTab(fake);
    a.setAgentBusy(true);
    a.update((d) => {
      const bs = d.pages[0].blocks;
      bs.push(bs.shift()!); // drag A below C
    });
    fake.write((d) => d.pages[0].blocks.unshift(para("z", "Z")));
    a.setAgentBusy(false);
    await drain();
    expect(texts(fake.server.workspace)).toEqual(["Z", "B", "C", "A"]);
  });
});

// ---------------------------------------------------------------------------
// Second review (F5, F8) and the browser QA (closing a tab)
// ---------------------------------------------------------------------------

describe("F5: a merge that breaks a limit is repaired, not offered as a conflict", () => {
  const card = (i: number) => ({ id: `c${i}`, front: `Q${i}`, back: `A${i}` });
  const deck = (n: number): Workspace => ({
    ...ws(),
    pages: [{ id: "p1", title: "Home", blocks: [{ id: "deck", type: "flashcards", cards: Array.from({ length: n }, (_, i) => card(i)) } as Block] }],
  });
  const cardsIn = (w: Workspace) =>
    w.pages[0].blocks.flatMap((b) => ("cards" in b ? (b.cards as Array<{ id: string }>).map((c) => c.id) : []));

  it("two tabs filling a deck past 200 cards: the deck is split, every card kept", async () => {
    const fake = fakeServer(deck(199));
    const a = openTab(fake);
    a.setAgentBusy(true);
    a.update((d) => void (d.pages[0].blocks[0] as { cards: unknown[] }).cards.push(card(500)));
    fake.write((d) => void (d.pages[0].blocks[0] as { cards: unknown[] }).cards.push(card(600)));
    a.setAgentBusy(false);
    await drain();
    expect(a.getSnapshot().conflict).toBeNull();
    expect(a.getSnapshot().merge?.report.repaired).toBe(1);
    const ids = cardsIn(fake.server.workspace);
    expect(ids).toHaveLength(201);
    expect(ids).toEqual(expect.arrayContaining(["c500", "c600"]));
  });

  it("the last-resort choice says what Keep my version replaces, and Undo brings it back", async () => {
    const fake = fakeServer();
    const a = openTab(fake);
    a.setAgentBusy(true);
    a.update(setText("b1", "hi there"));
    // A newer client wrote a block this one cannot read: merging cannot keep it.
    fake.write((d) => {
      d.name = "Renamed";
      d.pages[0].blocks.push({ id: "holo", type: "hologram" } as unknown as Block);
    });
    a.setAgentBusy(false);
    await drain();
    const conflict = a.getSnapshot().conflict;
    expect(conflict?.discards).toBeGreaterThan(0);
    a.resolveConflict("mine");
    await drain();
    expect(fake.server.workspace.name).toBe("W");
    expect(texts(fake.server.workspace)).toEqual(["hi there"]);
    expect(a.undo()).toBe(true); // the other version's changes come back
    expect(a.workspace.name).toBe("Renamed");
  });
});

describe("F8: an old-format draft never loses typing", () => {
  it("recovered onto a newer version: the text it held is kept beside the saved one", async () => {
    const fake = fakeServer();
    const storage = new MemoryStorage();
    const old = structuredClone(fake.server.workspace);
    setText("b1", "hi, typed in the old editor")(old);
    storage.setItem(draftKey("w1"), JSON.stringify({ v: 1, baseVersion: 1, savedAt: Date.now(), workspace: old }));
    fake.write(setText("b1", "hi, saved elsewhere"));
    const a = openTab(fake, { storage });
    await drain();
    expect(texts(a.workspace)).toEqual(["hi, saved elsewhere", "hi, typed in the old editor"]);
    expect((a.workspace.pages[0].blocks[1] as { keptFrom?: string }).keptFrom).toBe("b1");
    expect(a.getSnapshot().merge?.report.keptBoth).toBe(1);
    expect(storage.data.has(draftKey("w1"))).toBe(false);
  });
});

describe("closing a tab (browser QA)", () => {
  it("a tab that said goodbye leaves its draft to the next tab at once", async () => {
    const fake = fakeServer();
    const storage = new MemoryStorage();
    const a = openTab(fake, { storage, tabId: "A", deps: { isOnline: () => false } });
    a.update(setText("b1", "hi, offline"));
    a.prepareToLeave(true); // nothing can be sent: the draft is the fallback
    a.releaseTab();
    // Events that follow pagehide do not mark it alive again.
    a.writeDraft();
    crash(a, true);
    const b = openTab(fake, { storage, tabId: "B" });
    await drain();
    expect(texts(b.workspace)).toEqual(["hi, offline"]);
    expect(texts(fake.server.workspace)).toEqual(["hi, offline"]);
  });

  it("a tab that vanished without goodbye is recovered only once it is provably gone", async () => {
    const fake = fakeServer();
    const storage = new MemoryStorage();
    const a = openTab(fake, { storage, tabId: "A", deps: { isOnline: () => false } });
    a.update(setText("b1", "hi, crashed"));
    crash(a);
    const b = openTab(fake, { storage, tabId: "B" });
    await drain();
    expect(texts(b.workspace)).toEqual(["hi"]); // A might still be open
    await vi.advanceTimersByTimeAsync(TAB_ALIVE_MS);
    b.adoptOrphans();
    await drain();
    expect(texts(b.workspace)).toEqual(["hi, crashed"]);
  });
});
