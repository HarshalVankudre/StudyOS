import { strFromU8, strToU8, unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import type { Database, Page, Workspace } from "@/lib/workspace/types";
import { CSV_BOM, csvField, databaseToCsv, neutraliseFormula } from "./csv";
import { pageToMarkdown, tableCell } from "./markdown";
import { safeFileName, workspaceFiles, workspaceToZip } from "./zip";

const courses: Database = {
  id: "courses",
  name: "Courses",
  icon: "🎓",
  properties: [{ id: "cname", name: "Course", type: "text" }],
  rows: [
    { id: "c1", cells: { cname: "Calculus" } },
    { id: "c2", cells: { cname: "Physics" } },
  ],
  views: [{ id: "cv", name: "All", type: "table" }],
};

const assignments: Database = {
  id: "db",
  name: "Assignments",
  icon: "📚",
  properties: [
    { id: "name", name: "Name", type: "text" },
    { id: "status", name: "Status", type: "status", options: [{ id: "open", label: "Open" }, { id: "done", label: "Done" }] },
    { id: "tags", name: "Tags", type: "multi_select", options: [{ id: "t1", label: "Exam" }, { id: "t2", label: "Group" }] },
    { id: "pts", name: "Points", type: "number" },
    { id: "ok", name: "Submitted", type: "checkbox" },
    { id: "due", name: "Due", type: "date" },
    { id: "course", name: "Course", type: "relation", relationDatabaseId: "courses" },
    { id: "link", name: "Link", type: "url" },
  ],
  rows: [
    {
      id: "r1",
      cells: { name: "Problem set, part 1", status: "open", tags: ["t1", "t2"], pts: -5, ok: true, due: "2026-11-20", course: ["c1", "c2"], link: "https://x.y" },
    },
    { id: "r2", cells: { name: '=HYPERLINK("http://evil","click")', status: "done", pts: 10, ok: false } },
    { id: "r3", cells: { name: "+1 extra credit", pts: null } },
    { id: "r4", cells: { name: "@SUM(A1:A2)\nsecond line" } },
    { id: "r5", cells: { name: "-2+3" } },
  ],
  views: [
    { id: "v1", name: "Table", type: "table" },
    {
      id: "v2",
      name: "Open only",
      type: "table",
      visiblePropertyIds: ["name", "status"],
      filters: [{ propertyId: "status", operator: "is", value: "open" }],
    },
  ],
};

const page: Page = {
  id: "p1",
  title: "Week 3",
  icon: "📘",
  blocks: [
    { id: "h", type: "heading", level: 1, text: "Overview" },
    { id: "h2", type: "heading", level: 3, text: "Details" },
    { id: "p", type: "paragraph", text: "Read **chapter 4** and $e^x$." },
    { id: "t1", type: "todo", text: "Finish lab", checked: true },
    { id: "t2", type: "todo", text: "Email TA", checked: false },
    { id: "b1", type: "bulleted_list_item", text: "First\ncontinued" },
    { id: "b2", type: "bulleted_list_item", text: "Second" },
    { id: "n1", type: "numbered_list_item", text: "One" },
    { id: "n2", type: "numbered_list_item", text: "Two" },
    { id: "q", type: "quote", text: "Line a\nLine b" },
    { id: "c", type: "callout", emoji: "💡", text: "Office hours moved" },
    { id: "d", type: "divider" },
    { id: "m", type: "media", assetId: "a1", mediaKind: "image", mime: "image/png", caption: "Free-body diagram", alt: "diagram" },
    { id: "dv", type: "database_view", databaseId: "db", viewId: "v2" },
    { id: "ra", type: "react_artifact", title: "Timer", source: "function App(){return <p>```</p>}" },
    { id: "fc", type: "flashcards", title: "Terms", cards: [{ id: "c1", front: "Mitosis", back: "Cell division" }] },
    {
      id: "qz",
      type: "quiz",
      title: "Check",
      questions: [
        { id: "q1", kind: "mcq", prompt: "2+2?", choices: ["3", "4"], answerIndex: 1, explanation: "Basic sum." },
        { id: "q2", kind: "true_false", prompt: "Water boils at 100°C at sea level.", answerBool: true },
        { id: "q3", kind: "short", prompt: "Define entropy.", answerText: "Disorder" },
      ],
    },
    { id: "n3", type: "numbered_list_item", text: "Restart" },
  ],
};

const ws: Workspace = {
  id: "w",
  name: "Fall: semester/2026",
  icon: "🍂",
  pages: [page, { id: "p2", title: "Week 3", blocks: [] }, { id: "p3", title: "Économie 経済", blocks: [] }],
  databases: [assignments, courses],
};

describe("pageToMarkdown", () => {
  const md = pageToMarkdown(page, ws, { today: "2026-11-12", origin: "https://studyos.test/" });

  it("writes the title and every text block type", () => {
    expect(md.startsWith("# 📘 Week 3\n\n## Overview\n\n#### Details\n\nRead **chapter 4** and $e^x$.")).toBe(true);
    expect(md).toContain("- [x] Finish lab\n- [ ] Email TA");
    expect(md).toContain("- First\n  continued\n- Second");
    expect(md).toContain("1. One\n2. Two");
    expect(md).toContain("> Line a\n> Line b");
    expect(md).toContain("> 💡 Office hours moved");
    expect(md).toContain("\n---\n");
    expect(md).toContain("1. Restart");
  });

  it("links images through the authenticated asset route with the caption", () => {
    expect(md).toContain("![diagram](https://studyos.test/api/asset/a1)\n\n*Free-body diagram*");
  });

  it("embeds a database view as a table that follows the view", () => {
    expect(md).toContain(
      "**📚 Assignments** · Open only\n\n| Name | Status |\n| --- | --- |\n| Problem set, part 1 | Open |\n",
    );
    expect(md).not.toContain("HYPERLINK");
  });

  it("fences component source safely", () => {
    expect(md).toContain("**Timer**\n\n````jsx\nfunction App(){return <p>```</p>}\n````");
  });

  it("writes flashcards and quizzes with answers", () => {
    expect(md).toContain("**Terms**\n\n**Q:** Mitosis\n\n**A:** Cell division");
    expect(md).toContain("1. 2+2?\n   - 3\n   - **4** ✓\n\n   *Explanation:* Basic sum.");
    expect(md).toContain("2. Water boils at 100°C at sea level.\n   **A:** True");
    expect(md).toContain("3. Define entropy.\n   **A:** Disorder");
  });

  it("uses the student's language for labels", () => {
    const de = pageToMarkdown(page, ws, {
      today: "2026-11-12",
      labels: { flashcards: "Karten", question: "F", answer: "A", explanation: "Erklärung", trueLabel: "Wahr", falseLabel: "Falsch", quiz: "Quiz", component: "Komponente" },
    });
    expect(de).toContain("**A:** Wahr");
    expect(de).toContain("*Erklärung:* Basic sum.");
  });

  it("escapes table cells", () => {
    expect(tableCell("a|b\nc")).toBe("a\\|b<br>c");
  });
});

describe("databaseToCsv", () => {
  const csv = databaseToCsv(assignments, ws);
  const lines = csv.slice(CSV_BOM.length).split("\r\n");

  it("starts with a BOM and a header of column names, CRLF line endings", () => {
    expect(csv.startsWith(CSV_BOM)).toBe(true);
    expect(lines[0]).toBe("Name,Status,Tags,Points,Submitted,Due,Course,Link");
    expect(csv.endsWith("\r\n")).toBe(true);
  });

  it("formats values as people read them and quotes where needed", () => {
    expect(lines[1]).toBe('"Problem set, part 1",Open,Exam; Group,-5,TRUE,2026-11-20,Calculus; Physics,https://x.y');
  });

  it("neutralises formulas and doubles quotes", () => {
    expect(lines[2]).toBe(`"'=HYPERLINK(""http://evil"",""click"")",Done,,10,FALSE,,,`);
    expect(lines[3]).toBe("'+1 extra credit,,,,,,,");
  });

  it("keeps multi-line text inside one quoted field", () => {
    expect(csv).toContain(`"'@SUM(A1:A2)\nsecond line",,,,,,,`);
    expect(csv).toContain("'-2+3,,,,,,,");
  });

  it("neutralises every dangerous first character", () => {
    for (const s of ["=1", "+1", "-1", "@a", "\tx", "\rx"]) expect(neutraliseFormula(s)).toBe(`'${s}`);
    expect(neutraliseFormula("a=1")).toBe("a=1");
    expect(csvField(" padded")).toBe('" padded"');
  });
});

describe("workspace zip", () => {
  it("contains an index, one Markdown file per page and one CSV per database", () => {
    const zip = workspaceToZip(ws, { today: "2026-11-12", mtime: new Date("2026-11-12T00:00:00Z") });
    const files = unzipSync(zip);
    const names = Object.keys(files).sort();
    expect(names).toEqual([
      "Fall semester 2026/databases/Assignments.csv",
      "Fall semester 2026/databases/Courses.csv",
      "Fall semester 2026/index.md",
      "Fall semester 2026/pages/01 Week 3.md",
      "Fall semester 2026/pages/02 Week 3.md",
      "Fall semester 2026/pages/03 Économie 経済.md",
    ]);
    expect(strFromU8(files["Fall semester 2026/pages/01 Week 3.md"])).toBe(
      pageToMarkdown(page, ws, { today: "2026-11-12" }),
    );
    // Compare bytes: decoding would swallow the byte-order mark.
    expect(Array.from(files["Fall semester 2026/databases/Assignments.csv"])).toEqual(
      Array.from(strToU8(databaseToCsv(assignments, ws))),
    );
    expect([...files["Fall semester 2026/databases/Assignments.csv"].slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const index = strFromU8(files["Fall semester 2026/index.md"]);
    expect(index).toContain("- [📘 Week 3](pages/01%20Week%203.md)");
    expect(index).toContain("- [🎓 Courses](databases/Courses.csv)");
  });

  it("deduplicates names case-insensitively", () => {
    const files = workspaceFiles({
      id: "x",
      name: "X",
      pages: [],
      databases: [
        { ...courses, id: "a", name: "Notes" },
        { ...courses, id: "b", name: "notes" },
      ],
    });
    expect([...files.keys()]).toContain("X/databases/notes (2).csv");
  });

  it("makes file names safe", () => {
    expect(safeFileName('a/b\\c:d*e?"f<g>h|')).toBe("a b c d e f g h");
    expect(safeFileName("  ..  ")).toBe("Untitled");
    expect(safeFileName("CON")).toBe("Untitled");
    expect(safeFileName("x".repeat(200))).toHaveLength(80);
  });
});
