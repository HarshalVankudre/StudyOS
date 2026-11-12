import { describe, expect, it } from "vitest";
import type { Database, GradesBlock, Workspace } from "@/lib/workspace/types";
import { computeCourseGrade, type GradeCategoryInput, type GradeItemInput } from "./calc";
import {
  assignRow,
  convertCategoryRows,
  findCategoryRows,
  keepCategoryRows,
  matchCategory,
  upsertCategory,
} from "./categories";
import { buildGradeReport, categoryRowsOf, resolveGradeColumns } from "./workspace";

const item = (id: string, extra: Partial<GradeItemInput> = {}): GradeItemInput => ({
  id,
  name: id,
  weight: null,
  score: null,
  maxScore: null,
  ...extra,
});

const PS: GradeCategoryInput = { id: "ps", name: "Problem sets", weight: 20 };
const LAB: GradeCategoryInput = { id: "lab", name: "Lab reports", weight: 15 };

describe("category grades", () => {
  it("a score on one problem set moves the course grade (the QA case)", () => {
    const items = [
      item("ps4", { category: "ps", score: 85 }),
      item("ps5", { category: "ps" }),
      item("ps6", { category: "ps" }),
      item("lab4", { category: "lab" }),
      item("mid2", { weight: 25 }),
      item("final", { weight: 40 }),
    ];
    const grade = computeCourseGrade(items, { categories: [PS, LAB] });
    expect(grade.current).toBeCloseTo(85);
    // One of three problem sets = a third of 20 % of the grade.
    expect(grade.decidedShare).toBeCloseTo(20 / 3 / 100);
    expect(grade.totalWeight).toBe(100);
    expect(grade.categories?.find((c) => c.id === "ps")).toMatchObject({ percent: 85, scored: 1, count: 3, countAssumed: true });
    expect(grade.remainingCount).toBe(5);
    expect(grade.notes).toEqual([]);
  });

  it("averages a category with equal weights by default", () => {
    const items = [item("a", { category: "ps", score: 80 }), item("b", { category: "ps", score: 90 }), item("c", { category: "ps" })];
    const grade = computeCourseGrade(items, { categories: [{ ...PS, weight: 100 }] });
    expect(grade.categories?.[0].percent).toBeCloseTo(85);
    expect(grade.current).toBeCloseTo(85);
    // Floor: (80 + 90 + 0) / 3; ceiling: (80 + 90 + 100) / 3.
    expect(grade.floor).toBeCloseTo(170 / 3);
    expect(grade.ceiling).toBeCloseTo(90);
  });

  it("weights by points when items carry an 'out of'", () => {
    const items = [
      item("a", { category: "ps", score: 10, maxScore: 10 }), // 100 %
      item("b", { category: "ps", score: 15, maxScore: 30 }), // 50 %
    ];
    const grade = computeCourseGrade(items, { categories: [{ ...PS, weight: 100 }] });
    // (10 + 15) / (10 + 30) = 62.5 %, not the plain mean of 75 %.
    expect(grade.categories?.[0].percent).toBeCloseTo(62.5);
  });

  it("drops the lowest N, once there are more scores than drops", () => {
    const cat = { ...PS, weight: 100, dropLowest: 1 };
    const one = computeCourseGrade([item("a", { category: "ps", score: 40 }), item("b", { category: "ps" })], {
      categories: [cat],
    });
    expect(one.categories?.[0].percent).toBe(40);
    expect(one.categories?.[0].dropped).toEqual([]);

    const items = [
      item("a", { category: "ps", score: 40 }),
      item("b", { category: "ps", score: 90 }),
      item("c", { category: "ps", score: 80 }),
    ];
    const grade = computeCourseGrade(items, { categories: [cat] });
    expect(grade.categories?.[0].percent).toBeCloseTo(85);
    expect(grade.categories?.[0].dropped).toEqual(["a"]);
    expect(grade.items.find((i) => i.id === "a")?.dropped).toBe(true);
    expect(grade.final).toBeCloseTo(85);
  });

  it("mixes single items and categories, and answers what is needed", () => {
    const items = [
      item("hw1", { category: "hw", score: 90 }),
      item("hw2", { category: "hw", score: 70 }),
      item("mid", { weight: 30, score: 60 }),
      item("final", { weight: 40 }),
    ];
    const categories = [{ id: "hw", name: "Homework", weight: 30, expectedCount: 4 }];
    const grade = computeCourseGrade(items, { categories, target: 80 });
    // Now: homework 80 (2 of 4), midterm 60 -> (30*80 + 30*60) / 60 = 70.
    expect(grade.current).toBeCloseTo(70);
    expect(grade.decidedShare).toBeCloseTo((15 + 30) / 100);
    expect(grade.remainingCount).toBe(3);
    // x on the 2 homeworks still to come and the final:
    // 30*(160+2x)/4 + 30*60 + 40x = 8000 -> 1200 + 15x + 1800 + 40x = 8000 -> x = 90.9
    expect(grade.outlook).toMatchObject({ kind: "needed" });
    expect((grade.outlook as { average: number }).average).toBeCloseTo(5000 / 55, 3);
  });

  it("counts items a category will still get, and says the count is an assumption until set", () => {
    const listed = [item("ps1", { category: "ps", score: 100 }), item("final", { weight: 80 })];
    const assumed = computeCourseGrade(listed, { categories: [PS], target: 90 });
    expect(assumed.categories?.[0]).toMatchObject({ count: 1, countAssumed: true, listed: 1 });
    // The only problem set is done: the final carries everything else.
    // 20*100 + 80x = 9000 -> x = 87.5
    expect((assumed.outlook as { average: number }).average).toBeCloseTo(87.5);

    const ten = computeCourseGrade(listed, { categories: [{ ...PS, expectedCount: 10 }], target: 90 });
    expect(ten.categories?.[0]).toMatchObject({ count: 10, countAssumed: false, scored: 1 });
    expect(ten.decidedShare).toBeCloseTo(0.02);
    // 20*(100 + 9x)/10 + 80x = 9000 -> 200 + 18x + 80x = 9000 -> x = 89.8
    expect((ten.outlook as { average: number }).average).toBeCloseTo(8800 / 98, 3);
  });

  it("an empty category counts as one item still to come", () => {
    const grade = computeCourseGrade([item("final", { weight: 85, score: 80 })], { categories: [LAB] });
    expect(grade.categories?.[0]).toMatchObject({ listed: 0, count: 1, percent: null });
    expect(grade.current).toBeCloseTo(80);
    expect(grade.final).toBeNull();
    expect(grade.decidedShare).toBeCloseTo(0.85);
  });

  it("leaves uncategorised items out, visibly", () => {
    const grade = computeCourseGrade(
      [item("ps1", { category: "ps", score: 80 }), item("quiz", { score: 20 }), item("x", { excluded: true, score: 0 })],
      { categories: [{ ...PS, weight: 100 }] },
    );
    expect(grade.current).toBe(80);
    expect(grade.uncategorized).toEqual(["quiz"]);
    expect(grade.items.find((i) => i.id === "quiz")).toMatchObject({ uncategorized: true, counted: false });
    expect(grade.items.find((i) => i.id === "x")).toMatchObject({ counted: false });
    expect(grade.items.find((i) => i.id === "x")?.uncategorized).toBeUndefined();
    expect(grade.notes).toContainEqual({ code: "uncategorized", count: 1 });
  });

  it("what-if fill covers items still to come", () => {
    const grade = computeCourseGrade([item("ps1", { category: "ps", score: 60 })], {
      categories: [{ ...PS, weight: 100, expectedCount: 4 }],
      fill: 100,
    });
    expect(grade.current).toBeCloseTo(90);
    expect(grade.final).toBeCloseTo(90);
  });

  it("an unreachable target says what it would take", () => {
    const grade = computeCourseGrade(
      [item("ps1", { category: "ps", score: 0 }), item("ps2", { category: "ps" })],
      { categories: [{ ...PS, weight: 100 }], target: 90 },
    );
    expect(grade.outlook).toMatchObject({ kind: "unreachable", best: 50 });
    expect((grade.outlook as { average: number }).average).toBeCloseTo(180, 3);
  });
});

