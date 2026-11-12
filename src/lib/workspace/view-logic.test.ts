import { describe, expect, it } from "vitest";
import type { Database, DatabaseRow, ViewFilter } from "./types";
import { databaseViewSchema } from "./schema";
import {
  addDays,
  applyView,
  completionField,
  dayDiff,
  dayKeyOf,
  dueInfo,
  filterRows,
  isDayKey,
  isFilterActive,
  isRowComplete,
  monthGrid,
  newRowCells,
  numberColumnSums,
  relativeUnit,
  resolveDayValue,
  safeHttpUrl,
  searchRows,
  sortRows,
  summarizeNumbers,
  upcomingViewSettings,
} from "./view-logic";

const TODAY = "2026-11-12";

function db(rows: DatabaseRow[]): Database {
  return {
    id: "db",
    name: "Assignments",
    properties: [
      { id: "name", name: "Assignment", type: "text" },
      {
        id: "course",
        name: "Course",
        type: "select",
        options: [
          { id: "cs", label: "CS 101", color: "blue" },
          { id: "math", label: "MATH 201", color: "violet" },
        ],
      },
      {
        id: "status",
        name: "Status",
        type: "status",
        options: [
          { id: "todo", label: "Not started", color: "zinc" },
          { id: "doing", label: "In progress", color: "amber" },
          { id: "done", label: "Done", color: "green" },
        ],
      },
      { id: "due", name: "Due", type: "date" },
      { id: "weight", name: "Weight %", type: "number" },
      { id: "tags", name: "Tags", type: "multi_select", options: [
        { id: "t1", label: "Group" }, { id: "t2", label: "Écrit" },
      ] },
      { id: "flag", name: "Important", type: "checkbox" },
      { id: "link", name: "Link", type: "url" },
    ],
    rows,
    views: [],
  };
}

const r = (id: string, cells: DatabaseRow["cells"]): DatabaseRow => ({ id, cells });

const SAMPLE = db([
  r("a", { name: "Essay draft", course: "math", status: "todo", due: "2026-11-10", weight: 20, tags: ["t2"] }),
  r("b", { name: "Problem set 4", course: "cs", status: "done", due: "2026-11-11", weight: 10 }),
  r("c", { name: "Lab report", course: "cs", status: "doing", due: TODAY, weight: 15, flag: true }),
  r("d", { name: "Quiz 3", course: "math", status: "todo", due: "2026-11-19", tags: ["t1", "t2"] }),
  r("e", { name: "Reading 7", status: "todo", due: "2026-11-20" }),
  r("f", { name: "Project idea", course: "cs", status: null, due: null, weight: 5 }),
]);

const ids = (rows: DatabaseRow[]) => rows.map((x) => x.id);
const only = (f: ViewFilter) => ids(filterRows(SAMPLE, SAMPLE.rows, [f], "all", { today: TODAY }));

