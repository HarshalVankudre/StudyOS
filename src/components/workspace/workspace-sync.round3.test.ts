// @vitest-environment node
/**
 * Third sync review: every reproduced sequence, end to end against the real
 * store and version service on an in-memory database (sync-sim/harness.ts).
 * Each test fails on the engine as it was at that review (commit 19f8e6a);
 * where a test passes `beacon` or calls `prepareToLeave(true)`, that is the
 * old closing-tab path, which the current engine no longer has.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applyRunResults } from "@/lib/study/quiz";
import * as store from "@/lib/workspace/store";
import { diff } from "@/lib/workspace/changes";
import { SAVE_LOG_TABS } from "@/lib/workspace/save-ids";
import type { Block, Workspace } from "@/lib/workspace/types";
import { applyGrade, gradeOptions, gradeReplayer } from "./study/gradeEdit";
import { MemoryStorage, Server, advance, crash, drain, freeze, openTab, thaw, type Tab } from "./sync-sim/harness";
import { TAB_ALIVE_MS, WorkspaceSync, draftKey } from "./workspace-sync";

vi.mock("@/lib/db", async () => {
  const { createMemoryPrisma } = await import("./sync-sim/memory-prisma");
  return { prisma: createMemoryPrisma() };
});
vi.mock("@clerk/nextjs/server", () => ({ auth: async () => ({ userId: "u1" }) }));
vi.mock("@/lib/ops/report-error", () => ({ reportError: () => {} }));

type Loose = Record<string, unknown>;

function ws(): Workspace {
  return {
    id: "w1",
    name: "W",
    pages: [
      {
        id: "p1",
        title: "Home",
        blocks: [
          { id: "b1", type: "paragraph", text: "alpha" },
          { id: "b2", type: "paragraph", text: "beta" },
        ],
      },
    ],
    databases: [
      {
        id: "d1",
        name: "T",
        properties: [
          { id: "n", name: "N", type: "text" },
          { id: "x", name: "X", type: "number" },
        ],
        rows: [{ id: "r1", cells: { n: "row", x: 0 } }],
        views: [{ id: "v1", name: "All", type: "table" }],
      },
    ],
  } as Workspace;
}
const b = (w: Workspace, id: string) => (w.pages[0].blocks.find((x) => x.id === id) as { text?: string } | undefined)?.text;
const texts = (w: Workspace) =>
  w.pages[0].blocks.map((x) => `${(x as { text?: string }).text}${(x as { keptFrom?: string }).keptFrom ? " (kept)" : ""}`);
const setText = (id: string, value: string) => (d: Workspace) => {
  for (const p of d.pages) for (const x of p.blocks) if (x.id === id && "text" in x) (x as { text: string }).text = value;
};
const setX = (v: number) => (d: Workspace) => void (d.databases[0].rows[0].cells.x = v);
const cellX = (w: Workspace) => w.databases[0].rows[0].cells.x;
const count = (text: string | undefined, word: string) => (text ?? "").split(word).length - 1;

/**
 * The closing-tab request of the engine under review, for tests that replay
 * its sequences: it posted a patch that the server merged. Counts calls; on
 * the current code there is nothing to call (and the engine never calls it).
 */
function oldBeacon(calls: { n: number }) {
  return {
    beacon: (body: string) => {
      calls.n += 1;
      const old = store as unknown as { saveWorkspaceChanges?: (...a: unknown[]) => Promise<unknown> };
      const { id, baseVersion, ops, saveId } = JSON.parse(body) as Loose;
      void old.saveWorkspaceChanges?.(id, baseVersion, ops, saveId)?.catch(() => {});
      return true;
    },
  } as Loose;
}
/** pagehide as the editor wires it: write, try to save, say goodbye. */
const pageHide = (tab: WorkspaceSync) => {
  (tab as unknown as { prepareToLeave: (final?: boolean) => boolean }).prepareToLeave(true);
  tab.releaseTab();
};
const pageShow = async (tab: WorkspaceSync) => {
  tab.heartbeat();
  await tab.checkRemote();
};

beforeEach(() => {
  vi.useFakeTimers({ now: Date.UTC(2026, 10, 12, 9, 0, 0) });
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
});

describe("finding 1: hidden inside the debounce window while another device saved, then shown again", () => {
  it("the tab comes back on the newer version and its next save keeps the other device's edit", async () => {
    const server = new Server(ws());
    const calls = { n: 0 };
    const laptop = openTab(server, { tabId: "laptop", deps: oldBeacon(calls) });
    await server.write(setText("b2", "beta from phone")); // v2; the laptop has not seen it
    laptop.update(setX(5)); // typed, still under the 800 ms debounce
    pageHide(laptop); // back/forward navigation (or "Stay" on the leave prompt)
    await advance(10);
    await pageShow(laptop); // restored from the back/forward cache
    await drain();
    expect(b(laptop.workspace, "b2")).toBe("beta from phone");
    laptop.update(setText("b1", "alpha more"));
    await drain();
    expect(b(server.doc(), "b2")).toBe("beta from phone");
    expect(cellX(server.doc())).toBe(5);
    expect(b(server.doc(), "b1")).toBe("alpha more");
    expect(laptop.workspace).toEqual(server.doc());
    expect(calls.n).toBe(0); // nothing but ordinary saves is ever sent
  });
});

