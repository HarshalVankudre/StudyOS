// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { workspaceHref } from "@/lib/workspace/deep-link";
import { prepareWorkspaceForSave, repairWorkspace } from "@/lib/workspace/repair";
import { safeParseWorkspace } from "@/lib/workspace/schema";
import type { Block, Page, Workspace } from "@/lib/workspace/types";
import { importNotionExport, sniffImage, type NotionImportOptions } from "./build";
import { NotionImportError, type NotionImportLimits } from "./limits";
import { makeZip, nid } from "./zip-fixture";

const WS = "ws-1";
const C = nid(1);
const W1 = nid(2);
const W2 = nid(3);
const T = nid(4);
const R1 = nid(5);
const R2 = nid(6);
const G = nid(7);

/** A minimal PNG (signature + IHDR), 640 x 480. */
const PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 2, 128, 0, 0, 1, 224, 8, 6, 0, 0, 0, 0, 0, 0,
]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46]);

const TASKS_CSV = 'Name,Status,Due\nEssay,Done,"March 3, 2024"\nQuiz,To do,"March 10, 2024"\n';
const TASKS_ALL_CSV = `${TASKS_CSV}Lab,To do,\n`;

function courseExport(extra: Record<string, string | Uint8Array> = {}) {
  return makeZip({
    [`Course ${C}.md`]: [
      "# Course",
      "",
      "Welcome to **the course**.",
      "",
      `[Week 1](Course%20${C}/Week%201%20${W1}.md)`,
      "",
      `[Tasks](Course%20${C}/Tasks%20${T}.csv)`,
      "",
      `See [week two](Course%20${C}/Week%202%20${W2}.md), [the anchor](#x), [the web](https://example.org) and [missing](Nope.md).`,
      "",
      `Also [in Notion](https://www.notion.so/Week-1-${W1}).`,
    ].join("\n"),
    [`Course ${C}/Week 1 ${W1}.md`]: [
      "# Week 1",
      "",
      "## Topics",
      "",
      "- [ ] Read chapter 1",
      "- [x] Watch lecture",
      "",
      "<aside>",
      "💡 Exam on Friday",
      "</aside>",
      "",
      "```js",
      "console.log(1)",
      "```",
      "",
      "$$",
      "a^2+b^2=c^2",
      "$$",
      "",
      "---",
      "",
      "> Quote",
      "",
      `![Diagram](Week%201%20${W1}/diagram.png)`,
      "",
      "![Web pic](https://example.org/pic.png)",
      "",
      `[Syllabus.pdf](Week%201%20${W1}/Syllabus.pdf)`,
      "",
      "| Term | Meaning |",
      "| --- | --- |",
      "| Cell | Unit of life |",
      "| Atom | Unit of matter |",
    ].join("\n"),
    [`Course ${C}/Week 1 ${W1}/diagram.png`]: PNG,
    [`Course ${C}/Week 1 ${W1}/Syllabus.pdf`]: "%PDF-1.4 not really",
    [`Course ${C}/Week 1 ${W1}/Readings ${G}.md`]: "# Readings\n\nRead the paper.",
    [`Course ${C}/Week 2 ${W2}.md`]: `# Week 2\n\nBack to [Course](../Course%20${C}.md).`,
    [`Course ${C}/Tasks ${T}.csv`]: TASKS_CSV,
    [`Course ${C}/Tasks ${T}_all.csv`]: TASKS_ALL_CSV,
    [`Course ${C}/Tasks ${T}/Essay ${R1}.md`]: "# Essay\n\nStatus: Done\nDue: March 3, 2024\n\nDraft outline here.",
    [`Course ${C}/Tasks ${T}/Quiz ${R2}.md`]: "# Quiz\n\nStatus: To do\nDue: March 10, 2024\n",
    "__MACOSX/._junk": "junk",
    ...extra,
  });
}

async function run(bytes: Uint8Array, options: Partial<NotionImportOptions> & { limits?: Partial<NotionImportLimits> } = {}) {
  const result = await importNotionExport(bytes, { workspaceId: WS, ...options });
  // Everything the import makes is a workspace the store accepts unchanged.
  expect(safeParseWorkspace(result.workspace).success).toBe(true);
  expect(repairWorkspace(result.workspace)?.issues).toEqual([]);
  expect(() => prepareWorkspaceForSave(result.workspace, WS)).not.toThrow();
  return result;
}

