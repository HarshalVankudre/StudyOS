// @vitest-environment node
/**
 * Second sync review, end to end: the engine against the real store and
 * version service (on an in-memory database, see sync-sim/harness.ts).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as vs from "@/lib/workspace/version-service";
import type { Workspace } from "@/lib/workspace/types";
import { MemoryStorage, Server, advance, crash, db, drain, openTab } from "./sync-sim/harness";
import { draftKey, takenKey, type SaveResult } from "./workspace-sync";

vi.mock("@/lib/db", async () => {
  const { createMemoryPrisma } = await import("./sync-sim/memory-prisma");
  return { prisma: createMemoryPrisma() };
});
vi.mock("@clerk/nextjs/server", () => ({ auth: async () => ({ userId: "u1" }) }));
vi.mock("@/lib/ops/report-error", () => ({ reportError: () => {} }));

function ws(): Workspace {
  return {
    id: "w1",
    name: "W",
    pages: [{ id: "p1", title: "Home", blocks: [{ id: "b1", type: "paragraph", text: "cells divide" }] }],
    databases: [],
  };
}
const text = (w: Workspace, id = "b1") =>
  (w.pages[0].blocks.find((b) => b.id === id) as { text?: string } | undefined)?.text;
const setText = (id: string, value: string) => (d: Workspace) => {
  const b = d.pages[0].blocks.find((x) => x.id === id) as { text?: string } | undefined;
  if (b) b.text = value;
};

beforeEach(() => {
  vi.useFakeTimers({ now: Date.UTC(2026, 10, 12, 9, 0, 0) });
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
});

describe("F1: save ids tell whether a save without a reply landed", () => {
  it("a lost reply: the next save does not apply the edit a second time", async () => {
    const server = new Server(ws());
    const a = openTab(server);
    a.update(setText("b1", "cells divide [A1]"));
    server.dropReplies = 1;
    await advance(1_000); // saved as v2, reply lost
    a.update(setText("b1", "cells divide [A1] [A2]"));
    await drain();
    expect(text(server.doc())).toBe("cells divide [A1] [A2]");
    expect(server.version).toBe(3);
    expect(a.getSnapshot()).toMatchObject({ status: "saved", merge: null, dirty: false });
  });

  it("a draft whose save landed is recovered without its saved part", async () => {
    const server = new Server(ws());
    const storage = new MemoryStorage();
    const a = openTab(server, { storage, tabId: "A" });
    a.update(setText("b1", "cells divide [A1]"));
    server.dropReplies = 1;
    await advance(1_000); // landed, reply lost: the draft records its save id
    a.update(setText("b1", "cells divide [A1] [A2]")); // not sent yet
    crash(a);
    // Someone else edits meanwhile.
    const c = openTab(server);
    c.update(setText("b1", "most cells divide [A1]"));
    await drain();
    await advance(100_000);
    const b = openTab(server, { storage, tabId: "B" });
    await drain();
    expect(text(server.doc())).toBe("most cells divide [A1] [A2]");
    expect(text(b.workspace)).toBe("most cells divide [A1] [A2]");
    expect(b.getSnapshot().merge?.report.keptBoth ?? 0).toBe(0);
    expect(storage.data.has(draftKey("w1", "A"))).toBe(false);
  });

  it("during a deploy, a server without save ids: the tab still recognises its own save", async () => {
    const server = new Server(ws());
    const stripIds = <T>(r: T): T => {
      if (r && typeof r === "object" && "saves" in r) delete (r as { saves?: unknown }).saves;
      return r;
    };
    const a = openTab(server, {
      deps: {
        save: async (...args: Parameters<Server["save"]>) => stripIds(await server.save(...args)) as SaveResult,
        fetchState: async (id: string) => stripIds(await server.fetchState(id)),
      },
    });
    a.update(setText("b1", "cells divide [A1]"));
    server.dropReplies = 1;
    await advance(1_000);
    a.update(setText("b1", "cells divide [A1] [A2]"));
    await drain();
    expect(text(server.doc())).toBe("cells divide [A1] [A2]");
  });

  // Third review: the closing-tab request that applied a patch on the server
  // is gone. Closing sends nothing but an ordinary save; what that does not
  // get through stays in the draft and is merged when the workspace is
  // opened in this browser again.
  it("a tab that closes mid-edit leaves the edit in its draft; the next tab here saves it once", async () => {
    const server = new Server(ws());
    const storage = new MemoryStorage();
    const a = openTab(server, { storage, tabId: "A" });
    a.net.offline = true; // the save started on leaving does not get through
    a.update(setText("b1", "cells divide [A1]"));
    expect(a.prepareToLeave()).toBe(false); // unsaved: the leave prompt is shown
    a.releaseTab();
    crash(a, true);
    await advance(50);
    expect(server.version).toBe(1); // nothing reached the server
    expect([...storage.data.keys()].some((k) => k.startsWith("studyos:draft:"))).toBe(true);

    const b = openTab(server, { storage, tabId: "B" });
    await drain();
    expect(text(server.doc())).toBe("cells divide [A1]");
    expect(text(b.workspace)).toBe("cells divide [A1]");
    expect(b.notices).toContain("draftRestored");
    expect([...storage.data.keys()].some((k) => k.startsWith("studyos:draft:"))).toBe(false);
  });
});

describe("handing edits over: a tab asleep while another took its draft", () => {
  it("the sleeping tab neither saves nor replays them when it wakes", async () => {
    const server = new Server(ws());
    const storage = new MemoryStorage();
    const a = openTab(server, { storage, tabId: "A" });
    a.setAgentBusy(true); // saving paused: the edit stays unsaved
    a.update(setText("b1", "cells divide [A1]"));
    await advance(100_000); // frozen in the background: no sign of life
    const b = openTab(server, { storage, tabId: "B" });
    await drain();
    expect(text(server.doc())).toBe("cells divide [A1]");
    expect(storage.data.has(takenKey("w1", a.tabId))).toBe(true);
    // A wakes up.
    a.heartbeat();
    a.setAgentBusy(false);
    await drain();
    a.update(setText("b1", `${text(a.workspace)} [A2]`));
    await drain();
    expect(text(server.doc())).toBe("cells divide [A1] [A2]");
    expect(text(a.workspace)).toBe(text(server.doc()));
    await b.checkRemote(); // (the tabs' broadcast channel)
    expect(text(b.workspace)).toBe(text(server.doc()));
  });
});

describe("F10: an agent write keeps fields this version does not know", () => {
  it("unknown fields of the stored document survive", async () => {
    const stored = { ...ws(), futureSetting: { theme: "x" } } as Workspace;
    stored.pages[0].blocks[0] = { ...stored.pages[0].blocks[0], futureFlag: true } as never;
    const server = new Server(stored);
    const snap = await vs.getWorkspaceSnapshot("w1");
    const next = structuredClone(snap!.workspace);
    // The agent's result is parsed by the strict schema, which strips what it does not know.
    delete (next as unknown as Record<string, unknown>).futureSetting;
    delete (next.pages[0].blocks[0] as unknown as Record<string, unknown>).futureFlag;
    (next.pages[0].blocks[0] as { text: string }).text = "cells divide by mitosis";
    await vs.applyAgentWorkspaceChange("w1", snap!.version, next, snap!.workspace);
    const row = db.workspace.rows[0] as { data: string };
    const data = JSON.parse(row.data);
    expect(data.futureSetting).toEqual({ theme: "x" });
    expect(data.pages[0].blocks[0]).toMatchObject({ futureFlag: true, text: "cells divide by mitosis" });
    expect(server.version).toBe(2);
  });
});