describe("finding 2: only a compare-and-swap save reaches the server (no patch applied there)", () => {
  it("S8: closing after an unconfirmed save does not write its text twice", async () => {
    const server = new Server(ws());
    const storage = new MemoryStorage();
    const calls = { n: 0 };
    const tab = openTab(server, { tabId: "L", storage, deps: oldBeacon(calls) });
    tab.update(setText("b1", "alpha [B5]"), "f");
    tab.net.dropReplies = 1;
    await advance(900); // lands as v2, reply lost; the tab retries in 2 s
    freeze(tab.net); // the retry hangs (bad network)
    await advance(2_100);
    await server.write(setText("b1", "alpha [B5] [A6]")); // the phone appends
    tab.update(setText("b1", "alpha [B5] [B9]"), "f"); // the tab types more, then closes
    pageHide(tab);
    crash(tab, true);
    await advance(10);
    expect(count(b(server.doc(), "b1"), "[B5]")).toBe(1);
    // Opened again in this browser: the rest of the typing arrives, once.
    const again = openTab(server, { tabId: "L2", storage });
    await drain();
    const text = b(server.doc(), "b1");
    expect([count(text, "[B5]"), count(text, "[A6]"), count(text, "[B9]")]).toEqual([1, 1, 1]);
    expect(again.workspace).toEqual(server.doc());
  });

  it("S6: nothing sent while closing can arrive late and bring deleted words back", async () => {
    const server = new Server(ws());
    const storage = new MemoryStorage();
    const held: string[] = [];
    const tab = openTab(server, {
      tabId: "L",
      storage,
      deps: { beacon: (body: string) => (held.push(body), true) } as Loose,
    });
    tab.update(setText("b1", "alpha typo words"), "f");
    pageHide(tab);
    crash(tab, true);
    await advance(2_000);
    const reopened = openTab(server, { tabId: "R", storage });
    await drain();
    expect(b(server.doc(), "b1")).toBe("alpha typo words"); // recovered from the draft
    reopened.update(setText("b1", "alpha"), "g"); // the student deletes the words again
    await drain();
    // The old closing-tab request, delivered late (a patch the server merged).
    const old = store as unknown as { saveWorkspaceChanges?: (...a: unknown[]) => Promise<unknown> };
    for (const body of held) {
      const { id, baseVersion, ops, saveId } = JSON.parse(body) as Loose;
      await old.saveWorkspaceChanges?.(id, baseVersion, ops, saveId);
    }
    await reopened.checkRemote();
    await drain();
    expect(held).toEqual([]);
    expect(b(server.doc(), "b1")).toBe("alpha");
  });

  it("a save still on its way when the tab closes lands at most once, whoever arrives first", async () => {
    for (const lateFirst of [true, false]) {
      const server = new Server(ws());
      const storage = new MemoryStorage();
      const tab = openTab(server, { tabId: "L", storage });
      tab.update((d) => void d.pages[0].blocks.push({ id: "n1", type: "paragraph", text: "Essay plan:" } as Block));
      freeze(tab.net);
      await advance(900); // the save with the new paragraph is on its way
      tab.update(setText("n1", "Essay plan: intro, three arguments, conclusion"), "f");
      pageHide(tab);
      crash(tab, true);
      if (lateFirst) thaw(tab.net); // the request arrives before the workspace is opened again
      await advance(50);
      const again = openTab(server, { tabId: "L2", storage });
      if (!lateFirst) thaw(tab.net); // ...or while the next tab is recovering the draft
      await drain();
      expect(texts(server.doc())).toEqual(["alpha", "beta", "Essay plan: intro, three arguments, conclusion"]);
      expect(again.workspace).toEqual(server.doc());
      expect(again.getSnapshot().merge).toBeNull();
    }
  });
});

describe("finding 3: a save that landed without a reply, then many saves elsewhere", () => {
  it("S2: the laptop sleeps through 120 phone saves and does not re-apply its save", async () => {
    const server = new Server(ws());
    const laptop = openTab(server, { tabId: "laptop" });
    laptop.update(setText("b1", "alpha laptop words"));
    laptop.update(setX(1));
    laptop.net.dropReplies = 1;
    await advance(900); // lands as v2, reply lost
    laptop.net.offline = true; // lid closed
    const phone = openTab(server, { tabId: "phone" });
    phone.update(setText("b1", "alpha")); // removes the laptop's words
    phone.update(setX(2));
    await advance(2_000);
    for (let i = 0; i < 120; i += 1) {
      phone.update(setText("b2", `beta ${i}`), "f");
      await advance(1_000);
    }
    await drain();
    expect(server.version).toBeGreaterThan(120);
    laptop.net.offline = false; // the laptop wakes
    laptop.retry();
    await drain();
    expect(b(server.doc(), "b1")).toBe("alpha");
    expect(cellX(server.doc())).toBe(2);
    expect(laptop.workspace).toEqual(server.doc());
    expect(laptop.getSnapshot().status).toBe("saved");
    // Nothing had to be reconciled; the laptop is only told that the value it
    // had saved was changed on the phone afterwards (and can take it back).
    const told = laptop.getSnapshot().merge;
    expect(told?.report).toMatchObject({ keptBoth: 0, restored: 0, overwritten: [], unapplied: [], skipped: 0 });
    expect(told?.replaced.map((r) => [r.mine, r.theirs])).toEqual([[1, 2]]);
  });
});