describe("matchCategory", () => {
  const cats = [
    { id: "ps", name: "Problem sets" },
    { id: "hw", name: "Weekly homework" },
    { id: "quiz", name: "Quizzes" },
  ];
  it("finds the category a title names, even next to a similar one", () => {
    expect(matchCategory("Problem Set 4", [], cats)).toBe("ps");
    expect(matchCategory("PS 5", ["Problem set"], cats)).toBe("ps");
    expect(matchCategory("Homework 9 (eigenvalues)", [], cats)).toBe("hw");
    expect(matchCategory("Quiz 5", [], cats)).toBe("quiz");
    expect(matchCategory("Eigenvalues worksheet", ["Homework"], cats)).toBe("hw");
  });
  it("says nothing when unclear or contradicting", () => {
    expect(matchCategory("Midterm 2", [], cats)).toBeNull();
    expect(matchCategory("Reading", [], cats)).toBeNull();
    expect(matchCategory("Assignment 3", [], [{ id: "a", name: "Problem sets" }, { id: "b", name: "Homework" }])).toBeNull();
  });
  it("works across languages and kinds", () => {
    expect(matchCategory("Übungsblatt 3", [], [{ id: "u", name: "Übungsblätter" }, { id: "k", name: "Klausur" }])).toBe("u");
    expect(matchCategory("Tarea 2", [], [{ id: "t", name: "Tareas" }, { id: "p", name: "Prácticas de laboratorio" }])).toBe("t");
    expect(matchCategory("Midterm 1", [], [{ id: "e", name: "Exams" }, { id: "h", name: "Homework" }])).toBe("e");
    expect(matchCategory("Final exam", [], [{ id: "m", name: "Midterms" }])).toBeNull();
    expect(matchCategory("小テスト3", [], [{ id: "q", name: "小テスト" }, { id: "r", name: "レポート" }])).toBe("q");
  });
});

