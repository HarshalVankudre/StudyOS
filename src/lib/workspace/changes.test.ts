import { describe, expect, it } from "vitest";
import {
  applyPatch,
  deepEqual,
  diff,
  emptyReport,
  invertPatch,
  lookupIn,
  shareWith,
} from "./changes";
import type { Block, Workspace } from "./types";

function ws(blocks: Block[] = [{ id: "b1", type: "paragraph", text: "one" }]): Workspace {
  return {
    id: "w",
    name: "W",
    pages: [
      { id: "p1", title: "Home", blocks },
      { id: "p2", title: "Notes", blocks: [] },
    ],
    databases: [
      {
        id: "db",
        name: "Tasks",
        properties: [{ id: "name", name: "Name", type: "text" }],
        rows: [{ id: "r1", cells: { name: "a" } }],
        views: [{ id: "v", name: "Table", type: "table" }],
      },
    ],
  };
}

function edit(w: Workspace, fn: (d: Workspace) => void): Workspace {
  const d = structuredClone(w);
  fn(d);
  return d;
}

const texts = (w: Workspace, page = 0) =>
  w.pages[page].blocks.map((b) => ("text" in b ? b.text : b.type));

describe("diff / applyPatch", () => {
  it("addresses changes by id and reproduces the target exactly", () => {
    const a = ws([
      { id: "b1", type: "paragraph", text: "one" },
      { id: "b2", type: "paragraph", text: "two" },
      { id: "b3", type: "paragraph", text: "three" },
    ]);
    const b = edit(a, (d) => {
      const bs = d.pages[0].blocks;
      bs.splice(0, 1); // delete b1
      bs.push(bs.shift()!); // move b2 to the end
      bs.splice(1, 0, { id: "b4", type: "quote", text: "new" }); // insert
      (bs[0] as { text: string }).text = "THREE";
      d.name = "Renamed";
      d.databases[0].rows[0].cells.name = "z";
    });
    const ops = diff(a, b);
    expect(ops.some((o) => o.op === "set" && o.path.some((s) => typeof s !== "string" && s.id === "b3"))).toBe(true);
    expect(applyPatch(a, ops, { mode: "undo" }).doc).toEqual(b);
    // The inverse takes it back.
    expect(applyPatch(b, invertPatch(ops), { mode: "undo" }).doc).toEqual(a);
  });

  it("never changes its input and shares everything untouched", () => {
    const a = ws();
    const frozen = structuredClone(a);
    const { doc } = shareWith(a, edit(a, (d) => (d.pages[0].title = "Changed")));
    expect(a).toEqual(frozen);
    expect(doc.pages[0].title).toBe("Changed");
    expect(doc.pages[1]).toBe(a.pages[1]);
    expect(doc.databases).toBe(a.databases);
    expect(doc.pages[0].blocks).toBe(a.pages[0].blocks);
  });

  it("shares by id, and keeps the new order when several items moved", () => {
    const a = ws();
    a.pages[0].blocks = ["a", "b", "c", "d"].map((id) => ({ id, type: "paragraph" as const, text: id }));
    const b = structuredClone(a); // a fresh copy, as read from the server
    b.pages[0].blocks = [b.pages[0].blocks[2], b.pages[0].blocks[0], b.pages[0].blocks[3], b.pages[0].blocks[1]];
    const { doc, changed } = shareWith(a, b);
    expect(changed).toBe(true);
    expect(doc.pages[0].blocks.map((x) => x.id)).toEqual(["c", "a", "d", "b"]);
    expect(doc.pages[0].blocks[0]).toBe(a.pages[0].blocks[2]);
    expect(doc.pages[1]).toBe(a.pages[1]);
    expect(shareWith(a, structuredClone(a))).toEqual({ doc: a, changed: false });
  });

  it("treats tag lists and other id-less arrays as one value", () => {
    const a = ws();
    a.databases[0].rows[0].cells.tags = ["x", "y"];
    const b = edit(a, (d) => (d.databases[0].rows[0].cells.tags = ["y"]));
    const ops = diff(a, b);
    expect(ops).toHaveLength(1);
    expect(ops[0]).toMatchObject({ op: "set", before: ["x", "y"], after: ["y"] });
  });

  it("moves by neighbour id, so a move lands right on a page that changed", () => {
    const a = ws([
      { id: "a", type: "paragraph", text: "A" },
      { id: "b", type: "paragraph", text: "B" },
      { id: "c", type: "paragraph", text: "C" },
    ]);
    const moved = edit(a, (d) => d.pages[0].blocks.push(d.pages[0].blocks.shift()!)); // a after c
    const theirs = edit(a, (d) => d.pages[0].blocks.unshift({ id: "z", type: "paragraph", text: "Z" }));
    const r = applyPatch(theirs, diff(a, moved), { mode: "rebase", lookup: lookupIn(moved) });
    expect(texts(r.doc)).toEqual(["Z", "B", "C", "A"]);
  });
});

