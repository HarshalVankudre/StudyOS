/**
 * Second sync review: the rules that live in pure functions (the engine-level
 * scenarios are in components/workspace/workspace-sync.review2.test.ts).
 */
import { describe, expect, it } from "vitest";
import { applyAgentOps } from "@/lib/ai/agent-ops";
import { applyFeedEvents, type ApplyOptions } from "@/lib/feeds/sync";
import type { FeedEvent } from "@/lib/feeds/normalize";
import { recordAnswer } from "@/lib/study/quiz";
import { applyGrade } from "@/components/workspace/study/gradeEdit";
import { applyPatch, diff, lookupIn } from "./changes";
import { repairWorkspace } from "./repair";
import type { Block, Database, QuizQuestion, Workspace } from "./types";

const para = (id: string, text: string): Block => ({ id, type: "paragraph", text });

function edit(w: Workspace, fn: (d: Workspace) => void): Workspace {
  const d = structuredClone(w);
  fn(d);
  return d;
}

function ws(blocks: Block[] = [para("b1", "hi")], databases: Database[] = []): Workspace {
  return { id: "w1", name: "W", pages: [{ id: "p1", title: "Home", blocks }], databases };
}

function tasks(due: string, link: string): Database {
  return {
    id: "d1",
    name: "Tasks",
    properties: [
      { id: "t", name: "Task", type: "text" },
      { id: "due", name: "Due", type: "date" },
      { id: "url", name: "Link", type: "url" },
    ],
    rows: [{ id: "r1", cells: { t: "Essay", due, url: link } }],
    views: [{ id: "v", name: "All", type: "table" }],
  };
}

const cell = (w: Workspace, key: string) => w.databases[0].rows[0].cells[key];

describe("F3: only prose is merged word by word; other values are one value", () => {
  const base = ws([], [tasks("2026-11-20", "https://a.example/one")]);
  const mine = edit(base, (d) => {
    d.databases[0].rows[0].cells.due = "2026-11-21";
    d.databases[0].rows[0].cells.url = "https://a.example/two";
  });
  const theirs = edit(base, (d) => {
    d.databases[0].rows[0].cells.due = "2026-12-12";
    d.databases[0].rows[0].cells.url = "https://b.example/one";
  });

  it("rebase (the editor): the student's value wins and the report says so", () => {
    const r = applyPatch(theirs, diff(base, mine), { mode: "rebase", lookup: lookupIn(mine) });
    expect(cell(r.doc, "due")).toBe("2026-11-21"); // not a date assembled from both
    expect(cell(r.doc, "url")).toBe("https://a.example/two");
    expect(r.report.overwritten.map((o) => o.theirs).sort()).toEqual(["2026-12-12", "https://b.example/one"]);
  });

  it("strict (the agent, the closing-tab save): a conflict", () => {
    const r = applyPatch(theirs, diff(base, mine), { mode: "strict" });
    expect(r.report.conflicts).toBe(2);
  });

  it("undo: left as it is, reported as an undo that was partial", () => {
    const r = applyPatch(theirs, diff(mine, base), { mode: "undo" });
    expect(cell(r.doc, "due")).toBe("2026-12-12");
    expect(r.report.skipped).toBe(2);
  });

  it("text cells and block text are still merged word by word", () => {
    const b = ws([para("b1", "Cells divide by mitosis")], [tasks("2026-11-20", "")]);
    const m = edit(b, (d) => {
      (d.pages[0].blocks[0] as { text: string }).text = "Cells divide by mitosis daily";
      d.databases[0].rows[0].cells.t = "Essay draft";
    });
    const t = edit(b, (d) => {
      (d.pages[0].blocks[0] as { text: string }).text = "Most cells divide by mitosis";
      d.databases[0].rows[0].cells.t = "Final Essay";
    });
    const r = applyPatch(t, diff(b, m), { mode: "rebase", lookup: lookupIn(m) });
    expect((r.doc.pages[0].blocks[0] as { text: string }).text).toBe("Most cells divide by mitosis daily");
    expect(cell(r.doc, "t")).toBe("Final Essay draft");
    expect(r.report.overwritten).toEqual([]);
  });
});