// ---------------------------------------------------------------------------

function graded(): Database {
  return {
    id: "db-a",
    name: "Graded Work",
    properties: [
      { id: "a-name", name: "Assignment", type: "text" },
      { id: "a-course", name: "Course", type: "select", options: [{ id: "co-chem", label: "CHEM 210" }] },
      {
        id: "a-type",
        name: "Type",
        type: "select",
        options: [
          { id: "ty-ps", label: "Problem set" },
          { id: "ty-lab", label: "Lab report" },
          { id: "ty-exam", label: "Exam" },
          { id: "ty-group", label: "Grade group" },
        ],
      },
      { id: "a-status", name: "Status", type: "status", options: [{ id: "st-todo", label: "Not started" }, { id: "st-done", label: "Done" }] },
      { id: "a-due", name: "Due", type: "date" },
      { id: "a-weight", name: "Weight %", type: "number" },
      { id: "a-score", name: "Score", type: "number" },
    ],
    rows: [
      { id: "g-ps", cells: { "a-name": "Problem sets", "a-course": "co-chem", "a-type": "ty-group", "a-weight": 20 } },
      { id: "g-lab", cells: { "a-name": "Lab reports", "a-course": "co-chem", "a-type": "ty-group", "a-weight": 15 } },
      { id: "mid", cells: { "a-name": "Midterm 2", "a-course": "co-chem", "a-type": "ty-exam", "a-weight": 25, "a-due": "2026-12-03" } },
      { id: "fin", cells: { "a-name": "Final exam", "a-course": "co-chem", "a-type": "ty-exam", "a-weight": 40 } },
      { id: "ps4", cells: { "a-name": "Problem Set 4", "a-course": "co-chem", "a-type": "ty-ps", "a-due": "2026-11-03", "a-score": 85 } },
      { id: "ps5", cells: { "a-name": "Problem Set 5", "a-course": "co-chem", "a-type": "ty-ps", "a-due": "2026-11-17" } },
      { id: "lab4", cells: { "a-name": "Lab Report 4 (Recrystallization)", "a-course": "co-chem", "a-type": "ty-lab", "a-due": "2026-11-20" } },
      { id: "feed", cells: { "a-name": "Problem Set 6", "a-course": "co-chem", "a-due": "2026-12-01" } },
    ],
    views: [{ id: "v", name: "All", type: "table" }],
  };
}