describe("finding 3, continued: what the log does at its own limits", () => {
  it("writes by the AI agent and by the server keep the log complete: the lost save is still recognised", async () => {
    const server = new Server(ws());
    const laptop = openTab(server, { tabId: "laptop" });
    laptop.update(setText("b1", "alpha laptop words"));
    laptop.net.dropReplies = 1;
    await advance(900); // lands as v2, reply lost
    laptop.net.offline = true;
    const agent = await server.agentStart();
    await agent.apply(setText("b2", "beta, rewritten by the assistant")); // v3, through the version service
    await server.write(setText("b1", "alpha")); // v4: the phone removes the laptop's words
    laptop.net.offline = false;
    laptop.retry();
    await drain();
    expect(texts(server.doc())).toEqual(["alpha", "beta, rewritten by the assistant"]);
    expect(laptop.workspace).toEqual(server.doc());
    expect(laptop.getSnapshot().merge).toBeNull(); // certain: nothing to ask, nothing re-applied
  });

  it("more tabs than the log remembers saved meanwhile: the tab is told it cannot be confirmed, nothing is replaced", async () => {
    const server = new Server(ws());
    const laptop = openTab(server, { tabId: "laptop" });
    laptop.update(setText("b1", "alpha laptop words"));
    laptop.update(setX(1));
    laptop.net.dropReplies = 1;
    await advance(900); // lands as v2, reply lost
    laptop.net.offline = true; // asleep for a semester
    await server.write((d) => {
      (d.pages[0].blocks[0] as { text: string }).text = "alpha";
      d.databases[0].rows[0].cells.x = 2;
    });
    for (let i = 0; i < SAVE_LOG_TABS + 1; i += 1) {
      const other = openTab(server, { tabId: `other-tab-${i}` });
      other.update(setText("b2", `beta ${i}`));
      await advance(1_000);
      crash(other, true);
    }
    laptop.net.offline = false;
    laptop.retry();
    await drain();
    expect(b(server.doc(), "b1")).toBe("alpha");
    expect(cellX(server.doc())).toBe(2);
    expect(laptop.getSnapshot().merge?.source).toBe("unconfirmed");
    expect(texts(server.doc())).toContain("alpha laptop words (kept)");
    expect(laptop.getSnapshot().merge?.report.unapplied.map((u) => [u.mine, u.theirs])).toEqual([[1, 2]]);
  });
});

describe("finding 4: a rolling deploy", () => {
  for (const build of ["noLog", "round3"] as const) {
    it(`S3: a save that landed on an instance of an older build (${build}) is not re-applied over a later change`, async () => {
      const server = new Server(ws());
      const laptop = openTab(server, { tabId: "laptop" });
      laptop.update(setText("b1", "alpha laptop"));
      laptop.update(setX(1));
      laptop.net.saveBuild = build; // this one request hits an old instance
      laptop.net.dropReplies = 1;
      await advance(900);
      laptop.net.saveBuild = "current";
      laptop.net.offline = true;
      await advance(3_000);
      await server.write((d) => {
        (d.pages[0].blocks[0] as { text: string }).text = "alpha"; // the phone deletes the words again
        d.databases[0].rows[0].cells.x = 2;
      });
      laptop.net.offline = false;
      laptop.retry();
      await drain();
      // Nothing of the phone's is replaced...
      expect(b(server.doc(), "b1")).toBe("alpha");
      expect(cellX(server.doc())).toBe(2);
      // ...and nothing of the laptop's is dropped without a word: its text is
      // a marked copy, its value is offered, and the banner says why.
      const merge = laptop.getSnapshot().merge;
      expect(merge?.source).toBe("unconfirmed");
      expect(texts(server.doc())).toEqual(["alpha", "alpha laptop (kept)", "beta"]);
      expect(merge?.report.unapplied.map((u) => [u.mine, u.theirs])).toEqual([[1, 2]]);
      laptop.applyMine();
      await drain();
      expect(cellX(server.doc())).toBe(1);
    });
  }

  it("S3a: every instance is of a build without the log: the same, nothing guessed", async () => {
    const server = new Server(ws());
    const laptop = openTab(server, { tabId: "laptop" });
    laptop.net.saveBuild = "noLog";
    laptop.net.readBuild = "noLog";
    laptop.update(setText("b1", "alpha laptop"));
    laptop.net.dropReplies = 1;
    await advance(900);
    laptop.net.offline = true;
    await advance(3_000);
    await server.write(setText("b1", "alpha"));
    laptop.net.offline = false;
    laptop.retry();
    await drain();
    expect(b(server.doc(), "b1")).toBe("alpha");
    expect(laptop.getSnapshot().merge?.source).toBe("unconfirmed");
  });

  it("uncertain but harmless: the server still holds what the save wrote, so nothing is asked", async () => {
    const server = new Server(ws());
    const laptop = openTab(server, { tabId: "laptop" });
    laptop.update(setText("b1", "alpha laptop"));
    laptop.net.saveBuild = "noLog";
    laptop.net.dropReplies = 1;
    await advance(900);
    laptop.net.saveBuild = "current";
    laptop.net.offline = true;
    laptop.update(setText("b1", "alpha laptop and more"), "f");
    await server.write(setText("b2", "beta from the phone"));
    laptop.net.offline = false;
    laptop.retry();
    await drain();
    expect(texts(server.doc())).toEqual(["alpha laptop and more", "beta from the phone"]);
    expect(laptop.getSnapshot().merge).toBeNull();
  });

  // Found by the harness (seed 10, "rolling deploy" #308): every possibility
  // gave the same document, so "the last save landed" was assumed and what
  // the other possibility had to report was dropped with it.
  it("uncertain, same document either way: a recovered value that did not go in is still offered", async () => {
    const server = new Server(ws());
    const storage = new MemoryStorage();
    const tab = openTab(server, { tabId: "L", storage });
    tab.net.offline = true;
    tab.update(setX(81));
    await advance(900); // the save is tried; no reply ever comes (it did not land)
    const phone = openTab(server, { tabId: "P" });
    phone.net.saveBuild = "noLog"; // handled by an instance that keeps no log
    phone.update(setX(60));
    await drain();
    crash(tab, true);
    const again = openTab(server, { tabId: "L2", storage });
    await drain();
    expect(cellX(server.doc())).toBe(60); // nothing replaced
    const merge = again.getSnapshot().merge;
    expect(merge?.report.unapplied.map((u) => [u.mine, u.theirs])).toEqual([[81, 60]]);
    again.applyMine();
    await drain();
    expect(cellX(server.doc())).toBe(81);
  });

  it("uncertain, same document either way: a deletion that was not repeated is still said (live tab)", async () => {
    const server = new Server(ws());
    const laptop = openTab(server, { tabId: "laptop" });
    laptop.net.offline = true;
    laptop.update((d) => void (d.pages[0].blocks = d.pages[0].blocks.filter((x) => x.id !== "b2")));
    await advance(900); // tried, no reply (it did not land)
    const phone = openTab(server, { tabId: "phone" });
    phone.net.saveBuild = "noLog";
    phone.update(setText("b2", "beta, with more from the phone"));
    await drain();
    laptop.net.offline = false;
    laptop.retry();
    await drain();
    expect(b(server.doc(), "b2")).toBe("beta, with more from the phone");
    expect(laptop.workspace).toEqual(server.doc());
    expect(laptop.getSnapshot().merge?.report.keptDeleted).toBe(1);
  });

  it("a tab of the previous build stops sending and keeps its edits in the draft", async () => {
    const server = new Server(ws());
    const storage = new MemoryStorage();
    const tab = openTab(server, { tabId: "old", storage });
    const sync = tab as unknown as { markOutdated?: () => void };
    expect(typeof sync.markOutdated).toBe("function");
    tab.update(setText("b1", "alpha typed on the old build"));
    sync.markOutdated?.(); // the server answered "unknown action"
    await drain();
    expect(tab.getSnapshot().status).toBe("outdated");
    expect(server.version).toBe(1);
    // After the reload the new tab merges the draft.
    crash(tab, true);
    const reloaded = openTab(server, { tabId: "new", storage });
    await drain();
    expect(b(server.doc(), "b1")).toBe("alpha typed on the old build");
    expect(reloaded.notices).toContain("draftRestored");
  });
});

