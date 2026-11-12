import { describe, expect, it } from "vitest";
import type { Database, Workspace } from "@/lib/workspace/types";
import { applyCompletion, reconcilePlanItems, writesThrough } from "./reconcile";
import type { DailyStudyPlanItem } from "./types";

const TODAY = "2026-11-13";

function db(status: string | boolean = "doing"): Database {
  return {
    id: "db",
    name: "Assignments",
    properties: [
      { id: "title", name: "Name", type: "text" },
      { id: "due", name: "Due", type: "date" },
      {
        id: "status",
        name: "Status",
        type: "status",
        options: [
          { id: "todo", label: "To do" },
          { id: "doing", label: "In progress" },
          { id: "done", label: "Done" },
        ],
      },
    ],
    rows: [{ id: "row", cells: { title: "Essay", due: TODAY, status: status as string } }],
    views: [{ id: "v", name: "Table", type: "table" }],
  };
}

function ws(overrides: Partial<Workspace> = {}): Workspace {
  return {
    id: "ws",
    name: "HQ",
    pages: [
      {
        id: "page",
        title: "Home",
        blocks: [
          { id: "todo", type: "todo", text: "Email tutor", checked: false },
          {
            id: "deck",
            type: "flashcards",
            cards: [
              { id: "a", front: "a", back: "a", state: "review", dueAt: "2026-11-20", lastReviewedAt: "2026-11-12T23:30:00.000Z", reps: 1 },
              { id: "b", front: "b", back: "b", state: "review", dueAt: TODAY, reps: 1 },
              { id: "c", front: "c", back: "", state: "review", dueAt: TODAY, reps: 1 },
            ],
          },
          { id: "quiz", type: "quiz", questions: [], attempts: [{ at: "2026-11-13T08:00:00.000Z", mode: "practice", score: 3, total: 4 }] },
        ],
      },
    ],
    databases: [db()],
    ...overrides,
  };
}

function item(overrides: Partial<DailyStudyPlanItem>): DailyStudyPlanItem {
  return {
    id: "x",
    kind: "task",
    mode: "finish",
    title: "T",
    workspaceName: "HQ",
    section: "Home",
    target: { workspaceId: "ws", pageId: "page", blockId: "todo" },
    minutes: 15,
    reason: { code: "open_task" },
    completed: false,
    ...overrides,
  };
}

const rowItem = (o: Partial<DailyStudyPlanItem> = {}) =>
  item({
    id: "deadline:ws:db:row",
    kind: "deadline",
    target: { workspaceId: "ws", pageId: "page", databaseId: "db", rowId: "row" },
    reason: { code: "due_today" },
    ...o,
  });