function ws(db: Database): Workspace {
  return { id: "w", name: "W", pages: [], databases: [db] };
}

const BLOCK: Omit<GradesBlock, "id" | "type"> = {
  databaseId: "db-a",
  columns: { course: "a-course", score: "a-score", weight: "a-weight", due: "a-due" },
};

describe("category rows and the grading scheme", () => {
  it("finds old-style category rows, but not undated single items", () => {
    const db = graded();
    const rows = categoryRowsOf(ws(db), db, resolveGradeColumns(db, BLOCK.columns));
    expect(rows.map((r) => r.rowId)).toEqual(["g-ps", "g-lab"]);
    expect(rows[0]).toEqual({ rowId: "g-ps", name: "Problem sets", course: "co-chem", weight: 20, score: null });
  });

  it("finds a category row by its numbered items too", () => {
    const db = graded();
    db.rows[0].cells["a-type"] = null;
    db.rows[0].cells["a-name"] = "Problem set";
    const cols = resolveGradeColumns(db, BLOCK.columns);
    expect(findCategoryRows(db, cols, () => "co-chem").map((r) => r.rowId)).toContain("g-ps");
  });

  it("converting moves the weights into the scheme, and scores on real work count", () => {
    const db = graded();
    const before = buildGradeReport(ws(db), BLOCK)!;
    // Before: the category rows hold the weight, PS4's 85 counts for nothing.
    expect(before.courses[0].grade.decidedShare).toBe(0);

    convertCategoryRows(db, categoryRowsOf(ws(db), db, resolveGradeColumns(db, BLOCK.columns)));
    expect(db.rows.map((r) => r.id)).not.toContain("g-ps");
    expect(db.grading?.categories.map((c) => [c.name, c.weight, c.course])).toEqual([
      ["Problem sets", 20, "co-chem"],
      ["Lab reports", 15, "co-chem"],
    ]);
    const after = buildGradeReport(ws(db), BLOCK)!;
    const chem = after.courses[0];
    expect(chem.grade.current).toBeCloseTo(85);
    expect(chem.grade.decidedShare).toBeGreaterThan(0);
    // The calendar row without a type lands in Problem sets by its title.
    const ps = chem.grade.categories!.find((c) => c.name === "Problem sets")!;
    expect(chem.grade.items.find((i) => i.id === "feed")?.category).toBe(ps.id);
    expect(ps.listed).toBe(3);
    expect(after.categoryRows).toEqual([]);
  });

  it("keeps declined rows as rows and stops offering them", () => {
    const db = graded();
    keepCategoryRows(db, ["g-ps", "g-lab"]);
    expect(categoryRowsOf(ws(db), db, resolveGradeColumns(db, BLOCK.columns))).toEqual([]);
    const report = buildGradeReport(ws(db), BLOCK)!;
    // Still works the old way: the rows are single weighted items.
    expect(report.courses[0].grade.totalWeight).toBe(100);
  });

  it("a hand placement beats the automatic match", () => {
    const db = graded();
    convertCategoryRows(db, categoryRowsOf(ws(db), db, resolveGradeColumns(db, BLOCK.columns)));
    const lab = db.grading!.categories.find((c) => c.name === "Lab reports")!;
    assignRow(db, "feed", lab.id);
    assignRow(db, "ps5", "");
    const chem = buildGradeReport(ws(db), BLOCK)!.courses[0];
    expect(chem.grade.items.find((i) => i.id === "feed")?.category).toBe(lab.id);
    expect(chem.grade.items.find((i) => i.id === "ps5")).toMatchObject({ counted: false });
  });

  it("upserts by course and name", () => {
    const db = graded();
    const a = upsertCategory(db, { course: "co-chem", name: "Homework", weight: 30 });
    const b = upsertCategory(db, { course: "co-chem", name: "homework", weight: 25, dropLowest: 1 });
    expect(a).toBe(b);
    expect(db.grading?.categories).toEqual([{ id: a, course: "co-chem", name: "Homework", weight: 25, dropLowest: 1 }]);
  });
});