describe("F4: re-run edits are idempotent (replayed on every rebase)", () => {
  function deck(): Workspace {
    return ws([{ id: "deck", type: "flashcards", cards: [{ id: "c1", front: "Q", back: "A" }] } as Block]);
  }
  const ref = { pageId: "p1", blockId: "deck", cardId: "c1" };
  const reps = (w: Workspace) => (w.pages[0].blocks[0] as { cards: Array<{ reps?: number }> }).cards[0].reps ?? 0;

  it("a grade replayed twice counts once; two grades count twice", () => {
    const d = deck();
    const t1 = new Date("2026-11-12T10:00:00Z");
    const t2 = new Date("2026-11-12T10:05:00Z");
    applyGrade(d, ref, "good", t1);
    applyGrade(d, ref, "good", t1); // the same review, replayed
    expect(reps(d)).toBe(1);
    applyGrade(d, ref, "good", t2);
    applyGrade(d, ref, "good", t1); // replaying the first after the second: still once
    expect(reps(d)).toBe(2);
  });

  it("a quiz answer replayed counts once", () => {
    const q: QuizQuestion = { id: "q", kind: "true_false", prompt: "?", answerBool: true };
    recordAnswer(q, true, "2026-11-12T10:00:00.000Z");
    recordAnswer(q, true, "2026-11-12T10:00:00.000Z");
    recordAnswer(q, false, "2026-11-12T10:01:00.000Z");
    expect(q.stats).toMatchObject({ attempts: 2, correct: 1 });
  });
});

describe("F6: ids made while syncing a feed are the same on every run", () => {
  const db: Database = {
    id: "d1",
    name: "Assignments",
    properties: [
      { id: "name", name: "Assignment", type: "text" },
      { id: "course", name: "Course", type: "select", options: [] },
      { id: "due", name: "Due", type: "date" },
    ],
    rows: [],
    views: [{ id: "v", name: "All", type: "table" }],
  };
  const events = [
    { key: "e1", title: "Essay 1", course: "HIST 210", when: { date: "2026-11-20" }, role: "deadline" },
    { key: "e2", title: "Lab 3", course: "CHEM 101", when: { date: "2026-11-22" }, role: "deadline" },
  ] satisfies FeedEvent[];
  const opts: ApplyOptions = {
    databaseId: "d1",
    feedId: "feed1",
    mapping: { title: "name", due: "due", course: "course", link: null, status: null },
    today: "2026-11-12",
    timeZone: "UTC",
    mode: "import",
    selected: new Set(["e1", "e2"]),
    newColumns: {
      due: { id: "new-due", name: "Due" },
      course: { id: "new-course", name: "Course" },
      link: { id: "new-link", name: "Link" },
    },
  };

  it("two runs of the same sync (a rebase replays it) give the same row and option ids", () => {
    const a = ws([], [structuredClone(db)]);
    const b = ws([], [structuredClone(db)]);
    applyFeedEvents(a, events, opts);
    applyFeedEvents(b, events, opts);
    expect(a.databases[0].rows.length).toBeGreaterThan(0);
    expect(a.databases[0]).toEqual(b.databases[0]);
  });
});

describe("F7: no list ever holds an id twice", () => {
  it("the agent may not reuse an id", () => {
    const w = ws([para("b1", "one")]);
    expect(() =>
      applyAgentOps(w, [{ op: "set_page_blocks", pageId: "p1", blocks: [para("x", "a"), para("x", "b")] }] as never),
    ).toThrow(/duplicate id "x"/);
  });

  it("a stored document with a duplicate is repaired the same way on every load", () => {
    const stored = ws([para("x", "a"), para("x", "b"), para("x~2", "c")]);
    const once = repairWorkspace(structuredClone(stored))!.workspace;
    const again = repairWorkspace(structuredClone(stored))!.workspace;
    expect(once.pages[0].blocks.map((b) => b.id)).toEqual(["x", "x~3", "x~2"]);
    expect(again).toEqual(once);
  });
});

describe("F9: undo of an insert whose id is back with other content", () => {
  it("is left as it is and reported as partial (undo), kept as both (rebase)", () => {
    const before = ws([para("b2", "two")]);
    const after = ws([para("b1", "one, mine"), para("b2", "two")]);
    const elsewhere = ws([para("b1", "one"), para("b2", "two")]);
    const undo = applyPatch(elsewhere, diff(before, after), { mode: "undo" });
    expect(undo.doc).toBe(elsewhere);
    expect(undo.report.skipped).toBe(1);
    const rebase = applyPatch(elsewhere, diff(before, after), { mode: "rebase", lookup: lookupIn(after), newId: () => "k" });
    expect(rebase.doc.pages[0].blocks.map((b) => [b.id, (b as { text?: string }).text])).toEqual([
      ["b1", "one"],
      ["k", "one, mine"],
      ["b2", "two"],
    ]);
    expect(rebase.report.keptBoth).toBe(1);
  });
});

describe("F11: strict merges treat two moves of one block as a conflict", () => {
  it("does not undo the other writer's move", () => {
    const base = ws([para("a", "a"), para("b", "b"), para("c", "c")]);
    const mine = ws([para("b", "b"), para("a", "a"), para("c", "c")]); // a after b
    const theirs = ws([para("b", "b"), para("c", "c"), para("a", "a")]); // a to the end
    const r = applyPatch(theirs, diff(base, mine), { mode: "strict" });
    expect(r.report.conflicts).toBe(1);
    expect(r.doc.pages[0].blocks.map((b) => b.id)).toEqual(["b", "c", "a"]);
  });
});
