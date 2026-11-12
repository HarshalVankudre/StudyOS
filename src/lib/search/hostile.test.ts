// @vitest-environment node
/**
 * Hostile inputs from the second security review (probe: sec2/me/search.probe.ts).
 * Search indexing runs synchronously on the server for every query after an
 * edit, so each case must finish fast however the text is shaped. Measured:
 * before the fix "[a](" x 400k took 195 s, the mixed markdown case 9.6 s and
 * the relation cell 15 s. Bounds below are generous on purpose (slow CI).
 */
import { describe, expect, it } from "vitest";
import { workspaceEvents } from "@/lib/calendar/events";
import { rowCourse as plannerRowCourse } from "@/lib/agents/daily-study/classify";
import { cellText as exportCellText } from "@/lib/export/cells";
import { gradeCourses, detectGradeColumns } from "@/lib/grades/workspace";
import { findRow } from "@/lib/workspace/row-lookup";
import type { Database, Workspace } from "@/lib/workspace/types";
import { buildSearchEntries, searchEntries } from "./index";
import { MAX_SEARCH_TEXT, plainText } from "./text";

const BOUND_MS = 3000;
const N_ROWS = 20_000;

function timed<T>(fn: () => T): { value: T; ms: number } {
  const t0 = performance.now();
  const value = fn();
  return { value, ms: performance.now() - t0 };
}

function paragraphWorkspace(text: string): Workspace {
  return {
    id: "w1",
    name: "W",
    pages: [{ id: "p", title: "P", blocks: [{ id: "b", type: "paragraph", text }] }],
    databases: [],
  };
}

const HOSTILE_TEXTS: Record<string, string> = {
  links: "[a](".repeat(400_000).slice(0, 1_800_000),
  images: "![a](".repeat(360_000).slice(0, 1_800_000),
  mixed: ("*a".repeat(200_000) + "\n" + "[".repeat(100_000) + "](" + "`".repeat(100_000)).slice(0, 1_800_000),
  emphasis: ("**a" + " a".repeat(800_000)).slice(0, 1_800_000),
  underscores: "_a ".repeat(600_000),
  backticks: "`a".repeat(900_000),
  brackets: "[".repeat(900_000) + "](" + ")".repeat(10),
  prefixes: "1".repeat(500_000) + "\n" + "   #".repeat(200_000),
  whitespaceBrackets: "[ ".repeat(900_000),
};

describe("search text on hostile markdown", () => {
  for (const [name, text] of Object.entries(HOSTILE_TEXTS)) {
    it(`indexes "${name}" quickly`, () => {
      const { value: entries, ms } = timed(() => buildSearchEntries(paragraphWorkspace(text)));
      expect(ms).toBeLessThan(BOUND_MS);
      const block = entries.find((e) => e.kind === "block");
      expect(block?.title.length ?? 0).toBeLessThanOrEqual(MAX_SEARCH_TEXT);
      const search = timed(() => searchEntries(entries, "a b c d e f g h i j k l m n o p q r s t u v w x y z ".repeat(7)));
      expect(search.ms).toBeLessThan(BOUND_MS);
    });

    // The patterns themselves are linear: run them on the whole text, unclipped.
    it(`plainText patterns stay linear on "${name}" without the clip`, () => {
      const { ms } = timed(() => plainText(text.slice(0, 1_000_000), Infinity));
      expect(ms).toBeLessThan(BOUND_MS);
    });
  }

  it("keeps the Markdown reductions people rely on", () => {
    expect(plainText("## A [link](https://x.y) with **bold** and `code`")).toBe("A link with bold and code");
    expect(plainText("![diagram of a cell](https://x.y/c.png) caption")).toBe("diagram of a cell caption");
    expect(plainText("> quoted _emphasis_ and ~~struck~~ text")).toBe("quoted emphasis and struck text");
    expect(plainText("3. third item with $x^2$")).toBe("third item with x^2");
  });

  it("reads only a bounded prefix of a long block", () => {
    const text = "word ".repeat(10_000) + "needle";
    const entries = buildSearchEntries(paragraphWorkspace(text));
    expect(searchEntries(entries, "needle").total).toBe(0);
    expect(searchEntries(entries, "word").total).toBeGreaterThan(0);
  });
});