describe("after generation", () => {
  it("turns the model's category rows into categories and keeps only real work as rows", async () => {
    const { ensureGradeTracking } = await import("./ensure");
    const db = graded();
    // The model also copied the category's weight onto one problem set.
    db.rows.find((r) => r.id === "ps5")!.cells["a-weight"] = 20;
    const out = ensureGradeTracking(ws(db), { score: "Score", heading: "Grades", title: "Grades" });
    const after = out.databases[0];
    expect(after.rows.map((r) => r.id)).toEqual(["mid", "fin", "ps4", "ps5", "lab4", "feed"]);
    expect(after.grading?.categories.map((c) => c.name)).toEqual(["Problem sets", "Lab reports"]);
    expect(after.rows.find((r) => r.id === "ps5")?.cells["a-weight"]).toBeNull();
    expect(after.rows.find((r) => r.id === "mid")?.cells["a-weight"]).toBe(25);
  });
});

describe("stored grading schemes", () => {
  it("validate, and a damaged category is dropped on its own by repair", async () => {
    const { safeParseWorkspace } = await import("@/lib/workspace/schema");
    const { repairWorkspace } = await import("@/lib/workspace/repair");
    const db = graded();
    db.grading = { categories: [{ id: "c1", course: "co-chem", name: "Problem sets", weight: 20, dropLowest: 1 }], assign: { ps4: "c1" } };
    expect(safeParseWorkspace(ws(db)).success).toBe(true);
    const damaged = structuredClone(ws(db)) as unknown as { databases: { grading: { categories: unknown[] } }[] };
    damaged.databases[0].grading.categories.push({ id: "c2", name: 7, weight: "lots" });
    const repaired = repairWorkspace(damaged);
    expect(repaired?.workspace.databases[0].grading).toEqual(db.grading);
    expect(repaired?.workspace.databases[0].rows).toHaveLength(db.rows.length);
  });
});

describe("single items written as categories", () => {
  it("moves the weight back onto the row instead of counting it twice (live sample)", async () => {
    const { ensureGradeTracking } = await import("./ensure");
    const db = graded();
    db.rows = [
      { id: "hw1", cells: { "a-name": "Stats homework, week 1", "a-course": "co-chem" } },
      { id: "mid", cells: { "a-name": "Statistics midterm", "a-course": "co-chem", "a-weight": 30 } },
      { id: "fin", cells: { "a-name": "Statistics final", "a-course": "co-chem" } },
    ];
    db.grading = {
      categories: [
        { id: "hw", course: "co-chem", name: "Weekly homework", weight: 30, dropLowest: 0 },
        { id: "m", course: "co-chem", name: "Midterm", weight: 30 },
        { id: "f", course: "co-chem", name: "Final", weight: 40 },
      ],
    };
    const out = ensureGradeTracking(ws(db), { score: "Score", heading: "Grades", title: "Grades" }).databases[0];
    expect(out.grading?.categories).toEqual([{ id: "hw", course: "co-chem", name: "Weekly homework", weight: 30 }]);
    expect(out.rows.map((r) => r.cells["a-weight"])).toEqual([undefined, 30, 40]);
    const grade = buildGradeReport(ws(out), BLOCK)!.courses[0].grade;
    expect(grade.totalWeight).toBe(100);
  });
});
