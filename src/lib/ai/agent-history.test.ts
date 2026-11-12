import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Workspace } from "@/lib/workspace/types";

const db = vi.hoisted(() => ({
  workspace: { findFirst: vi.fn() },
  agentChatMessage: { findMany: vi.fn(), create: vi.fn(), deleteMany: vi.fn() },
  workspaceChange: { findMany: vi.fn(), findFirst: vi.fn() },
}));
vi.mock("@/lib/db", () => ({ prisma: db }));

import {
  appendChatMessages,
  clearChat,
  loadChat,
  loadModelHistory,
  loadUndoStates,
  revertStillApplies,
  toHistoryItem,
  undoStates,
  windowHistory,
  type StoredChatRow,
} from "./agent-history";

const at = (n: number) => new Date(Date.UTC(2026, 10, 12, 0, 0, n));
function row(n: number, role: string, content: string, extra: Partial<StoredChatRow> = {}): StoredChatRow {
  return { id: `m${n}`, role, content, modelContent: null, changeNote: null, changeId: null, meta: null, createdAt: at(n), ...extra };
}

beforeEach(() => {
  for (const group of Object.values(db)) for (const fn of Object.values(group)) fn.mockReset();
});

describe("windowHistory (what the model sees)", () => {
  it("keeps the newest messages within the count, oldest first", () => {
    const rows = Array.from({ length: 14 }, (_, i) => row(i, i % 2 ? "assistant" : "user", `msg ${i}`));
    const window = windowHistory(rows, {}, { maxMessages: 4, maxChars: 10_000, perMessageChars: 500 });
    expect(window.map((m) => m.content)).toEqual(["msg 10", "msg 11", "msg 12", "msg 13"]);
  });

  it("stops at the character budget and clips long messages", () => {
    const rows = [row(1, "user", "a".repeat(300)), row(2, "assistant", "b".repeat(300)), row(3, "user", "c".repeat(5_000))];
    const window = windowHistory(rows, {}, { maxMessages: 10, maxChars: 900, perMessageChars: 500 });
    expect(window).toHaveLength(2);
    expect(window[1].content.length).toBe(500);
    expect(window[0].content).toBe("b".repeat(300));
  });

  it("uses the model's text for a choice and carries the change note for follow-ups", () => {
    const rows = [
      row(1, "user", "Chemistry", { modelContent: "the CHEM110 course" }),
      row(2, "assistant", "Added the quiz.", {
        changeNote: 'added row [r_9] "Quiz Ch. 3" · 2026-11-20 to [db_assign] Assignments',
        changeId: "c1",
      }),
      row(3, "assistant", "Renamed it.", { changeNote: "update page [p1]", changeId: "c2" }),
    ];
    const window = windowHistory(rows, { c2: "undone" });
    expect(window[0]).toEqual({ role: "user", content: "the CHEM110 course" });
    // The note travels apart from the reply so the agent loop can fence it as data.
    expect(window[1].content).toBe("Added the quiz.");
    expect(window[1].note).toContain("added row [r_9]");
    expect(window[2].note).toContain("the student later undid this");
  });
});

describe("undo availability", () => {
  it("is available exactly while the change is the latest version and not undone", () => {
    const states = undoStates(
      [
        { id: "a", kind: "agent", undoneAt: null, afterVersion: 7 },
        { id: "b", kind: "agent", undoneAt: null, afterVersion: 5 },
        { id: "c", kind: "agent", undoneAt: new Date(), afterVersion: 6 },
        { id: "u", kind: "undo", undoneAt: null, afterVersion: 7 },
      ],
      7,
    );
    expect(states).toEqual({ a: "available", b: "unavailable", c: "undone" });
  });

  it("a change whose record is gone (pruned) is unavailable", () => {
    const item = toHistoryItem(row(1, "assistant", "Done", { changeId: "gone", meta: '{"changed":true}' }), {});
    expect(item).toMatchObject({ changeId: "gone", undo: "unavailable", changed: true });
  });
});