/** A 20,000-row database and one cell listing 130,000 ids (all pointing at the last row). */
function relationWorkspace(count = 130_000): Workspace {
  const N = 20_000;
  const rows = Array.from({ length: N }, (_, i) => ({ id: `r${i}`, cells: { t: `Course ${i}` } }));
  const ids = Array.from({ length: count }, () => `r${N - 1}`);
  const many: Database = {
    id: "B",
    name: "Assignments",
    properties: [
      { id: "t", name: "Title", type: "text" },
      { id: "rel", name: "Course", type: "relation", relationDatabaseId: "A" },
      { id: "due", name: "Due", type: "date" },
      { id: "grade", name: "Grade", type: "number" },
    ],
    // Many rows each pointing at a far row too: rows x target rows was quadratic in the planner and grades.
    rows: [
      { id: "b1", cells: { t: "Essay", rel: ids, due: "2026-12-01", grade: 90 } },
      ...Array.from({ length: N }, (_, i) => ({
        id: `b${i + 2}`,
        cells: { t: `Task ${i}`, rel: [`r${N - 1 - (i % 7)}`], due: "2026-12-02", grade: 80 },
      })),
    ],
    views: [{ id: "v", name: "Table", type: "table" }],
  };
  return {
    id: "w1",
    name: "W",
    pages: [{ id: "p", title: "P", blocks: [{ id: "dv", type: "database_view", databaseId: "B", viewId: "v" }] }],
    databases: [
      { id: "A", name: "Courses", properties: [{ id: "t", name: "Name", type: "text" }], rows, views: [] },
      many,
    ],
  };
}

describe("relation cells", () => {
  it("search resolves a 130,000-id cell over 20,000 rows quickly", () => {
    const ws = relationWorkspace();
    const { value: entries, ms } = timed(() => buildSearchEntries(ws));
    expect(ms).toBeLessThan(BOUND_MS);
    const row = entries.find((e) => e.rowId === "b1");
    expect(row?.body).toContain("Course 19999");
    expect(row!.body.length).toBeLessThanOrEqual(MAX_SEARCH_TEXT);
  });

  it("export, calendar, planner and grades resolve relations by index", () => {
    const ws = relationWorkspace();
    const db = ws.databases[1];
    const rel = db.properties[1];

    const exp = timed(() => db.rows.map((r) => exportCellText(ws, rel, r.cells.rel)));
    expect(exp.ms).toBeLessThan(BOUND_MS);
    expect(exp.value[0].startsWith("Course 19999")).toBe(true);

    const cal = timed(() => workspaceEvents(ws));
    expect(cal.value.length).toBeGreaterThan(N_ROWS);
    expect(cal.value[0].summary).toContain("Course 19999");
    expect(cal.ms).toBeLessThan(BOUND_MS);

    const plan = timed(() => db.rows.map((r) => plannerRowCourse(ws, db, r)));
    expect(plan.ms).toBeLessThan(BOUND_MS);
    expect(plan.value[0]).toBe("Course 19999");

    const grades = timed(() => gradeCourses(ws, db, detectGradeColumns(db)));
    expect(grades.ms).toBeLessThan(BOUND_MS);
  });

  it("findRow never returns a row that was replaced or removed in place", () => {
    const db: Pick<Database, "rows"> = { rows: [{ id: "a", cells: {} }, { id: "b", cells: {} }] };
    expect(findRow(db, "b")?.id).toBe("b");
    const replacement = { id: "c", cells: {} };
    db.rows[1] = replacement;
    expect(findRow(db, "b")).toBeUndefined();
    expect(findRow(db, "c")).toBe(replacement);
    db.rows.splice(0, 1);
    expect(findRow(db, "a")).toBeUndefined();
    expect(findRow(db, "c")).toBe(replacement);
    db.rows.push({ id: "d", cells: {} });
    expect(findRow(db, "d")?.id).toBe("d");
  });
});
