import { describe, expect, it } from "vitest";
import { applyPatch, diff, invertPatch } from "./changes";
import {
  COALESCE_MS,
  breakCoalescing,
  canRedo,
  canUndo,
  createHistory,
  detectRemoval,
  record,
  takeRedo,
  takeUndo,
  type History,
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
  return applyPatch(w, diff(w, next), { mode: "undo" }).doc;
}

/** Record `fn` as a step on top of `w`; returns the new document and history. */
function step(
  h: History,
  w: Workspace,
  fn: (d: Workspace) => void,
  now: number,
  coalesceKey: string | null = null,
) {
  const after = edit(w, fn);
  const recorded = record(h, { before: w, after, ops: diff(w, after), now, coalesceKey });
  return { h: recorded.history, w: after, id: recorded.entryId };
}

describe("history (steps are the student's own patches)", () => {
  it("undo applies a step's inverse; redo applies it again", () => {
    let h = createHistory();
    const s0 = ws();
    const a = step(h, s0, (d) => (d.name = "Renamed"), 0);
    const b = step(a.h, a.w, (d) => d.pages.pop(), 5000);
    h = b.h;

    let taken = takeUndo(h)!;
    let doc = applyPatch(b.w, invertPatch(taken.entry.ops), { mode: "undo" }).doc;
    expect(doc).toEqual(a.w);
    taken = takeUndo(taken.history)!;
    doc = applyPatch(doc, invertPatch(taken.entry.ops), { mode: "undo" }).doc;
    expect(doc).toEqual(s0);
    expect(canUndo(taken.history)).toBe(false);

    const redone = takeRedo(taken.history)!;
    doc = applyPatch(doc, redone.entry.ops, { mode: "undo" }).doc;
    expect(doc).toEqual(a.w);
    expect(canRedo(redone.history)).toBe(true);
  });

  it("a new step clears the redo stack", () => {
    const a = step(createHistory(), ws(), (d) => (d.name = "A"), 0);
    const undone = takeUndo(a.h)!.history;
    expect(canRedo(undone)).toBe(true);
    const b = step(undone, ws(), (d) => (d.name = "B"), 10);
    expect(canRedo(b.h)).toBe(false);
  });

  it("merges a typing burst in one field into one step", () => {
    const s0 = ws();
    let cur = { h: createHistory(), w: s0, id: 0 };
    cur = step(cur.h, cur.w, (d) => (d.name = "W1"), 0, "f1");
    cur = step(cur.h, cur.w, (d) => (d.name = "W12"), 300, "f1");
    cur = step(cur.h, cur.w, (d) => (d.name = "W123"), 600, "f1");
    expect(cur.h.undo).toHaveLength(1);
    const inverse = invertPatch(takeUndo(cur.h)!.entry.ops);
    expect(applyPatch(cur.w, inverse, { mode: "undo" }).doc).toEqual(s0);

    // A pause, or another field, starts a new step.
    cur = step(cur.h, cur.w, (d) => (d.name = "x"), 600 + COALESCE_MS + 1, "f1");
    cur = step(cur.h, cur.w, (d) => (d.name = "y"), 600 + COALESCE_MS + 2, "f2");
    expect(cur.h.undo).toHaveLength(3);
    // ...and so does anything from outside (breakCoalescing).
    const broken = breakCoalescing(cur.h);
    const next = step(broken, cur.w, (d) => (d.name = "yz"), 600 + COALESCE_MS + 3, "f2");
    expect(next.h.undo).toHaveLength(4);
  });

  it("only the newest step keeps a document reference (memory)", () => {
    let cur = { h: createHistory(), w: ws(), id: 0 };
    for (let i = 0; i < 5; i += 1) cur = step(cur.h, cur.w, (d) => (d.name = `n${i}`), i * 5000, "f");
    expect(cur.h.undo.slice(0, -1).every((e) => e.before === null)).toBe(true);
    expect(cur.h.undo.at(-1)!.before).not.toBeNull();
  });

  it("caps the number of steps and their total size", () => {
    let h = createHistory();
    let w = ws();
    for (let i = 0; i < 10; i += 1) {
      const after = edit(w, (d) => (d.name = String(i)));
      h = record(h, { before: w, after, ops: diff(w, after), now: i * 5000, limit: 3 }).history;
      w = after;
    }
    expect(h.undo).toHaveLength(3);

    h = createHistory();
    w = ws();
    for (let i = 0; i < 10; i += 1) {
      const after = edit(w, (d) => (d.pages[1].title = "x".repeat(1000) + i));
      h = record(h, { before: w, after, ops: diff(w, after), now: i * 5000, maxBytes: 9_000 }).history;
      w = after;
    }
    // Each step holds ~4 KB of text (before + after, two bytes a char).
    expect(h.undo.length).toBeLessThan(10);
    expect(h.undo.reduce((n, e) => n + e.bytes, 0)).toBeLessThanOrEqual(9_000);
  });

  it("takeUndo can take one specific step (the Undo toast), keeping later ones", () => {
    const s0 = ws();
    const removal = step(createHistory(), s0, (d) => d.pages.pop(), 0);
    const later = step(removal.h, removal.w, (d) => (d.name = "after"), 5000);
    const taken = takeUndo(later.h, removal.id)!;
    const doc = applyPatch(later.w, invertPatch(taken.entry.ops), { mode: "undo" }).doc;
    expect(doc.pages.map((p) => p.id)).toEqual(["p1", "p2"]);
    expect(doc.name).toBe("after"); // the later step is untouched
    expect(taken.history.undo.map((e) => e.id)).toEqual([later.id]);
    expect(canRedo(taken.history)).toBe(true);
    expect(takeUndo(taken.history, 999)).toBeNull();
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

  it("does not count an empty line or text joined onto a neighbour as a deletion", () => {
    const s0 = edit(ws(), (d) => {
      d.pages[0].blocks.push({ id: "b2", type: "paragraph", text: "" });
      d.pages[0].blocks.push({ id: "b3", type: "heading", level: 2, text: "two" });
    });
    // Backspace on an empty line.
    expect(detectRemoval(s0, edit(s0, (d) => d.pages[0].blocks.splice(2, 1)))).toBeNull();
    // Backspace at the start of "two": it joins the line above.
    const merged = edit(s0, (d) => {
      const first = d.pages[0].blocks[0];
      if (first.type === "paragraph") first.text = "onetwo";
      d.pages[0].blocks.splice(3, 1);
    });
    expect(detectRemoval(s0, merged)).toBeNull();
    // Deleting a line with text is a deletion.
    expect(detectRemoval(s0, edit(s0, (d) => d.pages[0].blocks.splice(3, 1)))).toEqual({ kind: "block", count: 1 });
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