describe("reconcilePlanItems", () => {
  it("follows the to-do checkbox and the row's done status for finish items", () => {
    const w = ws();
    w.pages[0].blocks[0] = { id: "todo", type: "todo", text: "Email tutor", checked: true };
    w.databases[0] = db("done");
    const { items, changed } = reconcilePlanItems([item({}), rowItem()], [w], TODAY, "UTC");
    expect(changed).toBe(true);
    expect(items.map((i) => i.completed)).toEqual([true, true]);
    expect(items[0].completedAt).toBeDefined();

    // Unchecked in the editor: the plan follows.
    const back = reconcilePlanItems(items, [ws()], TODAY, "UTC");
    expect(back.items.map((i) => i.completed)).toEqual([false, false]);
  });

  it("keeps a session item's own check, and completes it when the row gets done", () => {
    const session = rowItem({ mode: "session", completed: true });
    expect(reconcilePlanItems([session], [ws()], TODAY, "UTC").items[0].completed).toBe(true);
    const open = rowItem({ mode: "session" });
    const w = ws({ databases: [db("done")] });
    expect(reconcilePlanItems([open], [w], TODAY, "UTC").items[0].completed).toBe(true);
  });

  it("completes a deck item when the planned cards were studied today, in the student's time zone", () => {
    const deckItem = item({
      id: "flashcards:ws:page:deck",
      kind: "flashcards",
      mode: "study",
      target: { workspaceId: "ws", pageId: "page", blockId: "deck" },
      dueCount: 1,
      reason: { code: "cards_due", count: 1 },
    });
    // 23:30 UTC on the 12th is already the 13th in Berlin, but not in New York.
    const berlin = reconcilePlanItems([deckItem], [ws()], TODAY, "Europe/Berlin").items[0];
    expect(berlin).toMatchObject({ completed: true, progress: { done: 1, total: 1 } });
    const newYork = reconcilePlanItems([deckItem], [ws()], TODAY, "America/New_York").items[0];
    expect(newYork).toMatchObject({ completed: false, progress: { done: 0, total: 1 } });
  });

  it("completes a quiz item when a quiz was taken today", () => {
    const quizItem = item({
      id: "exam:ws:db:row:quiz",
      kind: "quiz",
      mode: "study",
      target: { workspaceId: "ws", pageId: "page", blockId: "quiz" },
      reason: { code: "exam_review", days: 3 },
    });
    expect(reconcilePlanItems([quizItem], [ws()], TODAY, "UTC").items[0].completed).toBe(true);
    expect(reconcilePlanItems([quizItem], [ws()], "2026-11-14", "UTC").items[0].completed).toBe(false);
  });

  it("drops open items whose source was deleted, and keeps finished ones", () => {
    const gone = item({ target: { workspaceId: "ws", pageId: "page", blockId: "missing" } });
    const doneGone = { ...gone, id: "y", completed: true };
    const { items } = reconcilePlanItems([gone, doneGone], [ws()], TODAY, "UTC");
    expect(items.map((i) => i.id)).toEqual(["y"]);
  });
});

describe("applyCompletion (write-through)", () => {
  it("checks and unchecks a to-do", () => {
    const w = ws();
    expect(applyCompletion(w, item({}), true)).toEqual({ changed: true, applied: true });
    expect(w.pages[0].blocks[0]).toMatchObject({ checked: true });
    expect(applyCompletion(w, item({}), false).changed).toBe(true);
    expect(w.pages[0].blocks[0]).toMatchObject({ checked: false });
  });

  it("sets the row's done value and restores the previous value on undo", () => {
    const w = ws();
    const result = applyCompletion(w, rowItem(), true);
    expect(result).toEqual({ changed: true, applied: true, restore: "doing" });
    expect(w.databases[0].rows[0].cells.status).toBe("done");

    applyCompletion(w, rowItem({ restore: "doing" }), false);
    expect(w.databases[0].rows[0].cells.status).toBe("doing");

    // Without a remembered value, reopening uses the first open option.
    const w2 = ws({ databases: [db("done")] });
    applyCompletion(w2, rowItem(), false);
    expect(w2.databases[0].rows[0].cells.status).toBe("todo");
  });

  it("uses a Done checkbox column when there is no status", () => {
    const w = ws({
      databases: [
        {
          ...db(),
          properties: [
            { id: "title", name: "Name", type: "text" },
            { id: "check", name: "Done", type: "checkbox" },
          ],
          rows: [{ id: "row", cells: { title: "Essay", check: false } }],
        },
      ],
    });
    expect(applyCompletion(w, rowItem(), true).applied).toBe(true);
    expect(w.databases[0].rows[0].cells.check).toBe(true);
  });

  it("reports when a row cannot be completed (no done column)", () => {
    const w = ws({
      databases: [
        { ...db(), properties: [{ id: "title", name: "Name", type: "text" }], rows: [{ id: "row", cells: { title: "Essay" } }] },
      ],
    });
    expect(applyCompletion(w, rowItem(), true)).toEqual({ changed: false, applied: false });
  });

  it("only writes through where that makes sense", () => {
    expect(writesThrough(item({}))).toBe(true);
    expect(writesThrough(rowItem())).toBe(true);
    expect(writesThrough(rowItem({ mode: "session" }))).toBe(false);
    expect(writesThrough(rowItem({ mode: "session" }), true)).toBe(true);
    expect(writesThrough(item({ kind: "flashcards", mode: "study", target: { workspaceId: "ws", blockId: "deck" } }))).toBe(false);
  });
});