describe("calendar days", () => {
  it("validates real days only", () => {
    expect(isDayKey("2026-02-28")).toBe(true);
    expect(isDayKey("2028-02-29")).toBe(true);
    expect(isDayKey("2026-02-29")).toBe(false);
    expect(isDayKey("2026-13-01")).toBe(false);
    expect(isDayKey("2026-1-01")).toBe(false);
    expect(isDayKey(20261112)).toBe(false);
  });

  it("counts days across month, year, leap day and DST boundaries", () => {
    expect(dayDiff("2026-11-12", "2026-11-13")).toBe(1);
    expect(dayDiff("2026-12-31", "2027-01-01")).toBe(1);
    expect(dayDiff("2028-02-28", "2028-03-01")).toBe(2);
    // Europe and the US change clocks on these weekends; day math must not drift.
    expect(dayDiff("2026-03-28", "2026-03-30")).toBe(2);
    expect(dayDiff("2026-10-31", "2026-11-02")).toBe(2);
    expect(addDays("2026-03-07", 2)).toBe("2026-03-09");
    expect(addDays("2026-01-01", -1)).toBe("2025-12-31");
    expect(dayDiff("2026-11-12", "2026-11-05")).toBe(-7);
  });

  it("takes the calendar day in the requested time zone", () => {
    const instant = new Date("2026-11-12T23:30:00Z");
    expect(dayKeyOf(instant, "UTC")).toBe("2026-11-12");
    expect(dayKeyOf(instant, "America/Los_Angeles")).toBe("2026-11-12");
    expect(dayKeyOf(instant, "Asia/Tokyo")).toBe("2026-11-13");
    const early = new Date("2026-11-12T03:00:00Z");
    expect(dayKeyOf(early, "America/New_York")).toBe("2026-11-11");
    expect(dayKeyOf(early, "Europe/Berlin")).toBe("2026-11-12");
  });

  it("uses local getters when no time zone is given", () => {
    const local = new Date(2026, 10, 12, 0, 5); // 00:05 local time
    expect(dayKeyOf(local)).toBe("2026-11-12");
    const late = new Date(2026, 10, 12, 23, 59);
    expect(dayKeyOf(late)).toBe("2026-11-12");
  });

  it("resolves relative filter values", () => {
    expect(resolveDayValue("today", TODAY)).toBe(TODAY);
    expect(resolveDayValue("Tomorrow", TODAY)).toBe("2026-11-13");
    expect(resolveDayValue("yesterday", TODAY)).toBe("2026-11-11");
    expect(resolveDayValue("2026-12-01T10:00:00Z", TODAY)).toBe("2026-12-01");
    expect(resolveDayValue("next friday", TODAY)).toBeNull();
  });

  it("builds a month grid with the requested first weekday", () => {
    // 1 Nov 2026 is a Sunday.
    const sunday = monthGrid(2026, 10, 0);
    expect(sunday[0]).toBe("2026-11-01");
    expect(sunday.length % 7).toBe(0);
    const monday = monthGrid(2026, 10, 1);
    expect(monday.slice(0, 7)).toEqual([null, null, null, null, null, null, "2026-11-01"]);
    expect(monday.filter(Boolean)).toHaveLength(30);
    expect(monthGrid(2028, 1).filter(Boolean)).toHaveLength(29);
  });

  it("picks a readable relative unit", () => {
    expect(relativeUnit(3)).toEqual({ value: 3, unit: "day" });
    expect(relativeUnit(-13)).toEqual({ value: -13, unit: "day" });
    expect(relativeUnit(21)).toEqual({ value: 3, unit: "week" });
    expect(relativeUnit(-90)).toEqual({ value: -3, unit: "month" });
  });
});

describe("deadlines", () => {
  it("classifies dates around today", () => {
    expect(dueInfo("2026-11-11", TODAY)).toEqual({ days: -1, tone: "overdue" });
    expect(dueInfo(TODAY, TODAY)).toEqual({ days: 0, tone: "today" });
    expect(dueInfo("2026-11-13", TODAY)?.tone).toBe("soon");
    expect(dueInfo("2026-11-15", TODAY)?.tone).toBe("soon");
    expect(dueInfo("2026-11-16", TODAY)?.tone).toBe("week");
    expect(dueInfo("2026-11-19", TODAY)?.tone).toBe("week");
    expect(dueInfo("2026-11-20", TODAY)?.tone).toBe("later");
    expect(dueInfo(null, TODAY)).toBeNull();
    expect(dueInfo("soon", TODAY)).toBeNull();
  });

  it("never marks completed work as overdue", () => {
    expect(dueInfo("2026-11-01", TODAY, true)?.tone).toBe("past");
    expect(dueInfo("2026-11-20", TODAY, true)?.tone).toBe("done");
  });
});

