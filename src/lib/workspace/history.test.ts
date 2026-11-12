import { describe, expect, it } from "vitest";
import {
  COALESCE_MS,
  canRedo,
  canUndo,
  commit,
  createHistory,
  detectRemoval,
  redo,
  undo,
  undoStep,
} from "./history";
import type { Workspace } from "./types";

function ws(): Workspace {
  return {
    id: "w",
    name: "W",
    pages: [
      {
        id: "p1",
        title: "Home",
        blocks: [
          { id: "b1", type: "paragraph", text: "one" },
          {
            id: "deck",
            type: "flashcards",
            cards: [
              { id: "c1", front: "Q", back: "A" },
              { id: "c2", front: "Q2", back: "A2" },
            ],
          },
        ],
      },
      { id: "p2", title: "Notes", blocks: [] },
    ],
    databases: [
      {
        id: "db",
        name: "Tasks",
        properties: [
          { id: "name", name: "Name", type: "text" },
          { id: "due", name: "Due", type: "date" },
        ],
        rows: [
          { id: "r1", cells: { name: "a", due: "2026-01-01" } },
          { id: "r2", cells: { name: "b", due: "2026-01-02" } },
        ],
        views: [{ id: "v", name: "Table", type: "table" }],
      },
    ],
  };
}

function edit(w: Workspace, fn: (d: Workspace) => void): Workspace {
  const next = structuredClone(w);
  fn(next);
  return next;
}

describe("history", () => {
  it("undo and redo restore the exact prior states", () => {
    const s0 = ws();
    const s1 = edit(s0, (d) => (d.name = "Renamed"));
    const s2 = edit(s1, (d) => d.pages.pop());
    let h = createHistory(s0);
    h = commit(h, s1, { now: 0 });
    h = commit(h, s2, { now: 5000 });

    h = undo(h);
    expect(h.present.workspace).toEqual(s1);
    h = undo(h);
    expect(h.present.workspace).toEqual(s0);
    expect(canUndo(h)).toBe(false);

    h = redo(h);
    expect(h.present.workspace).toEqual(s1);
    h = redo(h);
    expect(h.present.workspace).toEqual(s2);
    expect(canRedo(h)).toBe(false);
  });

  it("a new edit clears the redo stack", () => {
    let h = createHistory(ws());
    h = commit(h, edit(ws(), (d) => (d.name = "A")), { now: 0 });
    h = undo(h);
    h = commit(h, edit(ws(), (d) => (d.name = "B")), { now: 10 });
    expect(canRedo(h)).toBe(false);
  });

  it("merges a typing burst in one field into one step", () => {
    const s0 = ws();
    let h = createHistory(s0);
    h = commit(h, edit(s0, (d) => (d.name = "W1")), { now: 0, coalesceKey: "f1" });
    h = commit(h, edit(s0, (d) => (d.name = "W12")), { now: 300, coalesceKey: "f1" });
    h = commit(h, edit(s0, (d) => (d.name = "W123")), { now: 600, coalesceKey: "f1" });
    expect(h.past).toHaveLength(1);
    expect(undo(h).present.workspace).toEqual(s0);

    // A pause, or another field, starts a new step.
    h = commit(h, edit(s0, (d) => (d.name = "x")), { now: 600 + COALESCE_MS + 1, coalesceKey: "f1" });
    h = commit(h, edit(s0, (d) => (d.name = "y")), { now: 600 + COALESCE_MS + 2, coalesceKey: "f2" });
    expect(h.past).toHaveLength(3);
  });

  it("caps the number of steps", () => {
    let h = createHistory(ws());
    for (let i = 0; i < 10; i += 1) {
      h = commit(h, edit(ws(), (d) => (d.name = String(i))), { now: i * 5000, limit: 3 });
    }
    expect(h.past).toHaveLength(3);
  });

  it("undoStep reverts to just before a given step, keeping later steps for redo", () => {
    const s0 = ws();
    const s1 = edit(s0, (d) => d.pages.pop()); // the removal
    const s2 = edit(s1, (d) => (d.name = "after"));
    let h = createHistory(s0);
    h = commit(h, s1, { now: 0 });
    const removalId = h.present.id;
    h = commit(h, s2, { now: 5000 });

    const reverted = undoStep(h, removalId)!;
    expect(reverted.present.workspace).toEqual(s0);
    expect(reverted.future.map((e) => e.workspace)).toEqual([s1, s2]);
    expect(undoStep(reverted, 999)).toBeNull();
  });
});

describe("detectRemoval", () => {
  it("ignores edits that remove nothing", () => {
    const s0 = ws();
    expect(detectRemoval(s0, edit(s0, (d) => (d.name = "x")))).toBeNull();
    // Clearing one cell while typing is ordinary editing.
    expect(
      detectRemoval(s0, edit(s0, (d) => (d.databases[0].rows[0].cells.name = ""))),
    ).toBeNull();
  });

  it("reports a deleted page by name, ahead of its blocks", () => {
    const s0 = ws();
    expect(detectRemoval(s0, edit(s0, (d) => d.pages.splice(0, 1)))).toEqual({
      kind: "page",
      count: 1,
      name: "Home",
    });
  });

  it("reports blocks, cards, rows, columns, databases and column data", () => {
    const s0 = ws();
    expect(detectRemoval(s0, edit(s0, (d) => d.pages[0].blocks.splice(0, 1)))?.kind).toBe("block");
    expect(
      detectRemoval(
        s0,
        edit(s0, (d) => {
          const deck = d.pages[0].blocks[1];
          if (deck.type === "flashcards") deck.cards = [];
        }),
      ),
    ).toEqual({ kind: "card", count: 2 });
    expect(detectRemoval(s0, edit(s0, (d) => d.databases[0].rows.pop()))?.kind).toBe("row");
    expect(detectRemoval(s0, edit(s0, (d) => d.databases[0].properties.pop()))?.kind).toBe(
      "column",
    );
    expect(detectRemoval(s0, edit(s0, (d) => d.databases.pop()))?.kind).toBe("database");
    expect(
      detectRemoval(
        s0,
        edit(s0, (d) => {
          d.databases[0].properties[1].type = "number";
          for (const r of d.databases[0].rows) r.cells.due = null;
        }),
      ),
    ).toEqual({ kind: "columnData", count: 1 });
  });
});
