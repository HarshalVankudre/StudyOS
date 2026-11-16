import { describe, expect, it } from "vitest";
import { prepareWorkspaceForSave } from "@/lib/workspace/repair";
import type { Block, Database, DatabaseViewBlock, Page, Workspace } from "@/lib/workspace/types";
import { PUBLIC_ROW_CAP } from "./config";
import { buildPageCopy, withoutAssetImages } from "./copy";
import { toPublicPage } from "./public-view";
import { PRIVATE_IDS, sharedPage, sharedWorkspace, WS_ID } from "./share-fixture";

const TODAY = "2026-11-13";

function counter() {
  let n = 0;
  return () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
}

const copyFor = (sameOwner: boolean) =>
  buildPageCopy(sharedPage(), sharedWorkspace(), { sameOwner, today: TODAY, untitled: "Untitled", newId: counter() });

const types = (blocks: Block[]) => blocks.map((b) => b.type);

describe("Save a copy: another student's copy", () => {
  it("is a new workspace named after the page, holding only that page", () => {
    const ws = copyFor(false);
    expect(ws.name).toBe("Cell biology");
    expect(ws.icon).toBe("🧬");
    expect(ws.pages).toHaveLength(1);
    expect(ws.homePageId).toBe(ws.pages[0].id);
    expect(JSON.stringify(ws)).not.toContain("SECRET-OTHER-PAGE");
  });

  it("leaves grades, components and the sharer's images out", () => {
    const blocks = copyFor(false).pages[0].blocks;
    expect(types(blocks)).toEqual([
      "heading",
      "paragraph",
      "numbered_list_item",
      "numbered_list_item",
      "todo",
      "callout",
      "divider",
      "database_view",
      "flashcards",
      "quiz",
    ]);
    const paragraph = blocks[1] as { text: string };
    // The uploaded image becomes its alt text; the deep link into the sharer's workspace is gone.
    expect(paragraph.text).toBe("See [my other page](…) and diagram");
  });

  it("gives every block, card, question, row, view and database a fresh id, and keeps no private id", () => {
    const ws = copyFor(false);
    const json = JSON.stringify(ws);
    for (const id of PRIVATE_IDS) expect(json, id).not.toContain(id);
    expect(json).not.toContain("SECRET_SOURCE");
    expect(json).not.toContain("My GPA");
  });

  it("starts the deck unscheduled and the quiz without scores, both without citations", () => {
    const blocks = copyFor(false).pages[0].blocks;
    const deck = blocks.find((b) => b.type === "flashcards");
    const quiz = blocks.find((b) => b.type === "quiz");
    if (deck?.type !== "flashcards" || quiz?.type !== "quiz") throw new Error("missing study blocks");
    expect(deck.cards).toEqual([{ id: expect.any(String), front: "Q1", back: "A1" }]);
    expect(quiz.attempts).toBeUndefined();
    expect(quiz.questions.map((q) => q.prompt)).toEqual(["2+2?", "Sky is blue", "Define cell"]);
    for (const q of quiz.questions) {
      expect(q.stats).toBeUndefined();
      expect(q.source).toBeUndefined();
    }
  });

  it("copies a table as its own database: only the columns and rows the page showed", () => {
    const ws = copyFor(false);
    expect(ws.databases).toHaveLength(1);
    const [db] = ws.databases;
    expect(db.name).toBe("Tasks");
    expect(db.grading).toBeUndefined();
    expect(db.properties.map((p) => [p.name, p.type])).toEqual([
      ["Title", "text"],
      ["Status", "select"],
      // The related database is not copied: the titles the visitor saw become text.
      ["Course", "text"],
    ]);
    expect(db.rows).toHaveLength(1);
    expect(db.rows[0].source).toBeUndefined();
    expect(Object.values(db.rows[0].cells)).toEqual(["Lab report", "opt_todo", "Biology 101"]);
    // Only the option a copied cell uses.
    expect(db.properties[1].options).toEqual([{ id: "opt_todo", label: "To do" }]);
    // One view (the one on the page); its sort on a hidden column is dropped,
    // and its filter with it, since its value names an option.
    expect(db.views).toHaveLength(1);
    expect(db.views[0]).toMatchObject({ name: "Open", type: "table" });
    expect(db.views[0].sorts).toBeUndefined();
    expect(db.views[0].filters).toBeUndefined();
    const block = ws.pages[0].blocks.find((b): b is DatabaseViewBlock => b.type === "database_view");
    expect(block).toMatchObject({ databaseId: db.id, viewId: db.views[0].id });
  });

  it("is a valid workspace for the normal save path (nothing to repair)", () => {
    const { workspace, repaired } = prepareWorkspaceForSave(copyFor(false), "new-workspace");
    expect(repaired).toBe(false);
    expect(workspace.pages[0].title).toBe("Cell biology");
  });

  it("is named 'Untitled' (in the student's language) when the page has no title", () => {
    const page = { ...sharedPage(), title: "  " };
    const ws = buildPageCopy(page, sharedWorkspace(), { sameOwner: false, today: TODAY, untitled: "Sin título" });
    expect(ws.name).toBe("Sin título");
  });
});