describe("completion", () => {
  it("finds the done option of a status field", () => {
    const field = completionField(SAMPLE);
    expect(field?.property.id).toBe("status");
    expect(field?.doneValue).toBe("done");
    expect(field?.openValue).toBe("todo");
    expect(isRowComplete(SAMPLE, SAMPLE.rows[1])).toBe(true);
    expect(isRowComplete(SAMPLE, SAMPLE.rows[0])).toBe(false);
  });

  it("recognises a last green status option and localized labels", () => {
    const green: Database = {
      ...SAMPLE,
      properties: [
        { id: "s", name: "Stand", type: "status", options: [
          { id: "1", label: "Offen" }, { id: "2", label: "Abgegeben ✔", color: "green" },
        ] },
      ],
    };
    expect(completionField(green)?.doneValue).toBe("2");
    const german: Database = {
      ...SAMPLE,
      properties: [{ id: "s", name: "Stand", type: "select", options: [{ id: "x", label: "Erledigt" }] }],
    };
    expect(completionField(german)?.doneValue).toBe("x");
  });

  it("falls back to a done-like checkbox and ignores unrelated ones", () => {
    const reading: Database = {
      ...SAMPLE,
      properties: [
        { id: "t", name: "Title", type: "text" },
        { id: "imp", name: "Important", type: "checkbox" },
        { id: "read", name: "Read", type: "checkbox" },
      ],
    };
    expect(completionField(reading)?.property.id).toBe("read");
    const none: Database = { ...SAMPLE, properties: [{ id: "imp", name: "Important", type: "checkbox" }] };
    expect(completionField(none)).toBeNull();
  });
});