const page = (ws: Workspace, title: string): Page => {
  const found = ws.pages.find((p) => p.title === title);
  if (!found) throw new Error(`no page ${title}: ${ws.pages.map((p) => p.title).join(", ")}`);
  return found;
};
const href = (ws: Workspace, title: string) => workspaceHref({ workspaceId: WS, pageId: page(ws, title).id });
const texts = (p: Page) => p.blocks.map((b) => ("text" in b ? b.text : b.type));
const ofType = <T extends Block["type"]>(p: Page, type: T) => p.blocks.filter((b): b is Extract<Block, { type: T }> => b.type === type);

async function codeOf(promise: Promise<unknown>): Promise<string | null> {
  try {
    await promise;
    return null;
  } catch (error) {
    return error instanceof NotionImportError ? error.code : `other: ${String(error)}`;
  }
}

describe("importNotionExport: the page tree", () => {
  it("names the workspace after its single top-level page, which becomes home", async () => {
    const { workspace } = await run(courseExport());
    expect(workspace.name).toBe("Course");
    expect(workspace.homePageId).toBe(page(workspace, "Course").id);
    expect(workspace.id).toBe(WS);
  });

  it("keeps the tree as order: each page, then its subpages, then its databases' row pages", async () => {
    const { workspace } = await run(courseExport());
    expect(workspace.pages.map((p) => p.title)).toEqual(["Course", "Week 1", "Readings", "Essay", "Week 2"]);
  });

  it("lists subpages the parent never linked at the end of the parent", async () => {
    const { workspace } = await run(courseExport());
    const week1 = page(workspace, "Week 1");
    const tail = texts(week1).slice(-2);
    expect(tail).toEqual(["Subpages", `[Readings](${href(workspace, "Readings")})`]);
  });

  it("is deterministic", async () => {
    const a = await run(courseExport());
    const b = await run(courseExport());
    expect(b).toEqual(a);
  });

  it("makes a home page listing the top-level pages when there are several", async () => {
    const { workspace } = await run(
      makeZip({ [`Biology ${nid(1)}.md`]: "# Biology\n\nCells.", [`Art ${nid(2)}.md`]: "# Art\n\nColour.", [`Reading list ${nid(3)}.csv`]: "Name\nDune\n" }),
      { labels: { workspaceName: "Aus Notion", homeIntro: "Importiert." } },
    );
    expect(workspace.name).toBe("Aus Notion");
    const home = workspace.pages[0];
    expect(workspace.homePageId).toBe(home.id);
    expect(home.title).toBe("Aus Notion");
    expect(texts(home)).toEqual([
      "Importiert.",
      `[Art](${href(workspace, "Art")})`,
      `[Biology](${href(workspace, "Biology")})`,
      `[Reading list](${href(workspace, "Reading list")})`,
    ]);
  });

  it("gives a top-level database a page of its own (home when it is all there is)", async () => {
    const { workspace } = await run(makeZip({ [`Books ${nid(9)}_all.csv`]: "Name,Read\nDune,Yes\nEmma,No\n" }));
    expect(workspace.name).toBe("Books");
    const host = page(workspace, "Books");
    expect(workspace.homePageId).toBe(host.id);
    expect(ofType(host, "database_view")).toEqual([
      expect.objectContaining({ databaseId: workspace.databases[0].id, viewId: workspace.databases[0].views[0].id }),
    ]);
  });

  it("understands exports without ids in the names", async () => {
    const { workspace } = await run(makeZip({ "Notes.md": "# Notes\n\n[Sub](Notes/Sub.md)", "Notes/Sub.md": "# Sub\n\nHi" }));
    expect(workspace.pages.map((p) => p.title)).toEqual(["Notes", "Sub"]);
    expect(texts(page(workspace, "Notes"))).toEqual([`[Sub](${href(workspace, "Sub")})`]);
  });

  it("finds a page's folder by its id when Notion shortened the folder's name", async () => {
    const long = "A very long lecture title that Notion shortens";
    const { workspace } = await run(
      makeZip({
        [`${long} ${nid(1)}.md`]: `# ${long}\n\nIntro`,
        [`A very long lecture ${nid(1)}/Part 2 ${nid(2)}.md`]: "# Part 2\n\nMore",
      }),
    );
    expect(workspace.pages.map((p) => p.title)).toEqual([long, "Part 2"]);
    expect(workspace.name).toBe(long);
  });

  it("refuses a zip without pages or databases", async () => {
    expect(await codeOf(importNotionExport(makeZip({ "photo.png": PNG, "notes.txt": "x" }), { workspaceId: WS }))).toBe("not_notion");
    expect(await codeOf(importNotionExport(new TextEncoder().encode("hello"), { workspaceId: WS }))).toBe("not_zip");
  });

  it("opens Notion's split exports (zips inside the zip)", async () => {
    const outer = makeZip(
      {
        "Export-1-Part-1.zip": makeZip({ [`Course ${C}.md`]: `# Course\n\n[Week 2](Course%20${C}/Week%202%20${W2}.md)` }),
        "Export-1-Part-2.zip": makeZip({ [`Course ${C}/Week 2 ${W2}.md`]: "# Week 2\n\nHello" }),
      },
      0,
    );
    const { workspace } = await run(outer);
    expect(workspace.pages.map((p) => p.title)).toEqual(["Course", "Week 2"]);
    expect(texts(page(workspace, "Course"))).toEqual([`[Week 2](${href(workspace, "Week 2")})`]);
  });
});