describe("persistence (owner-scoped)", () => {
  it("restores the chat with live undo states, scoped to the owner and a live workspace", async () => {
    db.workspace.findFirst.mockResolvedValue({ version: 4 });
    db.agentChatMessage.findMany.mockResolvedValue([
      row(2, "assistant", "Sorted.", { changeId: "c1", meta: '{"changed":true,"creditsCost":2}' }),
      row(1, "user", "sort by due"),
    ]);
    db.workspaceChange.findMany.mockResolvedValue([{ id: "c1", kind: "agent", undoneAt: null, afterVersion: 4 }]);

    const items = await loadChat("user_1", "ws_1");
    expect(items?.map((i) => i.content)).toEqual(["sort by due", "Sorted."]);
    expect(items?.[1]).toMatchObject({ undo: "available", creditsCost: 2, changed: true });

    const wsQuery = db.workspace.findFirst.mock.calls[0][0];
    expect(wsQuery.where).toMatchObject({ id: "ws_1", ownerId: "user_1", deletedAt: null });
    expect(db.agentChatMessage.findMany.mock.calls[0][0].where).toEqual({ userId: "user_1", workspaceId: "ws_1" });
    expect(db.workspaceChange.findMany.mock.calls[0][0].where).toMatchObject({ ownerId: "user_1", workspaceId: "ws_1" });
  });

  it("hides the chat of a trashed or foreign workspace", async () => {
    db.workspace.findFirst.mockResolvedValue(null);
    expect(await loadChat("user_1", "ws_trashed")).toBeNull();
    expect(await loadModelHistory("user_1", "ws_trashed")).toEqual([]);
    expect(db.agentChatMessage.findMany).not.toHaveBeenCalled();
  });

  it("stores messages in order and only keeps modelContent when it differs", async () => {
    db.agentChatMessage.create.mockResolvedValue({});
    await appendChatMessages("user_1", "ws_1", [
      { role: "user", content: "Chemistry", modelContent: "the CHEM110 course" },
      { role: "assistant", content: "Done", modelContent: "Done", changeId: "c1", meta: { changed: true } },
    ]);
    const [first, second] = db.agentChatMessage.create.mock.calls.map((c) => c[0].data);
    expect(first).toMatchObject({ userId: "user_1", workspaceId: "ws_1", role: "user", modelContent: "the CHEM110 course" });
    expect(second).toMatchObject({ role: "assistant", modelContent: null, changeId: "c1", meta: '{"changed":true}' });
  });

  it("clears only this owner's conversation for this workspace", async () => {
    db.agentChatMessage.deleteMany.mockResolvedValue({ count: 3 });
    expect(await clearChat("user_1", "ws_1")).toBe(3);
    expect(db.agentChatMessage.deleteMany).toHaveBeenCalledWith({ where: { userId: "user_1", workspaceId: "ws_1" } });
  });
});

describe("Undo stays offered while the server can honour it", () => {
  const doc = (agentText: string, other: string): Workspace => ({
    id: "ws_1",
    name: "W",
    pages: [
      {
        id: "p1",
        title: "Notes",
        blocks: [
          { id: "b1", type: "paragraph", text: agentText },
          { id: "b2", type: "paragraph", text: other },
        ],
      },
    ],
    databases: [],
  }) as unknown as Workspace;
  const before = doc("Picture every force.", "Second paragraph.");
  const after = doc("Draw every force.", "Second paragraph.");

  it("a later edit elsewhere leaves the agent's change revertible", () => {
    expect(revertStillApplies(before, after, doc("Draw every force.", "Second paragraph, edited."))).toBe(true);
  });

  it("the QA case: typing kept in place over the agent's edit (its version in a copy) is still revertible", () => {
    // The student typed into the text the agent had not seen yet; the merge kept their version in place.
    expect(revertStillApplies(before, after, doc("Picture every force TYPED-DURING-AGENT.", "Second paragraph."))).toBe(true);
  });

  it("a later change of the very words the agent changed is not", () => {
    expect(revertStillApplies(before, after, doc("Sketch every force.", "Second paragraph."))).toBe(false);
  });

  it("the re-check reports the newest change available after unrelated saves", async () => {
    db.workspace.findFirst
      .mockResolvedValueOnce({ version: 6 }) // the live version
      .mockResolvedValueOnce({ data: JSON.stringify(doc("Draw every force.", "Edited later.")) });
    db.agentChatMessage.findMany.mockResolvedValue([row(2, "assistant", "Done.", { changeId: "c1" })]);
    db.workspaceChange.findMany.mockResolvedValue([{ id: "c1", kind: "agent", undoneAt: null, afterVersion: 5 }]);
    db.workspaceChange.findFirst.mockResolvedValue({ beforeData: JSON.stringify(before), afterData: JSON.stringify(after) });
    expect(await loadUndoStates("user_1", "ws_1")).toEqual({ c1: "available" });
    expect(db.workspaceChange.findFirst.mock.calls[0][0].where).toMatchObject({ id: "c1", ownerId: "user_1" });
  });

  it("and unavailable when what was saved since collides with it", async () => {
    db.workspace.findFirst
      .mockResolvedValueOnce({ version: 6 })
      .mockResolvedValueOnce({ data: JSON.stringify(doc("Sketch every force.", "Second paragraph.")) });
    db.agentChatMessage.findMany.mockResolvedValue([row(2, "assistant", "Done.", { changeId: "c1" })]);
    db.workspaceChange.findMany.mockResolvedValue([{ id: "c1", kind: "agent", undoneAt: null, afterVersion: 5 }]);
    db.workspaceChange.findFirst.mockResolvedValue({ beforeData: JSON.stringify(before), afterData: JSON.stringify(after) });
    expect(await loadUndoStates("user_1", "ws_1")).toEqual({ c1: "unavailable" });
  });
});