describe("filters", () => {
  it("text contains is case- and accent-insensitive", () => {
    expect(only({ propertyId: "name", operator: "contains", value: "REPORT" })).toEqual(["c"]);
    expect(only({ propertyId: "name", operator: "not_contains", value: "e" })).toEqual(["d"]);
    const accents = db([r("x", { name: "Résumé" })]);
    expect(filterRows(accents, accents.rows, [{ propertyId: "name", operator: "contains", value: "resume" }], "all", { today: TODAY })).toHaveLength(1);
    expect(only({ propertyId: "name", operator: "is", value: "quiz 3" })).toEqual(["d"]);
  });

  it("select is / is not, with any-of arrays", () => {
    expect(only({ propertyId: "course", operator: "is", value: "cs" })).toEqual(["b", "c", "f"]);
    expect(only({ propertyId: "course", operator: "is_not", value: "cs" })).toEqual(["a", "d", "e"]);
    expect(only({ propertyId: "status", operator: "is", value: ["todo", "doing"] })).toEqual(["a", "c", "d", "e"]);
    expect(only({ propertyId: "status", operator: "is_empty" })).toEqual(["f"]);
  });

  it("multi-select contains any of", () => {
    expect(only({ propertyId: "tags", operator: "contains", value: "t2" })).toEqual(["a", "d"]);
    expect(only({ propertyId: "tags", operator: "not_contains", value: ["t1"] })).toEqual(["a", "b", "c", "e", "f"]);
    // "is" is read as "contains" for multi-select.
    expect(only({ propertyId: "tags", operator: "is", value: "t1" })).toEqual(["d"]);
  });

  it("number comparisons", () => {
    expect(only({ propertyId: "weight", operator: "gt", value: 10 })).toEqual(["a", "c"]);
    expect(only({ propertyId: "weight", operator: "gte", value: 10 })).toEqual(["a", "b", "c"]);
    expect(only({ propertyId: "weight", operator: "lt", value: 10 })).toEqual(["f"]);
    expect(only({ propertyId: "weight", operator: "lte", value: "10" })).toEqual(["b", "f"]);
    expect(only({ propertyId: "weight", operator: "eq", value: 15 })).toEqual(["c"]);
    expect(only({ propertyId: "weight", operator: "neq", value: 15 })).toEqual(["a", "b", "d", "e", "f"]);
    expect(only({ propertyId: "weight", operator: "is_empty" })).toEqual(["d", "e"]);
  });

  it("checkbox is", () => {
    expect(only({ propertyId: "flag", operator: "is", value: true })).toEqual(["c"]);
    expect(only({ propertyId: "flag", operator: "is", value: false })).toEqual(["a", "b", "d", "e", "f"]);
  });

  it("date before / after / on, including relative words", () => {
    expect(only({ propertyId: "due", operator: "before", value: "today" })).toEqual(["a", "b"]);
    expect(only({ propertyId: "due", operator: "on_or_before", value: TODAY })).toEqual(["a", "b", "c"]);
    expect(only({ propertyId: "due", operator: "after", value: "2026-11-19" })).toEqual(["e"]);
    expect(only({ propertyId: "due", operator: "on_or_after", value: "tomorrow" })).toEqual(["d", "e"]);
    expect(only({ propertyId: "due", operator: "is", value: "today" })).toEqual(["c"]);
    expect(only({ propertyId: "due", operator: "is_empty" })).toEqual(["f"]);
  });

  it("within the next N days includes today and the Nth day, not the past", () => {
    expect(only({ propertyId: "due", operator: "next_days", value: 7 })).toEqual(["c", "d"]);
    expect(only({ propertyId: "due", operator: "next_days", value: 8 })).toEqual(["c", "d", "e"]);
    expect(only({ propertyId: "due", operator: "next_days", value: 0 })).toEqual(["c"]);
    expect(only({ propertyId: "due", operator: "past_days", value: 1 })).toEqual(["b", "c"]);
  });

  it("overdue means before today and not complete", () => {
    expect(only({ propertyId: "due", operator: "overdue" })).toEqual(["a"]);
  });

  it("treats today as the caller's local day at month and year edges", () => {
    const edge = db([r("x", { due: "2026-12-31" }), r("y", { due: "2027-01-01" })]);
    const f: ViewFilter[] = [{ propertyId: "due", operator: "next_days", value: 1 }];
    expect(ids(filterRows(edge, edge.rows, f, "all", { today: "2026-12-31" }))).toEqual(["x", "y"]);
    expect(ids(filterRows(edge, edge.rows, f, "all", { today: "2027-01-01" }))).toEqual(["y"]);
    const overdue: ViewFilter[] = [{ propertyId: "due", operator: "overdue" }];
    expect(ids(filterRows(edge, edge.rows, overdue, "all", { today: "2027-01-01" }))).toEqual(["x"]);
  });

  it("ignores incomplete, mistyped and stale filters instead of hiding everything", () => {
    expect(isFilterActive(SAMPLE, { propertyId: "course", operator: "is", value: null })).toBe(false);
    expect(isFilterActive(SAMPLE, { propertyId: "name", operator: "contains", value: "  " })).toBe(false);
    expect(isFilterActive(SAMPLE, { propertyId: "gone", operator: "is_empty" })).toBe(false);
    expect(isFilterActive(SAMPLE, { propertyId: "weight", operator: "before", value: "today" })).toBe(false);
    expect(isFilterActive(SAMPLE, { propertyId: "due", operator: "next_days", value: -1 })).toBe(false);
    expect(only({ propertyId: "course", operator: "is", value: [] })).toHaveLength(6);
  });

  it("combines with all (default) or any", () => {
    const filters: ViewFilter[] = [
      { propertyId: "course", operator: "is", value: "math" },
      { propertyId: "weight", operator: "gte", value: 15 },
    ];
    expect(ids(filterRows(SAMPLE, SAMPLE.rows, filters, undefined, { today: TODAY }))).toEqual(["a"]);
    expect(ids(filterRows(SAMPLE, SAMPLE.rows, filters, "any", { today: TODAY }))).toEqual(["a", "c", "d"]);
  });
});

describe("search", () => {
  it("matches every word across text, option labels and numbers", () => {
    expect(ids(searchRows(SAMPLE, SAMPLE.rows, "cs lab"))).toEqual(["c"]);
    expect(ids(searchRows(SAMPLE, SAMPLE.rows, "math"))).toEqual(["a", "d"]);
    expect(ids(searchRows(SAMPLE, SAMPLE.rows, "ecrit"))).toEqual(["a", "d"]);
    expect(ids(searchRows(SAMPLE, SAMPLE.rows, "  "))).toHaveLength(6);
  });

  it("can search related row labels", () => {
    const rel: Database = {
      ...SAMPLE,
      properties: [{ id: "course", name: "Course", type: "relation", relationDatabaseId: "c" }],
      rows: [r("x", { course: ["c1"] }), r("y", { course: [] })],
    };
    const labels = (_p: unknown, id: string) => (id === "c1" ? "Organic Chemistry" : undefined);
    expect(ids(searchRows(rel, rel.rows, "chem", labels))).toEqual(["x"]);
  });
});

