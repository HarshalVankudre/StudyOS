import { describe, expect, it } from "vitest";
import type { Database, Workspace } from "@/lib/workspace/types";
import { PUBLIC_ROW_CAP } from "./config";
import type { Block, Page } from "@/lib/workspace/types";
import {
  markdownImageAssetIds,
  publicAssetIds,
  publicQuestion,
  scrubString,
  toPublicPage,
  type PublicBlock,
} from "./public-view";
import { PRIVATE_IDS, sharedPage, sharedWorkspace, TOKEN, WS_ID } from "./share-fixture";

const TODAY = "2026-11-13";
const view = () => toPublicPage(sharedPage(), sharedWorkspace(), { token: TOKEN, today: TODAY });
const ofType = <T extends PublicBlock["type"]>(blocks: PublicBlock[], type: T) =>
  blocks.filter((b): b is Extract<PublicBlock, { type: T }> => b.type === type);

describe("the read-only view of a shared page", () => {
  it("keeps the page's blocks in order, leaves grades out and turns a component into a placeholder", () => {
    const page = view();
    expect(page.title).toBe("Cell biology");
    expect(page.icon).toBe("🧬");
    expect(page.blocks.map((b) => (b.type === "text" ? b.kind : b.type))).toEqual([
      "heading1",
      "paragraph",
      "numbered_list_item",
      "numbered_list_item",
      "todo",
      "callout",
      "divider",
      "image",
      "table",
      "flashcards",
      "quiz",
      "hidden",
    ]);
    const json = JSON.stringify(page);
    expect(json).not.toContain("My GPA");
    expect(json).not.toContain("SECRET_SOURCE");
  });

  it("never sends an id of the workspace, another page, or anything private", () => {
    const json = JSON.stringify(view());
    for (const id of PRIVATE_IDS) expect(json, id).not.toContain(id);
    for (const id of ["prop_title", "prop_status", "opt_todo", "row_course"]) expect(json, id).not.toContain(id);
    expect(json).not.toContain("SECRET-OTHER-PAGE");
    expect(json).not.toContain("Diary");
    expect(json).not.toContain("HIDDEN-ROW");
    expect(json).not.toContain("HIDDEN-COLUMN");
    expect(json).not.toContain("Fall semester");
  });

  it("replaces a deep link a student pasted, so no workspace or other page can be named", () => {
    const paragraph = view().blocks[1];
    expect(paragraph).toMatchObject({ type: "text", kind: "paragraph" });
    // The link text stays; the target is gone (and rendered as plain text, see rehype-share).
    expect((paragraph as { text: string }).text).toBe("See [my other page](…) and ![diagram](/api/asset/asset_inline)");
  });

  it("replaces deep links on any host, to any workspace, in every kind of text", () => {
    const other = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
    const page = sharedPage();
    page.title = `Notes (${WS_ID})`;
    page.blocks = [
      { id: "a", type: "paragraph", text: `Autolink https://studyos.app/app/${other}?page=pg_x&block=blk_y done` },
      { id: "b", type: "flashcards", cards: [{ id: "c", front: `"quoted /app/${other}?db=d1&row=r1"`, back: "b\\n" }] },
      { id: "c2", type: "paragraph", text: "An app store link https://example.com/app/download stays" },
    ];
    const json = JSON.stringify(toPublicPage(page, sharedWorkspace(), { token: TOKEN, today: TODAY }));
    for (const leak of [other, WS_ID, "pg_x", "blk_y", "row=r1"]) expect(json, leak).not.toContain(leak);
    expect(json).toContain("Autolink … done");
    expect(json).toContain('\\"quoted …\\"');
    expect(json).toContain("https://example.com/app/download");
  });

  it("numbers lists, keeps to-do state and callout emoji", () => {
    const text = ofType(view().blocks, "text");
    expect(text.filter((b) => b.kind === "numbered_list_item").map((b) => b.number)).toEqual([1, 2]);
    expect(text.find((b) => b.kind === "todo")).toMatchObject({ checked: true, text: "done thing" });
    expect(text.find((b) => b.kind === "callout")).toMatchObject({ emoji: "💡", text: "Remember" });
  });

  it("serves images through the share's own asset route", () => {
    const [image] = ofType(view().blocks, "image");
    expect(image).toEqual({ type: "image", src: `/s/${TOKEN}/asset/asset_block`, alt: "Mitosis", caption: "Mitosis" });
  });

  it("shows a database view as a plain table of what that view shows", () => {
    const [table] = ofType(view().blocks, "table");
    expect(table).toEqual({
      type: "table",
      name: "Tasks",
      icon: "✅",
      viewName: "Open",
      columns: ["Title", "Status", "Course"],
      rows: [["Lab report", "To do", "Biology 101"]],
      more: 0,
    });
  });

  it(`caps a table at ${PUBLIC_ROW_CAP} rows and says how many more there are`, () => {
    const ws = sharedWorkspace();
    const db = ws.databases[0] as Database;
    db.views = [{ id: "vw_all", name: "All", type: "table", visiblePropertyIds: ["prop_title", "prop_done"] }];
    db.rows = Array.from({ length: PUBLIC_ROW_CAP + 50 }, (_, i) => ({
      id: `r${i}`,
      cells: { prop_title: `Row ${i}`, prop_done: i % 2 === 0 },
    }));
    const page = { id: "p", title: "Big", blocks: [{ id: "b", type: "database_view" as const, databaseId: db.id, viewId: "vw_all" }] };
    const [table] = ofType(toPublicPage(page, ws, { token: TOKEN, today: TODAY }).blocks, "table");
    expect(table.rows).toHaveLength(PUBLIC_ROW_CAP);
    expect(table.more).toBe(50);
    expect(table.rows[0]).toEqual(["Row 0", "✓"]);
    expect(table.rows[1]).toEqual(["Row 1", ""]);
  });

  it("sends flashcards as front and back only, without scheduling, history or citations", () => {
    const [deck] = ofType(view().blocks, "flashcards");
    expect(deck).toEqual({ type: "flashcards", title: "Deck", cards: [{ front: "Q1", back: "A1" }] });
  });

  it("sends quiz questions for practice, without stats, attempts, citations or broken questions", () => {
    const [quiz] = ofType(view().blocks, "quiz");
    expect(quiz).toEqual({
      type: "quiz",
      title: "Check",
      questions: [
        { kind: "mcq", prompt: "2+2?", choices: ["3", "4"], answerIndex: 1, explanation: "math", topic: "Arithmetic" },
        { kind: "true_false", prompt: "Sky is blue", answer: true },
        { kind: "short", prompt: "Define cell", answer: "Unit of life" },
      ],
    });
  });

  it("drops questions without a usable answer key", () => {
    expect(publicQuestion({ id: "a", kind: "short", prompt: "Why?" })).toBeNull();
    expect(publicQuestion({ id: "b", kind: "true_false", prompt: "T?" })).toBeNull();
    expect(publicQuestion({ id: "c", kind: "mcq", prompt: "", choices: ["a", "b"], answerIndex: 0 })).toBeNull();
    expect(publicQuestion({ id: "d", kind: "mcq", prompt: "Pick", choices: ["a", "b"], answerIndex: 2 })).toBeNull();
  });

  it("shows an empty page as empty, and a table whose database is gone not at all", () => {
    const ws: Workspace = { ...sharedWorkspace(), databases: [] };
    const page = { id: "p", title: "", blocks: [{ id: "b", type: "database_view" as const, databaseId: "gone", viewId: "v" }] };
    expect(toPublicPage(page, ws, { token: TOKEN, today: TODAY })).toEqual({ title: "", blocks: [] });
  });
});