describe("finding 5: a draft that cannot be matched with certainty keeps everything typed", () => {
  it("S9: typing inside a block whose creation landed unconfirmed", async () => {
    const server = new Server(ws());
    const storage = new MemoryStorage();
    const tab = openTab(server, { tabId: "L", storage });
    tab.net.readBuild = "noLog";
    tab.net.saveBuild = "noLog";
    tab.update((d) => void d.pages[0].blocks.push({ id: "n1", type: "paragraph", text: "My essay intro" } as Block));
    tab.net.dropReplies = 1;
    await advance(900); // the creation lands, reply lost
    freeze(tab.net);
    tab.update(setText("n1", "My essay intro, and the whole second paragraph I wrote on the bus"), "f");
    await advance(500);
    crash(tab); // the phone kills the tab
    await server.write(setText("b2", "beta (other device)"));
    await advance(TAB_ALIVE_MS + 30_000);
    const reopened = openTab(server, { tabId: "R", storage, start: false });
    reopened.net.readBuild = "noLog"; // the deploy is still going on: this read tells nothing either
    reopened.start();
    await drain();
    expect(JSON.stringify(server.doc())).toContain("second paragraph I wrote on the bus");
    expect(reopened.notices).toContain("draftRestored");
    expect([...storage.data.keys()].filter((k) => k.startsWith("studyos:draft:"))).toEqual([]);
  });

  it("S10: a draft of the second engine (v2), base behind, typing inside a block it created", async () => {
    const server = new Server(ws(), 5);
    const storage = new MemoryStorage();
    const mine = ws();
    mine.pages[0].blocks.push({ id: "n1", type: "paragraph", text: "intro plus everything typed after the save" } as Block);
    // The server already has the block (the save of its first words landed).
    await server.write((d) => void d.pages[0].blocks.push({ id: "n1", type: "paragraph", text: "intro" } as Block));
    storage.setItem(
      draftKey("w1", "old"),
      JSON.stringify({ v: 2, id: "w1", tabId: "old", baseVersion: 4, savedAt: Date.now(), ops: diff(ws(), mine), ctx: {} }),
    );
    const reopened = openTab(server, { tabId: "R", storage });
    await drain();
    expect(texts(server.doc())).toEqual(["alpha", "beta", "intro", "intro plus everything typed after the save (kept)"]);
    expect(reopened.getSnapshot().merge).toMatchObject({ source: "unconfirmed" });
    expect(reopened.getSnapshot().merge?.report.keptBoth).toBe(1);
  });

  it("a draft of the third engine (v3) with a save the log cannot place: nothing replaced, nothing dropped", async () => {
    const server = new Server(ws(), 5);
    const storage = new MemoryStorage();
    const sent = ws();
    (sent.pages[0].blocks[0] as { text: string }).text = "alpha sent";
    sent.databases[0].rows[0].cells.x = 7;
    const mine = structuredClone(sent);
    (mine.pages[0].blocks[0] as { text: string }).text = "alpha sent and typed after";
    // v6, written by an instance of the build that wrote this draft: the
    // current log has no record of who produced it.
    const phone = openTab(server, { tabId: "phone" });
    phone.net.saveBuild = "round3";
    phone.update(setText("b2", "beta moved on"));
    await drain();
    storage.setItem(
      draftKey("w1", "old3"),
      JSON.stringify({
        v: 3,
        id: "w1",
        tabId: "old3",
        baseVersion: 5,
        savedAt: Date.now(),
        ops: diff(ws(), mine),
        ctx: {},
        sends: [{ saveId: "oldsave000001", ops: diff(sent, mine) }],
      }),
    );
    const reopened = openTab(server, { tabId: "R", storage });
    await drain();
    expect(texts(server.doc())).toEqual(["alpha", "alpha sent and typed after (kept)", "beta moved on"]);
    expect(cellX(server.doc())).toBe(0);
    expect(reopened.getSnapshot().merge?.report.unapplied.map((u) => u.mine)).toEqual([7]);
  });
});

