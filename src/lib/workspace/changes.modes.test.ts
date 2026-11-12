/**
 * The apply modes added after the third sync review ("recover", "keep"), the
 * merging of containers both sides created, and what is reported where.
 */
import { describe, expect, it } from "vitest";
import { applyPatch, diff, emptyReport, lookupIn, pathKey, type Lookup, type Op } from "./changes";
import { repairWorkspace } from "./repair";
import type { Workspace } from "./types";

type Loose = Record<string, unknown>;

function doc(): Workspace {
  return {
    id: "w",
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
const edit = (base: Workspace, fn: (d: Workspace) => void): Workspace => {
  const next = structuredClone(base);
  fn(next);
  return next;
};
const text = (id: string, value: string) => (d: Workspace) => {
  const b = d.pages[0].blocks.find((x) => x.id === id) as { text: string };
  b.text = value;
};
const texts = (d: Workspace) =>
  d.pages[0].blocks.map((b) => `${(b as { text?: string }).text}${(b as unknown as Loose).keptFrom ? " (kept)" : ""}`);
let n = 0;
const newId = () => `copy${(n += 1)}`;

/** `mine`'s edits (made on `base`) applied to `theirs` in `mode`. */
function merge(
  mode: "rebase" | "recover" | "keep",
  base: Workspace,
  mine: Workspace,
  theirs: Workspace,
  lookup?: Lookup,
  asLeft = false,
) {
  const report = emptyReport();
  const result = applyPatch(theirs, diff(base, mine), { mode, lookup: lookup ?? lookupIn(mine), report, newId, asLeft });
  return { doc: result.doc, report };
}

describe("recover: edits of a tab that is gone never replace what is there now", () => {
  const X = ["databases", { id: "d1" }, "rows", { id: "r1" }, "cells", "x"];

  it("only adds while it is not known that nothing happened since", () => {
    const base = doc();
    const mine = edit(base, (d) => {
      text("b1", "alpha typed before the crash")(d); // adds to the text
      text("b2", "rewritten")(d); // replaces the text
      d.databases[0].rows[0].cells.x = 5; // replaces a value
      d.pages[0].blocks.push({ id: "n1", type: "paragraph", text: "new" } as never);
      d.databases[0].views = []; // deletes an item
    });
    // The document looks exactly like the one those edits started from. It
    // may still have been changed and changed back since (set and undone).
    const { doc: out, report } = merge("recover", base, mine, base);
    expect(texts(out).slice(0, 2)).toEqual(["alpha typed before the crash", "beta"]);
    expect(texts(out).slice(2).sort()).toEqual(["new", "rewritten (kept)"]);
    expect(out.databases[0].rows[0].cells.x).toBe(0);
    expect(out.databases[0].views).toHaveLength(1);
    expect(report).toMatchObject({ keptBoth: 1, skipped: 1, overwritten: [], unapplied: [{ path: X, theirs: 0, mine: 5 }] });
    expect(report.where.map((w) => `${w.kind}${pathKey(w.path)}`).sort()).toEqual([
      "keptBoth.pages#p1.blocks#b2",
      "skipped.databases#d1.views#v1",
    ]);
  });

  it("applies exactly what still fits when the document is known to be as that tab left it", () => {
    const base = doc();
    const mine = edit(base, (d) => {
      text("b1", "alpha typed before the crash")(d);
      text("b2", "rewritten")(d);
      d.databases[0].rows[0].cells.x = 5;
      d.pages[0].blocks.push({ id: "n1", type: "paragraph", text: "new" } as never);
      d.databases[0].views = [];
    });
    const { doc: out, report } = merge("recover", base, mine, base, undefined, true);
    expect(out).toEqual(mine);
    expect(report).toMatchObject({ keptBoth: 0, skipped: 0, unapplied: [], overwritten: [], where: [] });
  });

  it("a merge of recovered text that would take words out keeps both versions instead", () => {
    const base = doc();
    const mine = edit(base, text("b1", "omega alpha")); // "alpha" kept, a word in front
    const cut = edit(base, text("b2", "")); // the recovered edit empties b2
    const theirs = edit(base, (d) => {
      text("b1", "alpha and more")(d);
      text("b2", "beta, extended")(d);
    });
    const added = merge("recover", base, mine, theirs);
    expect(texts(added.doc)[0]).toBe("omega alpha and more");
    const removed = merge("recover", base, cut, theirs);
    expect(texts(removed.doc)).toEqual(["alpha and more", "beta, extended", " (kept)"]);
  });

  it("a value that collides stays; the recovered one is listed with its place", () => {
    const base = doc();
    const mine = edit(base, (d) => void (d.databases[0].rows[0].cells.x = 5));
    const theirs = edit(base, (d) => void (d.databases[0].rows[0].cells.x = 9));
    const { doc: out, report } = merge("recover", base, mine, theirs);
    expect(out.databases[0].rows[0].cells.x).toBe(9);
    expect(report.unapplied).toEqual([{ path: ["databases", { id: "d1" }, "rows", { id: "r1" }, "cells", "x"], theirs: 9, mine: 5 }]);
    expect(report.overwritten).toEqual([]);
  });

  it("text that cannot be merged: the current paragraph stays, the recovered one is the marked copy", () => {
    const base = doc();
    const mine = edit(base, text("b1", "alpha, my ending"));
    const theirs = edit(base, text("b1", "alpha, their ending"));
    const { doc: out, report } = merge("recover", base, mine, theirs);
    expect(texts(out)).toEqual(["alpha, their ending", "alpha, my ending (kept)", "beta"]);
    expect(report.keptBoth).toBe(1);
    expect(report.where.map((w) => `${w.kind}${pathKey(w.path)}`)).toEqual(["keptBoth.pages#p1.blocks#b1"]);
  });
});

describe("keep: edits whose ancestor is unknown only add", () => {
  it("never writes over a value, even one that looks untouched (it may have been saved and changed back)", () => {
    const base = doc();
    const mine = edit(base, (d) => {
      text("b1", "alpha laptop")(d);
      d.databases[0].rows[0].cells.x = 1;
    });
    // The server holds exactly what the edits started from.
    const { doc: out, report } = merge("keep", base, mine, base);
    expect(texts(out)).toEqual(["alpha", "alpha laptop (kept)", "beta"]);
    expect(out.databases[0].rows[0].cells.x).toBe(0);
    expect(report.unapplied.map((u) => [u.mine, u.theirs])).toEqual([[1, 0]]);
  });

  it("adds what is missing, repeats no deletion or move, and says which", () => {
    const base = edit(doc(), (d) => void d.pages[0].blocks.push({ id: "b3", type: "paragraph", text: "gamma" } as never));
    const mine = edit(base, (d) => {
      const [, b2, b3] = d.pages[0].blocks;
      // b1 deleted, b3 moved before b2, a new paragraph at the end.
      d.pages[0].blocks = [b3, b2, { id: "n1", type: "paragraph", text: "added" } as never];
    });
    const { doc: out, report } = merge("keep", base, mine, base);
    expect(texts(out)).toEqual(["alpha", "beta", "added", "gamma"]);
    const kinds = report.where.map((w) => `${w.kind}${pathKey(w.path)}`).sort();
    expect(kinds).toHaveLength(3);
    expect(kinds).toContain("restored.pages#p1.blocks#n1");
    expect(kinds).toContain("skipped.pages#p1.blocks#b1");
    expect(kinds.some((k) => k === "skipped.pages#p1.blocks#b2" || k === "skipped.pages#p1.blocks#b3")).toBe(true);
  });

  it("applied twice it adds nothing twice (the same copy, the same offer)", () => {
    const base = doc();
    const mine = edit(base, (d) => {
      text("b1", "alpha laptop")(d);
      d.databases[0].rows[0].cells.x = 1;
    });
    const report = emptyReport();
    const ops = diff(base, mine);
    const once = applyPatch(base, ops, { mode: "keep", lookup: lookupIn(mine), report, newId }).doc;
    const twice = applyPatch(once, ops, { mode: "keep", lookup: lookupIn(mine), report, newId }).doc;
    expect(texts(twice)).toEqual(["alpha", "alpha laptop (kept)", "beta"]);
    expect(report.unapplied).toHaveLength(1);
  });
});

describe("an item both sides hold under one id, each having inserted it (third review, finding 5)", () => {
  const withBlock = (value: string) => (d: Workspace) => void d.pages[0].blocks.push({ id: "n1", type: "paragraph", text: value } as never);

  for (const mode of ["rebase", "recover", "keep"] as const) {
    it(`${mode}: typing inside a block the server already has is kept as a marked copy, never skipped`, () => {
      const base = doc();
      const mine = edit(base, withBlock("My essay intro, and the whole second paragraph"));
      const theirs = edit(base, withBlock("My essay intro"));
      const { doc: out, report } = merge(mode, base, mine, theirs);
      expect(texts(out)).toEqual(["alpha", "beta", "My essay intro", "My essay intro, and the whole second paragraph (kept)"]);
      expect(report.keptBoth).toBe(1);
      expect(report.skipped).toBe(0);
    });
  }

  it("a row both inserted with different cells: what is missing is added, what differs is offered", () => {
    const base = doc();
    const row = (cells: Record<string, unknown>) => (d: Workspace) => void d.databases[0].rows.push({ id: "r9", cells } as never);
    const mine = edit(base, row({ n: "HW 2", x: 7 }));
    const theirs = edit(base, row({ n: "HW 2" }));
    const first = merge("rebase", base, mine, theirs);
    expect(first.doc.databases[0].rows[1].cells).toEqual({ n: "HW 2", x: 7 });
    const other = merge("rebase", base, mine, edit(base, row({ n: "HW 2", x: 3 })));
    expect(other.doc.databases[0].rows[1].cells.x).toBe(3);
    expect(other.report.unapplied.map((u) => [u.mine, u.theirs])).toEqual([[7, 3]]);
  });

  it("a draft that kept no copy of the block still keeps its text (as a copy of the block as it is now)", () => {
    const base = doc();
    const mine = edit(base, text("b1", "alpha from the draft"));
    const theirs = edit(base, text("b1", "alpha from elsewhere"));
    const { doc: out } = merge("keep", base, mine, theirs, () => undefined);
    expect(texts(out)).toEqual(["alpha from elsewhere", "alpha from the draft (kept)", "beta"]);
  });
});

describe("containers both sides created are merged inside (third review, finding 6)", () => {
  const category = (id: string, name: string) => ({ id, course: "*", name, weight: 20 });
  const addCategory = (id: string, name: string) => (d: Workspace) => {
    d.databases[0].grading ??= { categories: [] };
    d.databases[0].grading.categories.push(category(id, name));
  };
  const names = (d: Workspace) => (d.databases[0].grading?.categories ?? []).map((c) => c.name).sort();

  for (const mode of ["rebase", "recover", "keep"] as const) {
    it(`${mode}: a grading scheme set up on two devices keeps the categories of both`, () => {
      const base = doc();
      const { doc: out, report } = merge(mode, base, edit(base, addCategory("ca", "Problem sets")), edit(base, addCategory("cb", "Midterm")));
      expect(names(out)).toEqual(["Midterm", "Problem sets"]);
      expect(report.overwritten).toEqual([]);
      expect(report.unapplied).toEqual([]);
    });
  }

  it("the same in a strict (server-side) merge: no conflict", () => {
    const base = doc();
    const mine = edit(base, addCategory("ca", "Problem sets"));
    const theirs = edit(base, addCategory("cb", "Midterm"));
    const result = applyPatch(theirs, diff(base, mine), { mode: "strict" });
    expect(result.report.conflicts).toBe(0);
    expect(names(result.doc)).toEqual(["Midterm", "Problem sets"]);
  });

  it("hand assignments (a map each side created) are merged key by key", () => {
    const base = edit(doc(), (d) => void (d.databases[0].grading = { categories: [category("c1", "HW")] }));
    const mine = edit(base, (d) => void (d.databases[0].grading!.assign = { r1: "c1" }));
    const theirs = edit(base, (d) => void (d.databases[0].grading!.assign = { r9: "c1" }));
    expect(merge("rebase", base, mine, theirs).doc.databases[0].grading?.assign).toEqual({ r1: "c1", r9: "c1" });
  });

  it("undoing the creation of the scheme removes only what the student had put in it", () => {
    const base = doc();
    const created = edit(base, addCategory("ca", "Problem sets"));
    const theirs = edit(created, addCategory("cb", "Midterm")); // another device added to it since
    const undo: Op[] = diff(created, base); // "remove grading"
    const out = applyPatch(theirs, undo, { mode: "rebase", lookup: lookupIn(base) });
    expect(names(out.doc)).toEqual(["Midterm"]);
    expect(out.report.overwritten).toEqual([]);
    // Nothing of anyone else's in it: it goes.
    expect(applyPatch(created, undo, { mode: "rebase" }).doc.databases[0].grading).toBeUndefined();
  });

  it("a record of plain values is not taken apart key by key when removed", () => {
    const stats = (attempts: number, correct: number) => (d: Workspace) => void ((d.databases[0] as unknown as Loose).stats = { attempts, correct });
    const base = doc();
    const created = edit(base, stats(1, 0));
    const theirs = edit(base, stats(2, 0)); // changed since; `correct` happens to be equal
    const undone = applyPatch(theirs, diff(created, base), { mode: "undo" });
    expect((undone.doc.databases[0] as unknown as Loose).stats).toEqual({ attempts: 2, correct: 0 });
    expect(undone.report.skipped).toBe(1);
  });
});

describe("an edit inside something removed elsewhere brings it back", () => {
  it("a settings object removed elsewhere is restored empty, then the edit goes in", () => {
    const category = { id: "ca", course: "*", name: "Labs", weight: 10 };
    const base = edit(doc(), (d) => void (d.databases[0].grading = { categories: [category] }));
    const mine = edit(base, (d) => void d.databases[0].grading!.categories.push({ ...category, id: "cb", name: "Final" }));
    const theirs = edit(base, (d) => void delete d.databases[0].grading); // undone elsewhere
    const { doc: out, report } = merge("rebase", base, mine, theirs);
    expect(out.databases[0].grading?.categories.map((c) => c.name)).toEqual(["Final"]);
    expect(report.skipped).toBe(0);
    expect(report.restored).toBeGreaterThan(0);
  });
});

describe("an undo replayed on a newer version (yieldValues)", () => {
  it("does not revert a value that was changed elsewhere since; text still merges", () => {
    const base = edit(doc(), (d) => {
      d.databases[0].rows[0].cells.x = 5; // what the student had set, and now undoes
      text("b1", "alpha typed")(d);
    });
    const undone = doc(); // back to 0 and "alpha"
    const theirs = edit(base, (d) => {
      d.databases[0].rows[0].cells.x = 7; // set elsewhere after
      text("b2", "beta elsewhere")(d);
    });
    const report = emptyReport();
    const out = applyPatch(theirs, diff(base, undone), { mode: "rebase", yieldValues: true, lookup: lookupIn(undone), report });
    expect(out.doc.databases[0].rows[0].cells.x).toBe(7);
    expect(texts(out.doc)).toEqual(["alpha", "beta elsewhere"]);
    expect(report.unapplied.map((u) => [pathKey(u.path), u.mine, u.theirs])).toEqual([[".databases#d1.rows#r1.cells.x", 0, 7]]);
    expect(report.overwritten).toEqual([]);
  });
});

describe("repair (third review, finding 10)", () => {
  it("two grading categories with one id both stay, under different ids", () => {
    const damaged = edit(doc(), (d) => {
      d.databases[0].grading = {
        categories: [
          { id: "c1", course: "*", name: "Homework", weight: 30 },
          { id: "c1", course: "*", name: "Midterm", weight: 30 },
        ],
      };
    });
    const repaired = repairWorkspace(damaged, { id: "w" });
    const categories = repaired?.workspace.databases[0].grading?.categories ?? [];
    expect(categories.map((c) => c.name)).toEqual(["Homework", "Midterm"]);
    expect(new Set(categories.map((c) => c.id)).size).toBe(2);
    expect(categories[0].id).toBe("c1");
  });
});