describe("headings above a section that is left out", () => {
  const page = (blocks: Block[]): Page => ({ id: "p", title: "T", blocks });
  const kinds = (blocks: Block[]) =>
    toPublicPage(page(blocks), sharedWorkspace(), { token: TOKEN, today: TODAY }).blocks.map((b) =>
      b.type === "text" ? `${b.kind}:${b.text}` : b.type,
    );
  const h = (id: string, level: 1 | 2 | 3, text: string): Block => ({ id, type: "heading", level, text });
  const grades: Block = { id: "g", type: "grades", title: "My GPA", databaseId: "dbs_tasks" };
  const para = (text: string): Block => ({ id: `p_${text}`, type: "paragraph", text });

  it("go when every block of their section is hidden, nested headings included", () => {
    expect(kinds([h("a", 1, "Notes"), para("hi"), h("b", 1, "Grades"), grades, h("c", 1, "Next"), para("x")])).toEqual([
      "heading1:Notes",
      "paragraph:hi",
      "heading1:Next",
      "paragraph:x",
    ]);
    // "Term 1" holds only the grades, so "Grades" holds nothing shown either.
    expect(kinds([h("a", 1, "Grades"), h("b", 2, "Term 1"), grades, h("c", 1, "End")])).toEqual(["heading1:End"]);
  });

  it("stay when anything in the section is shown, or when the section was empty in the page", () => {
    expect(kinds([h("a", 1, "Grades"), grades, para("Weights below"), h("b", 1, "Empty"), h("c", 2, "Also empty")])).toEqual([
      "heading1:Grades",
      "paragraph:Weights below",
      "heading1:Empty",
      "heading2:Also empty",
    ]);
    // A kept sub-heading keeps its parent.
    expect(kinds([h("a", 1, "Course"), h("b", 2, "Lab"), para("notes"), h("c", 2, "Grades"), grades])).toEqual([
      "heading1:Course",
      "heading2:Lab",
      "paragraph:notes",
    ]);
  });
});