describe("a draft that is not its tab's last word (storage refused the later writes)", () => {
  it("is added back without replacing anything when that tab saved after it", async () => {
    const server = new Server(ws());
    const storage = new MemoryStorage();
    const tab = openTab(server, { tabId: "L", storage });
    tab.update(setX(5));
    tab.update((d) => void d.pages[0].blocks.push({ id: "idea", type: "paragraph", text: "Monday's idea" } as Block));
    // From here on the browser refuses to store anything (quota): the draft
    // on disk stays as it is, without the save that is about to be sent.
    const stale = [...storage.data.entries()];
    storage.setItem = () => {
      throw new Error("QuotaExceededError");
    };
    tab.net.dropReplies = 1;
    await advance(900); // the save lands (v2), its reply is lost, the tab dies
    crash(tab);
    storage.data = new Map(stale);
    storage.setItem = MemoryStorage.prototype.setItem;
    expect(tab.notices).toContain("localCopyFailed");
    // The phone takes both back.
    await server.write((d) => {
      d.databases[0].rows[0].cells.x = 0;
      d.pages[0].blocks = d.pages[0].blocks.filter((x) => x.id !== "idea");
    });
    await advance(TAB_ALIVE_MS + 10_000);
    const reopened = openTab(server, { tabId: "R", storage });
    await drain();
    // Not written over the phone's value; the paragraph is back, and said so.
    expect(cellX(server.doc())).toBe(0);
    const merge = reopened.getSnapshot().merge;
    expect(merge?.source).toBe("unconfirmed");
    expect(merge?.report.unapplied.map((u) => [u.mine, u.theirs])).toEqual([[5, 0]]);
    expect(merge?.report.restored).toBe(1);
  });
});

describe("finding 6: a settings object created on two devices at once", () => {
  const addCategory = (id: string, name: string) => (d: Workspace) => {
    const database = d.databases[0];
    database.grading ??= { categories: [] };
    database.grading.categories.push({ id, course: "*", name, weight: 20 });
  };
  const categories = (w: Workspace) => (w.databases[0].grading?.categories ?? []).map((c) => c.name).sort();

  it("GR1: categories added on both sides are both kept", async () => {
    const server = new Server(ws());
    const one = openTab(server, { tabId: "A" });
    const two = openTab(server, { tabId: "B" });
    one.update(addCategory("ca", "Problem sets"));
    two.update(addCategory("cb", "Midterm"));
    await drain();
    await one.checkRemote();
    await two.checkRemote();
    await drain();
    expect(categories(server.doc())).toEqual(["Midterm", "Problem sets"]);
    expect(one.workspace).toEqual(server.doc());
    expect(two.workspace).toEqual(server.doc());
  });

  it("hand assignments made on both sides are both kept", async () => {
    const server = new Server(ws());
    await server.write((d) => void (d.databases[0].grading = { categories: [{ id: "c1", course: "*", name: "HW", weight: 30 }] }));
    const one = openTab(server, { tabId: "A" });
    const two = openTab(server, { tabId: "B" });
    one.update((d) => void (d.databases[0].grading!.assign = { r1: "c1" }));
    two.update((d) => {
      d.databases[0].rows.push({ id: "r9", cells: { n: "HW 2" } });
      d.databases[0].grading!.assign = { r9: "c1" };
    });
    await drain();
    await one.checkRemote();
    await two.checkRemote();
    await drain();
    expect(server.doc().databases[0].grading?.assign).toEqual({ r1: "c1", r9: "c1" });
  });

  it("the agent adding a category while the student added one: both kept, the turn is not lost", async () => {
    const server = new Server(ws());
    const agent = await server.agentStart();
    const tab = openTab(server, { tabId: "A" });
    tab.update(addCategory("ca", "Labs"));
    await drain();
    await agent.apply(addCategory("cg", "Final exam"));
    expect(categories(server.doc())).toEqual(["Final exam", "Labs"]);
  });
});