describe("importNotionExport: Markdown", () => {
  it("converts every construct into StudyOS blocks", async () => {
    const { workspace } = await run(courseExport());
    const week1 = page(workspace, "Week 1");
    const types = week1.blocks.map((b) => (b.type === "heading" ? `h${b.level}` : b.type));
    expect(types).toEqual([
      "h2",
      "todo",
      "todo",
      "callout",
      "paragraph", // code
      "paragraph", // math
      "divider",
      "quote",
      "paragraph", // image note (no image storage)
      "paragraph", // web image as a link
      "paragraph", // attachment
      "database_view", // the Markdown table
      "h3",
      "bulleted_list_item",
    ]);
    const [, open, done, callout, code, math] = week1.blocks;
    expect(open).toMatchObject({ type: "todo", text: "Read chapter 1", checked: false });
    expect(done).toMatchObject({ type: "todo", text: "Watch lecture", checked: true });
    expect(callout).toMatchObject({ type: "callout", text: "Exam on Friday", emoji: "💡" });
    expect(code).toMatchObject({ text: "```js\nconsole.log(1)\n```" });
    expect(math).toMatchObject({ text: "$$\na^2+b^2=c^2\n$$" });
    expect(texts(week1).slice(8, 11)).toEqual([
      "*Image not imported: diagram.png*",
      "[Web pic](https://example.org/pic.png)",
      "Syllabus.pdf *(file not imported)*",
    ]);
  });

  it("turns a Markdown table into a small database shown in its place", async () => {
    const { workspace } = await run(courseExport());
    const table = workspace.databases.find((d) => d.name === "Table from Week 1")!;
    expect(table.properties.map((p) => [p.name, p.type])).toEqual([
      ["Term", "text"],
      ["Meaning", "text"],
    ]);
    expect(table.rows.map((r) => r.cells[table.properties[0].id])).toEqual(["Cell", "Atom"]);
    expect(ofType(page(workspace, "Week 1"), "database_view")[0].databaseId).toBe(table.id);
  });

  it("rewrites links between exported pages, notion.so links included, and drops dead ones to text", async () => {
    const { workspace } = await run(courseExport());
    const course = page(workspace, "Course");
    expect(texts(course)).toContain(
      `See [week two](${href(workspace, "Week 2")}), the anchor, [the web](https://example.org) and missing.`,
    );
    expect(texts(course)).toContain(`Also [in Notion](${href(workspace, "Week 1")}).`);
    expect(texts(page(workspace, "Week 2"))).toEqual([`Back to [Course](${href(workspace, "Course")}).`]);
  });

  it("stores images as media when storage takes them, and notes the ones it does not", async () => {
    const storeImage = vi.fn(async ({ mime }: { mime: string }) => (mime === "image/png" ? "asset-1" : null));
    const { workspace, summary } = await run(
      courseExport({
        [`Course ${C}/Week 2 ${W2}.md`]: `# Week 2\n\n![Photo](Week%202%20${W2}/photo.jpg)\n\n![Again](../Course%20${C}/Week%201%20${W1}/diagram.png)`,
        [`Course ${C}/Week 2 ${W2}/photo.jpg`]: JPEG,
      }),
      { storeImage },
    );
    const media = ofType(page(workspace, "Week 1"), "media");
    expect(media).toEqual([
      expect.objectContaining({ assetId: "asset-1", mediaKind: "image", mime: "image/png", width: 640, height: 480, alt: "Diagram" }),
    ]);
    // The same image used twice is stored once.
    expect(ofType(page(workspace, "Week 2"), "media")[0]).toMatchObject({ assetId: "asset-1" });
    expect(storeImage).toHaveBeenCalledTimes(2);
    expect(storeImage).toHaveBeenCalledWith(expect.objectContaining({ mime: "image/jpeg", name: "photo.jpg" }));
    expect(texts(page(workspace, "Week 2"))[0]).toBe("*Image not imported: photo.jpg*");
    expect(summary.images).toBe(2);
    expect(summary.skipped).toContainEqual({ reason: "image", count: 1, examples: ["photo.jpg"] });
  });

  it("sniffs image types from their bytes", () => {
    expect(sniffImage(PNG)).toBe("image/png");
    expect(sniffImage(JPEG)).toBe("image/jpeg");
    expect(sniffImage(new TextEncoder().encode("GIF89a..."))).toBe("image/gif");
    expect(sniffImage(new TextEncoder().encode("<svg/>"))).toBeNull();
  });
});