describe("sorting", () => {
  it("sorts dates ascending with empty values last, and descending still puts empties last", () => {
    expect(ids(sortRows(SAMPLE, SAMPLE.rows, [{ propertyId: "due", direction: "asc" }]))).toEqual(["a", "b", "c", "d", "e", "f"]);
    expect(ids(sortRows(SAMPLE, SAMPLE.rows, [{ propertyId: "due", direction: "desc" }]))).toEqual(["e", "d", "c", "b", "a", "f"]);
  });

  it("sorts selects by option order and supports multiple keys", () => {
    const sorted = sortRows(SAMPLE, SAMPLE.rows, [
      { propertyId: "course", direction: "asc" },
      { propertyId: "weight", direction: "desc" },
    ]);
    expect(ids(sorted)).toEqual(["c", "b", "f", "a", "d", "e"]);
    expect(ids(sortRows(SAMPLE, SAMPLE.rows, [{ propertyId: "status", direction: "desc" }]))).toEqual(["b", "c", "a", "d", "e", "f"]);
  });

  it("sorts text naturally and is stable for ties", () => {
    const names = db([r("1", { name: "Week 10" }), r("2", { name: "week 2" }), r("3", { name: "Week 2" }), r("4", {})]);
    expect(ids(sortRows(names, names.rows, [{ propertyId: "name", direction: "asc" }]))).toEqual(["2", "3", "1", "4"]);
  });

  it("ignores sorts on deleted properties and leaves the stored order alone", () => {
    expect(sortRows(SAMPLE, SAMPLE.rows, [{ propertyId: "gone", direction: "asc" }])).toBe(SAMPLE.rows);
    expect(sortRows(SAMPLE, SAMPLE.rows, undefined)).toBe(SAMPLE.rows);
  });

  it("checkbox sorts unchecked first", () => {
    expect(ids(sortRows(SAMPLE, SAMPLE.rows, [{ propertyId: "flag", direction: "desc" }]))[0]).toBe("c");
  });
});