describe("finding 8: reviews and answers recorded on two devices in the other order", () => {
  const deck = (): Workspace => {
    const w = ws();
    w.pages[0].blocks.push({
      id: "deck",
      type: "flashcards",
      cards: [
        {
          id: "c1",
          front: "Krebs cycle input",
          back: "acetyl-CoA",
          reps: 4,
          lapses: 0,
          stability: 12,
          difficulty: 5,
          state: "review",
          dueAt: "2026-11-12",
          lastReviewedAt: "2026-10-31T09:00:00.000Z",
        },
      ],
    } as Block);
    return w;
  };
  const ref = { pageId: "p1", blockId: "deck", cardId: "c1" };
  const card = (w: Workspace) => {
    const block = w.pages[0].blocks.find((x) => x.id === "deck");
    if (block?.type !== "flashcards") throw new Error("no deck");
    return block.cards[0];
  };
  const schedule = (w: Workspace) => {
    const c = card(w);
    return { reps: c.reps, lapses: c.lapses, stability: c.stability, due: c.dueAt, last: c.lastReviewedAt };
  };
  const morning = new Date("2026-11-12T07:40:00Z"); // phone, on the subway (offline): "again"
  const evening = new Date("2026-11-12T19:10:00Z"); // laptop: the card still shows as due: "good"

  it("a card failed on an offline phone in the morning and passed on the laptop in the evening keeps the lapse", async () => {
    const ideal = deck();
    applyGrade(ideal, ref, "again", morning);
    applyGrade(ideal, ref, "good", evening);
    expect(card(ideal).lapses).toBe(1);

    const server = new Server(deck());
    const phone = openTab(server, { tabId: "phone" });
    phone.net.offline = true;
    phone.update((d) => applyGrade(d, ref, "again", morning), { rebase: "rerun" });
    await advance(5_000);
    const laptop = openTab(server, { tabId: "laptop" });
    laptop.update((d) => applyGrade(d, ref, "good", evening), { rebase: "rerun" });
    await drain();
    phone.net.offline = false;
    phone.retry();
    await drain();
    expect(schedule(server.doc())).toEqual(schedule(ideal));
  });

  it("the same review recovered from the draft of a killed tab is re-run, not patched over a newer one", async () => {
    const ideal = deck();
    applyGrade(ideal, ref, "again", morning);
    applyGrade(ideal, ref, "good", evening);

    const server = new Server(deck());
    const storage = new MemoryStorage();
    const replayers = { grade: gradeReplayer };
    const phone = openTab(server, { tabId: "phone", storage, deps: { replayers } });
    phone.net.offline = true;
    phone.update((d) => applyGrade(d, ref, "again", morning), gradeOptions(ref, "again", morning));
    await advance(1_000);
    crash(phone); // the phone kills the tab; the review is only in its draft
    const laptop = openTab(server, { tabId: "laptop" });
    laptop.update((d) => applyGrade(d, ref, "good", evening), { rebase: "rerun" });
    await drain();
    await advance(TAB_ALIVE_MS);
    const reopened = openTab(server, { tabId: "phone2", storage, deps: { replayers } });
    await drain();
    expect(schedule(server.doc())).toEqual(schedule(ideal));
    expect(reopened.getSnapshot().merge).toBeNull();
  });

  it("an undone review that was not saved yet stays undone when the workspace changes elsewhere; redo brings it back", async () => {
    const server = new Server(deck());
    const tab = openTab(server, { tabId: "A" });
    tab.net.offline = true;
    tab.update((d) => applyGrade(d, ref, "again", morning), gradeOptions(ref, "again", morning));
    tab.update(setText("b1", "alpha, typed after the review"));
    expect(tab.undoTo(1)).toBe(true); // the review is taken back; the typing stays
    expect(card(tab.workspace).reviews ?? []).toEqual([]);
    await server.write(setText("b2", "beta from the phone")); // the workspace moves on
    tab.net.offline = false;
    tab.retry();
    await drain();
    // Replayed on the newer version, the review is not run again.
    expect(card(server.doc()).reviews ?? []).toEqual([]);
    expect(schedule(server.doc())).toEqual(schedule(deck()));
    expect(texts(server.doc()).slice(0, 2)).toEqual(["alpha, typed after the review", "beta from the phone"]);
    expect(tab.workspace).toEqual(server.doc());
    // Redo: the review is there again, once.
    expect(tab.redo()).toBe(true);
    await drain();
    expect((card(server.doc()).reviews ?? []).map((r) => r.id)).toEqual([morning.toISOString()]);
    expect(card(server.doc()).lapses).toBe(1);
  });

  const quiz = (): Workspace => {
    const w = ws();
    w.pages[0].blocks.push({
      id: "quiz",
      type: "quiz",
      questions: [{ id: "q1", kind: "true_false", prompt: "cells are alive", answerBool: true }],
    } as Block);
    return w;
  };
  const stats = (w: Workspace) => {
    const block = w.pages[0].blocks.find((x) => x.id === "quiz");
    return block?.type === "quiz" ? block.questions[0].stats : undefined;
  };
  const result = (correct: boolean) => [{ pageId: "p1", blockId: "quiz", questionId: "q1", key: "k", correct }];

  // Found by the harness (seed 14, "no faults" #696): the answer had been run
  // again on a newer version, so its recorded change no longer fitted and the
  // undo changed nothing on screen, while the answer was silently switched off.
  it("undoing an unsaved answer after the workspace changed elsewhere takes it off the screen at once", async () => {
    const server = new Server(quiz());
    const tab = openTab(server, { tabId: "A" });
    tab.net.offline = true;
    tab.update((d) => applyRunResults(d, result(false), undefined, evening.toISOString()), { rebase: "rerun" });
    // Another device answers the same question first.
    await server.write((d) => applyRunResults(d, result(true), undefined, morning.toISOString()));
    tab.net.offline = false;
    await tab.checkRemote();
    expect(stats(tab.workspace)).toMatchObject({ attempts: 2, correct: 1 });
    tab.net.offline = true; // (still unsaved)
    expect(tab.undo()).toBe(true);
    expect(stats(tab.workspace)).toMatchObject({ attempts: 1, correct: 1 });
    expect(tab.redo()).toBe(true); // still unsaved: switched on again
    expect(stats(tab.workspace)).toMatchObject({ attempts: 2, correct: 1 });
    expect(tab.undo()).toBe(true);
    tab.net.offline = false;
    tab.retry();
    await drain();
    expect(stats(server.doc())).toMatchObject({ attempts: 1, correct: 1 });
    expect(tab.workspace).toEqual(server.doc());
  });

  it("a quiz answered on two devices counts both runs, whichever saves first", async () => {
    const server = new Server(quiz());
    const phone = openTab(server, { tabId: "phone" });
    phone.net.offline = true;
    phone.update((d) => applyRunResults(d, result(false), undefined, morning.toISOString()), { rebase: "rerun" });
    await advance(5_000);
    const laptop = openTab(server, { tabId: "laptop" });
    laptop.update((d) => applyRunResults(d, result(true), undefined, evening.toISOString()), { rebase: "rerun" });
    await drain();
    phone.net.offline = false;
    phone.retry();
    await drain();
    expect(stats(server.doc())).toMatchObject({ attempts: 2, correct: 1, lastAnsweredAt: evening.toISOString() });
  });
});