describe("Save a copy: tables hold exactly what the page's views showed", () => {
  function twoViewWorkspace(): { page: Page; ws: Workspace } {
    const db: Database = {
      id: "dbs_notes",
      name: "Notes",
      description: "SECRET-DESCRIPTION",
      properties: [
        { id: "p_title", name: "Title", type: "text" },
        {
          id: "p_tag",
          name: "Tag",
          type: "select",
          options: [
            { id: "o_bio", label: "Biology" },
            { id: "o_chem", label: "Chemistry" },
            { id: "o_private", label: "SECRET-OPTION" },
          ],
        },
        { id: "p_note", name: "Note", type: "text" },
        { id: "p_due", name: "Due", type: "date" },
      ],
      rows: [
        { id: "r1", cells: { p_title: "Cells", p_tag: "o_bio", p_note: "N1", p_due: "2026-11-20" } },
        { id: "r2", cells: { p_title: "Atoms", p_tag: "o_chem", p_note: "N2", p_due: "2026-11-21" } },
        { id: "r3", cells: { p_title: "SECRET-TITLE-R3", p_tag: "o_private", p_note: "SECRET-NOTE-R3" } },
        { id: "r4", cells: { p_title: "Enzymes", p_tag: "o_bio", p_note: "N4" } },
      ],
      views: [
        {
          // Biology rows, title and tag only.
          id: "v_bio",
          name: "Biology",
          type: "table",
          visiblePropertyIds: ["p_title", "p_tag"],
          filters: [{ propertyId: "p_tag", operator: "is", value: "o_bio" }],
        },
        {
          // Rows with a due date, title and note only; the filter's search text is private.
          id: "v_due",
          name: "Due",
          type: "table",
          visiblePropertyIds: ["p_title", "p_note"],
          filters: [
            { propertyId: "p_due", operator: "is_not_empty" },
            { propertyId: "p_title", operator: "not_contains", value: "SECRET-SEARCH" },
          ],
        },
      ],
    };
    const ws: Workspace = { id: WS_ID, name: "W", pages: [], databases: [db] };
    const page: Page = {
      id: "pg",
      title: "Two views",
      blocks: [
        { id: "b1", type: "database_view", databaseId: "dbs_notes", viewId: "v_bio" },
        { id: "b2", type: "database_view", databaseId: "dbs_notes", viewId: "v_due" },
      ],
    };
    ws.pages.push(page);
    return { page, ws };
  }

  it("copies a cell only where some view showed that column for that row", () => {
    const { page, ws } = twoViewWorkspace();
    const copy = buildPageCopy(page, ws, { sameOwner: false, today: TODAY, untitled: "U", newId: counter() });
    const [db] = copy.databases;
    const json = JSON.stringify(copy);
    expect(json).not.toContain("SECRET");
    expect(db.description).toBeUndefined();
    // r1 and r4 (Biology), then r2 (due date); r3 was in no view.
    expect(db.rows.map((r) => r.cells)).toEqual([
      // r1: Biology showed title + tag, Due showed title + note.
      { p_title: "Cells", p_tag: "o_bio", p_note: "N1" },
      // r4: only Biology showed it, so its note stays blank.
      { p_title: "Enzymes", p_tag: "o_bio" },
      // r2: only Due showed it, so its tag (Chemistry) stays blank.
      { p_title: "Atoms", p_note: "N2" },
    ]);
    // The due column was never shown: not copied at all.
    expect(db.properties.map((p) => p.id)).toEqual(["p_title", "p_tag", "p_note"]);
    // Only options a copied cell uses.
    expect(db.properties[1].options).toEqual([{ id: "o_bio", label: "Biology" }]);
  });

  it("keeps each view's columns and only value-free filters on copied columns", () => {
    const { page, ws } = twoViewWorkspace();
    const copy = buildPageCopy(page, ws, { sameOwner: false, today: TODAY, untitled: "U", newId: counter() });
    const [db] = copy.databases;
    expect(db.views.map((v) => [v.name, v.visiblePropertyIds, v.filters])).toEqual([
      ["Biology", ["p_title", "p_tag"], undefined],
      // is_not_empty on Due goes with its column; the search text goes with its value.
      ["Due", ["p_title", "p_note"], undefined],
    ]);
    const blocks = copy.pages[0].blocks as DatabaseViewBlock[];
    expect(blocks.map((b) => b.viewId)).toEqual(db.views.map((v) => v.id));
    expect(prepareWorkspaceForSave(copy, "new-workspace").repaired).toBe(false);
  });

  it("copies the rows a sorted view showed past the row cap, not the first ones stored", () => {
    const db: Database = {
      id: "dbs_big",
      name: "Big",
      properties: [
        { id: "p_title", name: "Title", type: "text" },
        { id: "p_score", name: "Score", type: "number" },
      ],
      rows: Array.from({ length: PUBLIC_ROW_CAP + 50 }, (_, i) => ({ id: `r${i}`, cells: { p_title: `Row ${i}`, p_score: i } })),
      views: [{ id: "v_top", name: "Top", type: "table", sorts: [{ propertyId: "p_score", direction: "desc" }] }],
    };
    const page: Page = { id: "pg", title: "Big", blocks: [{ id: "b", type: "database_view", databaseId: "dbs_big", viewId: "v_top" }] };
    const ws: Workspace = { id: WS_ID, name: "W", pages: [page], databases: [db] };

    const [table] = toPublicPage(page, ws, { token: "t", today: TODAY }).blocks.filter((b) => b.type === "table");
    const copy = buildPageCopy(page, ws, { sameOwner: false, today: TODAY, untitled: "U", newId: counter() });
    const titles = copy.databases[0].rows.map((r) => r.cells.p_title);
    expect(titles).toHaveLength(PUBLIC_ROW_CAP);
    // The same rows, in the same order, as the shared table.
    if (table?.type !== "table") throw new Error("expected a table");
    expect(titles).toEqual(table.rows.map((r) => r[0]));
    expect(titles[0]).toBe(`Row ${PUBLIC_ROW_CAP + 49}`);
    expect(titles).not.toContain("Row 0");
    expect(copy.databases[0].views[0].sorts).toEqual([{ propertyId: "p_score", direction: "desc" }]);
  });
});

describe("Save a copy: the sharer's own copy", () => {
  it("keeps their images and their links", () => {
    const ws = copyFor(true);
    const blocks = ws.pages[0].blocks;
    expect(types(blocks)).toContain("media");
    expect((blocks[1] as { text: string }).text).toContain(`/app/${WS_ID}?page=pg_private`);
    expect((blocks[1] as { text: string }).text).toContain("/api/asset/asset_inline");
    expect(blocks.find((b) => b.type === "media")?.id).not.toBe("blk_media");
  });
});

describe("withoutAssetImages", () => {
  it("turns uploaded images into their alt text and leaves everything else", () => {
    expect(withoutAssetImages("a ![x](/api/asset/abc) b")).toBe("a x b");
    expect(withoutAssetImages('![](https://studyos.app/api/asset/abc "t")')).toBe("");
    expect(withoutAssetImages('<img src="/api/asset/abc" alt="y">z')).toBe("z");
    expect(withoutAssetImages("![ok](data:image/png;base64,AAAA) [link](https://x.y)")).toBe(
      "![ok](data:image/png;base64,AAAA) [link](https://x.y)",
    );
  });
});