describe("saved views", () => {
  it("builds a 'This week' view: next 7 days, not done, soonest first", () => {
    const settings = upcomingViewSettings(SAMPLE)!;
    expect(settings.filters).toEqual([
      { propertyId: "due", operator: "next_days", value: 7 },
      { propertyId: "status", operator: "is_not", value: ["done"] },
    ]);
    const done = db([...SAMPLE.rows, r("g", { name: "Already done", status: "done", due: "2026-11-13" })]);
    expect(ids(applyView(done, settings, { today: TODAY }))).toEqual(["c", "d"]);
    // The settings survive the workspace schema (they are saved with the view).
    const parsed = databaseViewSchema.safeParse({ id: "v", name: "This week", type: "list", ...settings });
    expect(parsed.success).toBe(true);
  });

  it("pre-fills new rows so they satisfy simple filters", () => {
    const cells = newRowCells(
      SAMPLE,
      {
        filters: [
          { propertyId: "course", operator: "is", value: "cs" },
          { propertyId: "due", operator: "next_days", value: 7 },
          { propertyId: "status", operator: "is_not", value: ["done"] },
          { propertyId: "flag", operator: "is", value: true },
          { propertyId: "tags", operator: "contains", value: ["t1", "t2"] },
        ],
      },
      TODAY,
    );
    // The status starts at the first open option ("Not started").
    expect(cells).toEqual({ course: "cs", due: TODAY, flag: true, tags: ["t1"], status: "todo" });
    const row = r("new", cells);
    expect(filterRows(SAMPLE, [row], [
      { propertyId: "course", operator: "is", value: "cs" },
      { propertyId: "due", operator: "next_days", value: 7 },
      { propertyId: "status", operator: "is_not", value: ["done"] },
    ], "all", { today: TODAY })).toHaveLength(1);
    expect(newRowCells(SAMPLE, { filterMatch: "any", filters: [{ propertyId: "course", operator: "is", value: "cs" }] }, TODAY)).toEqual({ status: "todo" });
  });

  it("starts a new row in the first open status unless a filter picks one", () => {
    expect(newRowCells(SAMPLE, {}, TODAY)).toEqual({ status: "todo" });
    expect(
      newRowCells(SAMPLE, { filters: [{ propertyId: "status", operator: "is", value: "doing" }] }, TODAY),
    ).toEqual({ status: "doing" });
    // A status whose first options are all "done"-like still starts open.
    const odd: Database = {
      ...SAMPLE,
      properties: [{ id: "s", name: "State", type: "status", options: [
        { id: "x", label: "Done", color: "green" }, { id: "y", label: "Waiting", color: "zinc" },
      ] }],
    };
    expect(newRowCells(odd, {}, TODAY)).toEqual({ s: "y" });
  });

  it("only sums number columns whose total means something", () => {
    expect(numberColumnSums({ name: "Credits" })).toBe(true);
    expect(numberColumnSums({ name: "Minutes" })).toBe(true);
    expect(numberColumnSums({ name: "Weight %" })).toBe(true);
    expect(numberColumnSums({ name: "Gewichtung %" })).toBe(true);
    expect(numberColumnSums({ name: "Target %" })).toBe(false);
    expect(numberColumnSums({ name: "Score" })).toBe(false);
    expect(numberColumnSums({ name: "Progress" })).toBe(false);
    expect(numberColumnSums({ name: "Zielnote" })).toBe(false);
  });

  it("returns null without a date field", () => {
    expect(upcomingViewSettings({ ...SAMPLE, properties: [SAMPLE.properties[0]] })).toBeNull();
  });

  it("old views without the new fields still parse and show every row", () => {
    expect(databaseViewSchema.safeParse({ id: "v", name: "All", type: "table" }).success).toBe(true);
    expect(applyView(SAMPLE, {}, { today: TODAY })).toBe(SAMPLE.rows);
  });

  it("rejects an unknown operator", () => {
    const bad = { id: "v", name: "x", type: "table", filters: [{ propertyId: "a", operator: "sounds_like" }] };
    expect(databaseViewSchema.safeParse(bad).success).toBe(false);
  });

  it("filters, searches and sorts 5,000 rows quickly", () => {
    const rows = Array.from({ length: 5000 }, (_, i) =>
      r(`r${i}`, {
        name: `Task ${i}`,
        course: i % 2 ? "cs" : "math",
        status: ["todo", "doing", "done"][i % 3],
        due: addDays(TODAY, (i % 40) - 10),
        weight: i % 17,
      }),
    );
    const big = db(rows);
    const start = performance.now();
    const out = applyView(
      big,
      { ...upcomingViewSettings(big)!, sorts: [{ propertyId: "course", direction: "asc" }, { propertyId: "due", direction: "asc" }] },
      { today: TODAY, search: "task" },
    );
    expect(performance.now() - start).toBeLessThan(500);
    expect(out.length).toBeGreaterThan(0);
  });
});

describe("summaries and links", () => {
  it("sums and averages only numeric values", () => {
    expect(summarizeNumbers(SAMPLE.rows, "weight")).toEqual({ count: 4, sum: 50, average: 12.5 });
    expect(summarizeNumbers([], "weight")).toEqual({ count: 0, sum: 0, average: null });
  });

  it("only allows http and https links", () => {
    expect(safeHttpUrl("https://example.com/a?b=1")).toBe("https://example.com/a?b=1");
    expect(safeHttpUrl("http://uni.edu")).toBe("http://uni.edu/");
    expect(safeHttpUrl("example.com/syllabus.pdf")).toBe("https://example.com/syllabus.pdf");
    expect(safeHttpUrl("javascript:alert(1)")).toBeNull();
    expect(safeHttpUrl("JAVASCRIPT:alert(1)")).toBeNull();
    expect(safeHttpUrl("data:text/html,hi")).toBeNull();
    expect(safeHttpUrl("ftp://files.example.com")).toBeNull();
    expect(safeHttpUrl("just some notes")).toBeNull();
    expect(safeHttpUrl("")).toBeNull();
    expect(safeHttpUrl(42)).toBeNull();
  });
});