describe("importNotionExport: databases", () => {
  it("prefers _all.csv and embeds the database where its page linked it", async () => {
    const { workspace } = await run(courseExport());
    const tasks = workspace.databases.find((d) => d.name === "Tasks")!;
    expect(tasks.rows).toHaveLength(3);
    expect(tasks.properties.map((p) => [p.name, p.type])).toEqual([
      ["Name", "text"],
      ["Status", "status"],
      ["Due", "date"],
    ]);
    expect(tasks.views.map((v) => v.type)).toEqual(["table", "board", "calendar"]);
    const course = page(workspace, "Course");
    const at = course.blocks.findIndex((b) => b.type === "database_view" && b.databaseId === tasks.id);
    expect(texts(course)[at - 1]).toBe(`[Week 1](${href(workspace, "Week 1")})`);
  });

  it("imports a row's page when it has content beyond the row's fields, listed under the table", async () => {
    const { workspace } = await run(courseExport());
    const essay = page(workspace, "Essay");
    expect(texts(essay)).toEqual(["Draft outline here."]);
    expect(workspace.pages.some((p) => p.title === "Quiz")).toBe(false);
    const course = page(workspace, "Course");
    const at = course.blocks.findIndex((b) => b.type === "database_view");
    expect(texts(course).slice(at + 1, at + 3)).toEqual(["Pages in Tasks", `[Essay](${href(workspace, "Essay")})`]);
  });

  it("puts a database its page never linked at the end of that page", async () => {
    const { workspace } = await run(
      makeZip({ [`Class ${nid(1)}.md`]: "# Class\n\nIntro", [`Class ${nid(1)}/Grades ${nid(2)}.csv`]: "Name,Score\nQuiz 1,90\nQuiz 2,85\n" }),
    );
    const blocks = page(workspace, "Class").blocks;
    expect(blocks.map((b) => b.type)).toEqual(["paragraph", "heading", "database_view"]);
    expect(workspace.databases[0].properties[1].type).toBe("number");
  });

  it("reads ambiguous numeric dates day first when asked", async () => {
    const zip = makeZip({ [`Due ${nid(1)}.csv`]: "Name,Date\nA,03/04/2024\nB,05/06/2024\n" });
    const db = (await run(zip, { dayFirst: true })).workspace.databases[0];
    expect(db.rows.map((r) => r.cells[db.properties[1].id])).toEqual(["2024-04-03", "2024-06-05"]);
  });
});