describe("rebase rules", () => {
  it("merges text edited in different places", () => {
    const base = ws([{ id: "b1", type: "paragraph", text: "the cat sat" }]);
    const mine = edit(base, (d) => ((d.pages[0].blocks[0] as { text: string }).text = "the black cat sat"));
    const theirs = edit(base, (d) => ((d.pages[0].blocks[0] as { text: string }).text = "the cat sat down"));
    const r = applyPatch(theirs, diff(base, mine), { mode: "rebase", lookup: lookupIn(mine) });
    expect(texts(r.doc)).toEqual(["the black cat sat down"]);
    expect(r.report.keptBoth).toBe(0);
  });

  it("keeps both versions of a block's text edited in the same place, the other one marked", () => {
    const base = ws([{ id: "b1", type: "paragraph", text: "hi there" }]);
    const mine = edit(base, (d) => ((d.pages[0].blocks[0] as { text: string }).text = "hey there"));
    const theirs = edit(base, (d) => ((d.pages[0].blocks[0] as { text: string }).text = "Hello there"));
    const r = applyPatch(theirs, diff(base, mine), {
      mode: "rebase",
      lookup: lookupIn(mine),
      newId: () => "copy",
    });
    // The student's version stays in place (under their cursor), the other
    // one follows as a copy marked as kept from it.
    expect(texts(r.doc)).toEqual(["hey there", "Hello there"]);
    expect(r.doc.pages[0].blocks.map((b) => [b.id, (b as { keptFrom?: string }).keptFrom])).toEqual([
      ["b1", undefined],
      ["copy", "b1"],
    ]);
    expect(r.report.keptBoth).toBe(1);
  });

  it("combines an edit with words added right next to it", () => {
    const base = ws([{ id: "b1", type: "paragraph", text: "hi" }]);
    const mine = edit(base, (d) => ((d.pages[0].blocks[0] as { text: string }).text = "hi and mine"));
    const theirs = edit(base, (d) => ((d.pages[0].blocks[0] as { text: string }).text = "Hello theirs"));
    const r = applyPatch(theirs, diff(base, mine), { mode: "rebase", lookup: lookupIn(mine) });
    expect(texts(r.doc)).toEqual(["Hello theirs and mine"]);
    expect(r.report.keptBoth).toBe(0);
  });

  it("a restored block that another writer restored with other text keeps both texts (rebase)", () => {
    const base = ws([{ id: "b2", type: "paragraph", text: "two" }]);
    // The student undid deleting b1 (it comes back with their text) while
    // another writer brought b1 back from an older copy, with other text.
    const mine = ws([
      { id: "b1", type: "paragraph", text: "one [kept by me]" },
      { id: "b2", type: "paragraph", text: "two" },
    ]);
    const theirs = ws([
      { id: "b1", type: "paragraph", text: "one" },
      { id: "b2", type: "paragraph", text: "two" },
    ]);
    const r = applyPatch(theirs, diff(base, mine), { mode: "rebase", lookup: lookupIn(mine), newId: () => "copy" });
    expect(texts(r.doc)).toEqual(["one", "one [kept by me]", "two"]);
    expect((r.doc.pages[0].blocks[1] as { keptFrom?: string }).keptFrom).toBe("b1");
    expect(r.report.keptBoth).toBe(1);
  });

  it("restores what was deleted elsewhere when the student edited inside it", () => {
    const base = ws([
      { id: "b1", type: "paragraph", text: "one" },
      { id: "b2", type: "paragraph", text: "two" },
    ]);
    const mine = edit(base, (d) => ((d.pages[0].blocks[1] as { text: string }).text = "two, edited"));
    const theirs = edit(base, (d) => d.pages.splice(0, 1)); // the whole page deleted
    const r = applyPatch(theirs, diff(base, mine), { mode: "rebase", lookup: lookupIn(mine) });
    const page = r.doc.pages.find((p) => p.id === "p1")!;
    expect(page.title).toBe("Home");
    expect(texts(r.doc, r.doc.pages.indexOf(page))).toEqual(["two, edited"]);
    expect(r.report.restored).toBe(2); // the page, then the block
  });

  it("keeps something the student deleted if it changed elsewhere meanwhile", () => {
    const base = ws();
    const mine = edit(base, (d) => d.pages[0].blocks.splice(0, 1));
    const theirs = edit(base, (d) => ((d.pages[0].blocks[0] as { text: string }).text = "changed"));
    const r = applyPatch(theirs, diff(base, mine), { mode: "rebase", lookup: lookupIn(mine) });
    expect(texts(r.doc)).toEqual(["changed"]);
    expect(r.report.keptDeleted).toBe(1);
  });

  it("keeps the student's value for other collisions and reports what it replaced", () => {
    const base = ws();
    const mine = edit(base, (d) => (d.databases[0].rows[0].cells.name = "mine"));
    const theirs = edit(base, (d) => (d.databases[0].rows[0].cells.name = "theirs"));
    const report = emptyReport();
    const r = applyPatch(theirs, diff(base, mine), { mode: "rebase", lookup: lookupIn(mine), report });
    expect(r.doc.databases[0].rows[0].cells.name).toBe("mine");
    expect(report.overwritten).toEqual([
      expect.objectContaining({ theirs: "theirs", mine: "mine" }),
    ]);
  });

  it("is idempotent: replaying changes already applied changes nothing", () => {
    const base = ws();
    const mine = edit(base, (d) => {
      (d.pages[0].blocks[0] as { text: string }).text = "one more";
      d.pages[0].blocks.push({ id: "b9", type: "paragraph", text: "new" });
      d.pages.splice(1, 1);
    });
    const r = applyPatch(mine, diff(base, mine), { mode: "rebase", lookup: lookupIn(mine) });
    expect(deepEqual(r.doc, mine)).toBe(true);
    expect(r.report).toEqual(emptyReport());
  });
});

describe("undo and strict modes", () => {
  it("undo leaves alone what changed since", () => {
    const base = ws();
    const mine = edit(base, (d) => (d.databases[0].rows[0].cells.name = "mine"));
    const later = edit(mine, (d) => (d.databases[0].rows[0].cells.name = "someone else"));
    const r = applyPatch(later, invertPatch(diff(base, mine)), { mode: "undo" });
    expect(r.doc.databases[0].rows[0].cells.name).toBe("someone else");
    expect(r.report.skipped).toBe(1);
  });

  it("strict reports any overlap as a conflict and allows clean merges", () => {
    const base = ws([{ id: "b1", type: "paragraph", text: "the cat sat" }]);
    const agent = edit(base, (d) => ((d.pages[0].blocks[0] as { text: string }).text = "the black cat sat"));
    const clean = edit(base, (d) => (d.name = "Renamed by a tab"));
    const overlap = edit(base, (d) => ((d.pages[0].blocks[0] as { text: string }).text = "a dog"));
    expect(applyPatch(clean, diff(base, agent), { mode: "strict" }).report.conflicts).toBe(0);
    expect(applyPatch(overlap, diff(base, agent), { mode: "strict" }).report.conflicts).toBe(1);
  });
});