describe("images a share link may serve", () => {
  const assets = (page: Page) => [...publicAssetIds(toPublicPage(page, sharedWorkspace(), { token: TOKEN, today: TODAY }))].sort();

  it("are the page's image blocks and the uploaded images its Markdown embeds", () => {
    expect(assets(sharedPage())).toEqual(["asset_block", "asset_inline"]);
  });

  it("include images inside flashcards and quiz text, and nothing from other pages", () => {
    const ws = sharedWorkspace();
    const page = sharedPage();
    const deck = page.blocks.find((b) => b.type === "flashcards");
    if (deck?.type === "flashcards") deck.cards[0].back = "![](https://studyos.app/api/asset/asset_card)";
    ws.pages[1].blocks.push({ id: "x", type: "media", assetId: "asset_private", mediaKind: "image", mime: "image/png" });
    const ids = publicAssetIds(toPublicPage(page, ws, { token: TOKEN, today: TODAY }));
    expect(ids.has("asset_card")).toBe(true);
    expect(ids.has("asset_private")).toBe(false);
  });

  it("are only images the view renders: not links, captions, hidden blocks or questions it leaves out", () => {
    const page: Page = {
      id: "p",
      title: "T",
      blocks: [
        { id: "a", type: "paragraph", text: "A [link](/api/asset/asset_link) and `/api/asset/asset_code_path`" },
        { id: "b", type: "media", assetId: "asset_shown", mediaKind: "image", mime: "image/png", caption: "![x](/api/asset/asset_caption)" },
        { id: "c", type: "media", assetId: "asset_pdf", mediaKind: "pdf" as "image", mime: "application/pdf" },
        { id: "d", type: "react_artifact", title: "Sim", source: "<img src='/api/asset/asset_component'>" },
        { id: "e", type: "grades", title: "![g](/api/asset/asset_grades)", databaseId: "dbs_tasks" },
        {
          id: "f",
          type: "quiz",
          questions: [
            { id: "q1", kind: "short", prompt: "![q](/api/asset/asset_question)" },
            { id: "q2", kind: "true_false", prompt: "T?", answerBool: true, choices: ["![c](/api/asset/asset_tf_choice)"] },
          ],
        },
        {
          id: "g",
          type: "flashcards",
          cards: [{ id: "c1", front: "", back: "![b](/api/asset/asset_blank_card)" }],
        },
      ],
    };
    expect(assets(page)).toEqual(["asset_shown"]);
  });

  it("read every Markdown image form the renderer shows", () => {
    expect(markdownImageAssetIds('![a](/api/asset/one "t") ![b](<https://other.host/api/asset/two>)')).toEqual(["one", "two"]);
    expect(markdownImageAssetIds('<img alt="x" src="/api/asset/three"> <img src=/api/asset/four>')).toEqual(["three", "four"]);
    expect(markdownImageAssetIds("![Fig][f1] ![f2][] ![f3]\n\n[f1]: /api/asset/five\n[F2]: </api/asset/six>\n[f3]: /api/asset/seven")).toEqual([
      "five",
      "six",
      "seven",
    ]);
    // A defined label that no image uses, other paths and data URIs serve nothing.
    expect(markdownImageAssetIds("[ref]: /api/asset/unused\n![x](/icons/a.png) ![y](data:image/png;base64,AA)")).toEqual([]);
    expect(markdownImageAssetIds("![x](/api/asset/../etc)")).toEqual([]);
  });
});

describe("scrubString", () => {
  it("replaces an id everywhere in JSON data and leaves short or absent ids alone", () => {
    expect(scrubString({ a: [`x ${WS_ID} y`], b: WS_ID }, WS_ID)).toEqual({ a: ["x … y"], b: "…" });
    expect(scrubString({ a: "w1 w1" }, "w1")).toEqual({ a: "w1 w1" });
    expect(scrubString({ a: "text" }, undefined)).toEqual({ a: "text" });
  });
});