describe("finding 10: tabs of one browser", () => {
  it("S7: a duplicated tab is a tab of its own (ids are never reused), so removed text stays removed", async () => {
    const server = new Server(ws());
    const storage = new MemoryStorage();
    // As the editor makes them: no id passed in, one per page load.
    const open = () => openTab(server, { storage });
    const original = open();
    original.update(setText("b1", "alpha from A"), "f");
    freeze(original.net); // frozen before its save: nothing leaves, no sign of life
    await advance(100_000);
    const duplicate = open();
    expect(duplicate.tabId).not.toBe(original.tabId);
    await drain();
    expect(b(duplicate.workspace, "b1")).toBe("alpha from A"); // taken over from the frozen tab
    duplicate.update(setText("b1", "alpha"), "g"); // the student removes the words here
    await drain();
    thaw(original.net); // the original wakes
    original.heartbeat();
    void original.flush();
    await drain();
    await duplicate.checkRemote();
    await drain();
    expect(b(server.doc(), "b1")).toBe("alpha");
    expect(original.workspace).toEqual(server.doc());
  });

  it("a crashed tab's draft adopted minutes later does not win over values set since", async () => {
    const server = new Server(ws());
    const storage = new MemoryStorage();
    const crashed = openTab(server, { tabId: "A", storage });
    crashed.net.offline = true;
    crashed.update(setX(5));
    crashed.update(setText("b1", "alpha, typed before the crash"));
    await advance(500);
    crash(crashed);
    const other = openTab(server, { tabId: "B", storage });
    await drain();
    other.update(setX(9)); // set minutes later, on purpose
    await drain();
    await advance(TAB_ALIVE_MS);
    other.adoptOrphans();
    await drain();
    expect(cellX(server.doc())).toBe(9); // the newer value stays
    expect(b(server.doc(), "b1")).toBe("alpha, typed before the crash"); // what does not collide is recovered
    const merge = other.getSnapshot().merge;
    expect(merge?.source).toBe("draft");
    expect(merge?.report.unapplied.map((u) => [u.mine, u.theirs])).toEqual([[5, 9]]);
    other.applyMine(); // "use my values": the recovered one, if the student wants it
    await drain();
    expect(cellX(server.doc())).toBe(5);
  });

  // Found by the harness (seed 11, "study edits" #738 and "server writers"
  // #114; seed 12, "server writers" #760): the value looked untouched (set
  // and undone meanwhile), so the recovered one replaced it with nothing but
  // a toast; the same for a block deleted in the dead tab and restored since.
  it("a recovered edit never replaces or removes what may have been changed and changed back since", async () => {
    const server = new Server(ws());
    const storage = new MemoryStorage();
    const crashed = openTab(server, { tabId: "A", storage });
    crashed.net.offline = true;
    crashed.update(setX(30));
    crashed.update((d) => void (d.pages[0].blocks = d.pages[0].blocks.filter((x) => x.id !== "b2")));
    crashed.update(setText("b1", "alpha, and what I typed before the crash"));
    await advance(500);
    crash(crashed);
    const next = openTab(server, { tabId: "B", storage });
    await drain();
    next.update(setX(60)); // the student sets it here...
    next.undo(); // ...and takes that back: 0 again, on purpose
    await drain();
    await advance(TAB_ALIVE_MS);
    next.adoptOrphans();
    await drain();
    // What only adds is recovered; the value and the paragraph stay as they are.
    expect(texts(server.doc())).toEqual(["alpha, and what I typed before the crash", "beta"]);
    expect(cellX(server.doc())).toBe(0);
    const merge = next.getSnapshot().merge;
    expect(merge?.source).toBe("draft");
    expect(merge?.report.unapplied.map((u) => [u.mine, u.theirs])).toEqual([[30, 0]]);
    expect(merge?.report.skipped).toBe(1); // the deletion was not repeated, and the banner says so
    next.applyMine(); // "use my values for those"
    await drain();
    expect(cellX(server.doc())).toBe(30);
  });

  it("a tab closed with unsaved edits and opened again, nothing else having happened: all of it applies", async () => {
    const server = new Server(ws());
    const storage = new MemoryStorage();
    const tab = openTab(server, { tabId: "A", storage });
    tab.net.offline = true;
    tab.update(setX(30));
    tab.update((d) => void (d.pages[0].blocks = d.pages[0].blocks.filter((x) => x.id !== "b2")));
    tab.update(setText("b1", "rewritten"));
    await advance(900); // a save was tried and did not get through
    crash(tab, true);
    const again = openTab(server, { tabId: "B", storage });
    await drain();
    expect(texts(server.doc())).toEqual(["rewritten"]);
    expect(cellX(server.doc())).toBe(30);
    expect(again.getSnapshot().merge).toBeNull();
    expect(again.notices).toContain("draftRestored");
  });

  // Found by the harness (seed 12, "one browser" #653).
  it("a tab whose edits were taken over is still told when a value it typed is changed elsewhere afterwards", async () => {
    const server = new Server(ws());
    const storage = new MemoryStorage();
    const asleep = openTab(server, { tabId: "A", storage });
    freeze(asleep.net); // frozen in the background: nothing gets out, no sign of life
    asleep.update(setX(50));
    await advance(TAB_ALIVE_MS + 1_000);
    const other = openTab(server, { tabId: "B", storage }); // takes its draft over and saves it
    await drain();
    expect(cellX(server.doc())).toBe(50);
    thaw(asleep.net);
    asleep.heartbeat(); // it wakes up
    await asleep.checkRemote();
    await drain();
    expect(cellX(asleep.workspace)).toBe(50);
    other.update(setX(41)); // changed in the other tab afterwards
    await drain();
    await asleep.checkRemote();
    await drain();
    expect(asleep.getSnapshot().merge?.replaced.map((r) => [r.mine, r.theirs])).toEqual([[50, 41]]);
  });

  // Found by the harness (seed 18, "one browser" #798).
  it("a tab whose edits were taken over and not put in is told which values, on its own screen", async () => {
    const server = new Server(ws());
    const storage = new MemoryStorage();
    const asleep = openTab(server, { tabId: "A", storage });
    freeze(asleep.net);
    asleep.update(setX(50));
    const other = openTab(server, { tabId: "B", storage });
    other.update(setText("b2", "beta, typed in the other tab")); // edited here since: nothing is "as left"
    await drain();
    await advance(TAB_ALIVE_MS + 1_000);
    other.adoptOrphans(); // takes the sleeping tab's draft over; its value is only offered
    await drain();
    expect(cellX(server.doc())).toBe(0);
    expect(other.getSnapshot().merge?.report.unapplied.map((u) => [u.mine, u.theirs])).toEqual([[50, 0]]);
    thaw(asleep.net);
    asleep.heartbeat(); // it wakes up: its edits are the other tab's now
    await asleep.checkRemote();
    await drain();
    expect(cellX(asleep.workspace)).toBe(0);
    expect(asleep.getSnapshot().merge?.replaced.map((r) => [r.mine, r.theirs])).toEqual([[50, 0]]);
    asleep.applyMine(); // "use my values for those"
    await drain();
    expect(cellX(server.doc())).toBe(50);
  });

  // Found by the harness (seed 16, "one browser" #522).
  it("a tab whose edits were taken over cannot undo or redo steps that are no longer its own", async () => {
    const server = new Server(ws());
    const storage = new MemoryStorage();
    const asleep = openTab(server, { tabId: "A", storage });
    asleep.update(setText("b1", "alpha [A20]"));
    await drain();
    freeze(asleep.net);
    asleep.undo(); // "[A20]" taken out again; not saved yet
    await advance(TAB_ALIVE_MS + 1_000);
    const other = openTab(server, { tabId: "B", storage }); // takes the undo over and saves it
    await drain();
    expect(b(server.doc(), "b1")).toBe("alpha");
    thaw(asleep.net);
    asleep.heartbeat();
    // Redoing here would put the words back as a new edit, behind the other tab's back.
    expect(asleep.redo()).toBe(false);
    await asleep.checkRemote();
    await drain();
    expect(b(server.doc(), "b1")).toBe("alpha");
    expect(asleep.workspace).toEqual(server.doc());
    expect(other.workspace).toEqual(server.doc());
  });
});