describe("importNotionExport: caps and the summary", () => {
  const wide = () => {
    const files: Record<string, string> = { [`Root ${nid(100)}.md`]: "# Root\n\nTop" };
    for (let i = 1; i <= 6; i += 1) files[`Root ${nid(100)}/Child ${i} ${nid(i)}.md`] = `# Child ${i}\n\nText ${i}`;
    files[`Root ${nid(100)}/Child 1 ${nid(1)}/Grandchild ${nid(50)}.md`] = "# Grandchild\n\nDeep";
    return makeZip(files);
  };

  it("reports a clean import with counts and the attachments it did not keep", async () => {
    const { summary } = await run(courseExport());
    expect(summary).toEqual({
      pages: 5,
      databases: 2,
      rows: 5,
      images: 0,
      skipped: [
        { reason: "image", count: 1, examples: ["diagram.png"] },
        { reason: "attachment", count: 1, examples: ["Syllabus.pdf"] },
      ],
    });
  });

  it("imports pages up to the page cap and reports the rest", async () => {
    const { workspace, summary } = await run(wide(), { limits: { maxPages: 3 } });
    expect(workspace.pages.map((p) => p.title)).toEqual(["Root", "Child 1", "Grandchild"]);
    expect(summary.skipped).toEqual([{ reason: "page_limit", count: 5, examples: ["Child 2", "Child 3", "Child 4"] }]);
    // The Subpages list only links pages that exist.
    expect(texts(page(workspace, "Root")).filter((t) => t.includes("]("))).toEqual([`[Child 1](${href(workspace, "Child 1")})`]);
  });

  it("caps rows per database, columns and databases", async () => {
    const rows = Array.from({ length: 5 }, (_, i) => `Row ${i},${i}`).join("\n");
    const zip = makeZip({ [`A ${nid(1)}.csv`]: `Name,N,X,Y\n${rows}\n`, [`B ${nid(2)}.csv`]: "Name\nx\n" });
    const { workspace, summary } = await run(zip, { limits: { maxRowsPerDatabase: 2, maxColumns: 2, maxDatabases: 1 } });
    expect(workspace.databases).toHaveLength(1);
    expect(workspace.databases[0].rows).toHaveLength(2);
    expect(workspace.databases[0].properties).toHaveLength(2);
    expect(summary.skipped).toEqual([
      { reason: "database_limit", count: 1, examples: ["B"] },
      { reason: "row_limit", count: 3, examples: ["A"] },
      { reason: "column_limit", count: 2, examples: ["A"] },
    ]);
  });

  it("cuts a page at the text limit and says so", async () => {
    const long = Array.from({ length: 50 }, (_, i) => `Paragraph ${i} ${"x".repeat(80)}`).join("\n\n");
    const { workspace, summary } = await run(makeZip({ [`Long ${nid(1)}.md`]: `# Long\n\n${long}` }), {
      limits: { maxPageChars: 1_000 },
    });
    const blocks = page(workspace, "Long").blocks;
    expect(blocks.length).toBeLessThan(15);
    expect(texts(page(workspace, "Long")).at(-1)).toBe("*The rest of this page was too long to import.*");
    expect(summary.skipped).toEqual([{ reason: "truncated", count: 1, examples: ["Long"] }]);
  });

  it("stays within the workspace size limit, dropping pages that do not fit and their links", async () => {
    const files: Record<string, string> = {
      [`Root ${nid(100)}.md`]: `# Root\n\n${Array.from({ length: 6 }, (_, i) => `[Child ${i + 1}](Root%20${nid(100)}/Child%20${i + 1}%20${nid(i + 1)}.md)`).join("\n\n")}`,
    };
    for (let i = 1; i <= 6; i += 1) files[`Root ${nid(100)}/Child ${i} ${nid(i)}.md`] = `# Child ${i}\n\n${"word ".repeat(400)}`;
    const { workspace, summary } = await run(makeZip(files), { limits: { workspaceBytes: 9_000 } });
    const kept = workspace.pages.map((p) => p.title);
    expect(kept.length).toBeGreaterThan(1);
    expect(kept.length).toBeLessThan(7);
    const dropped = 7 - kept.length;
    expect(summary.skipped).toContainEqual(expect.objectContaining({ reason: "size_limit", count: dropped }));
    // Links to dropped pages are plain text; links to kept pages still work.
    for (const text of texts(page(workspace, "Root"))) {
      const title = text.replace(/^\[|\]\(.*$/g, "");
      expect(text.includes("](")).toBe(kept.includes(title));
    }
    expect(new TextEncoder().encode(JSON.stringify(workspace)).length).toBeLessThan(9_000);
  });

  it("gives up with a timeout past its time budget", async () => {
    let clock = 0;
    const now = () => (clock += 1_000);
    expect(await codeOf(importNotionExport(wide(), { workspaceId: WS, now, limits: { timeoutMs: 5_000 } }))).toBe("timeout");
  });

  it("uses the student's language for what it writes", async () => {
    const { workspace } = await run(courseExport(), {
      labels: { subpages: "Unterseiten", rowPages: "Seiten in {name}", tableName: "Tabelle aus {page}", imageNotImported: "Bild nicht importiert: {name}", fileNotImported: "Datei nicht importiert" },
    });
    const week1 = texts(page(workspace, "Week 1"));
    expect(week1).toContain("Unterseiten");
    expect(week1).toContain("*Bild nicht importiert: diagram.png*");
    expect(week1).toContain("Syllabus.pdf *(Datei nicht importiert)*");
    expect(texts(page(workspace, "Course"))).toContain("Seiten in Tasks");
    expect(workspace.databases.map((d) => d.name)).toContain("Tabelle aus Week 1");
  });
});