describe("browser QA of the same build", () => {
  it("two tabs editing one paragraph without overlapping end up with one merged paragraph", async () => {
    const server = new Server(ws());
    const one = openTab(server, { tabId: "A" });
    const two = openTab(server, { tabId: "B" });
    // Typed letter by letter, about a second apart: one appends, the other inserts at the start.
    for (const [i, ch] of [..."tail"].entries()) {
      one.update(setText("b1", `alpha${"tail".slice(0, i)}${ch}`), "f");
      await advance(120);
    }
    await advance(400);
    for (const [i, ch] of [..."head"].entries()) {
      two.update(setText("b1", `${"head".slice(0, i)}${ch}alpha`), "f");
      await advance(120);
    }
    await drain();
    await one.checkRemote();
    await drain();
    expect(texts(server.doc())).toEqual(["headalphatail", "beta"]);
    expect(one.workspace).toEqual(server.doc());
    expect(two.workspace).toEqual(server.doc());
  });

  it("the same field changed on two devices: both are told, each about that field", async () => {
    const server = new Server(ws());
    const laptop = openTab(server, { tabId: "laptop" });
    const phone = openTab(server, { tabId: "phone" });
    phone.net.offline = true;
    phone.update(setX(1)); // on the train, unsaved
    await advance(2_000);
    laptop.update(setX(2)); // later, and saved
    await drain();
    phone.net.offline = false;
    phone.retry();
    await drain();
    await laptop.checkRemote();
    await drain();
    expect(cellX(server.doc())).toBe(1);
    // The device whose value won is told what it replaced...
    expect(phone.getSnapshot().merge?.report.overwritten.map((o) => [o.mine, o.theirs])).toEqual([[1, 2]]);
    // ...and the device whose value was replaced is told too, on its own screen.
    const told = laptop.getSnapshot().merge;
    expect(told?.replaced.map((o) => [o.mine, o.theirs])).toEqual([[2, 1]]);
    laptop.applyMine();
    await drain();
    expect(cellX(server.doc())).toBe(2);
  });

  it("choosing a kept version is an edit, not a deletion, and undo and redo both work", async () => {
    const start = ws();
    start.pages[0].blocks.splice(1, 0, { id: "k1", type: "paragraph", text: "alpha, the other version", keptFrom: "b1" } as Block);
    const server = new Server(start);
    const tab: Tab = openTab(server, { tabId: "A" });
    // KeptCopyNote's "use this version".
    tab.update((d) => {
      const page = d.pages[0];
      const copy = page.blocks.find((x) => x.id === "k1") as { text: string };
      (page.blocks.find((x) => x.id === "b1") as { text: string }).text = copy.text;
      page.blocks = page.blocks.filter((x) => x.id !== "k1");
    });
    expect(tab.removals).toEqual([]); // no "Block deleted" toast
    expect(texts(tab.workspace)).toEqual(["alpha, the other version", "beta"]);
    expect(tab.undo()).toBe(true);
    expect(texts(tab.workspace)).toEqual(["alpha", "alpha, the other version (kept)", "beta"]);
    expect(tab.redo()).toBe(true);
    expect(texts(tab.workspace)).toEqual(["alpha, the other version", "beta"]);
    await drain();
    expect(tab.workspace).toEqual(server.doc());
  });
});
