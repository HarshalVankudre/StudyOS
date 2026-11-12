/**
 * QA round 3: a syllabus saying "Two midterms 20% each" produced a 40 %
 * "Midterms" category AND 20 % on each midterm row, so the course added up to
 * 140 % and every weight was shown scaled down (Midterm 1 "14.3 %").
 *
 * The rule: one weight per item, never two. An item's own weight wins; a
 * category's weight covers only its items without one. The structure is also
 * repaired where it is produced (settleDoubleWeights), so new workspaces never
 * carry both.
 */
import { describe, expect, it } from "vitest";
import type { Database, Workspace } from "@/lib/workspace/types";
import { computeCourseGrade, type GradeCategoryInput, type GradeItemInput } from "./calc";
import { settleDoubleWeights } from "./categories";
import { categoriesFromRows } from "./ensure";
import { buildGradeReport, resolveGradeColumns, rowCourseKey } from "./workspace";
import { applySyllabusFacts } from "@/lib/import/syllabus-merge";
import { extractSyllabusFacts } from "@/lib/import/syllabus-facts";

const item = (id: string, extra: Partial<GradeItemInput> = {}): GradeItemInput => ({
  id,
  name: id,
  weight: null,
  score: null,
  maxScore: null,
  ...extra,
});

const MIDTERMS: GradeCategoryInput = { id: "mid", name: "Midterms", weight: 40, expectedCount: 2 };
const PS: GradeCategoryInput = { id: "ps", name: "Problem sets", weight: 20, dropLowest: 1, expectedCount: 10 };
const QUIZ: GradeCategoryInput = { id: "quiz", name: "Weekly quizzes", weight: 15 };

describe("the grade calculation never counts a weight twice", () => {
  it("counts rows with their own weight on that weight, and the category only for the rest", () => {
    const items = [
      item("ps5", { category: "ps", score: 70 }),
      item("q8", { category: "quiz" }),
      item("mid1", { category: "mid", weight: 20, score: 82 }),
      item("mid2", { category: "mid", weight: 20 }),
      item("final", { weight: 25 }),
    ];
    const grade = computeCourseGrade(items, { categories: [PS, QUIZ, MIDTERMS], target: 85 });
    expect(grade.totalWeight).toBe(100);
    expect(grade.notes.some((n) => n.code === "weights_sum")).toBe(false);
    const byId = Object.fromEntries(grade.items.map((i) => [i.id, i]));
    expect(byId.mid1).toMatchObject({ weight: 20, counted: true, category: "mid", ownWeight: true });
    expect(byId.final.weight).toBe(25);
    const mid = grade.categories?.find((c) => c.id === "mid");
    expect(mid).toMatchObject({ weight: 0, configuredWeight: 40, ownWeighted: 2, ownWeightSum: 40, covered: true, scored: 1, count: 2 });
    expect(mid?.combinedPercent).toBeCloseTo(82);
    // Nothing is "still to come" for a category its rows already cover.
    expect(grade.remainingCount).toBe(9 + 1 + 1 + 1); // problem sets, the quiz, midterm 2, the final
  });

  it("lets the category cover the items not listed yet when only some carry their own weight", () => {
    const items = [item("mid1", { category: "mid", weight: 20, score: 90 }), item("final", { weight: 60 })];
    const grade = computeCourseGrade(items, { categories: [MIDTERMS] });
    expect(grade.totalWeight).toBe(100);
    const mid = grade.categories?.[0];
    expect(mid).toMatchObject({ weight: 20, ownWeighted: 1, covered: false, count: 2, listed: 1 });
    // 90 on midterm 1, 0 on the other midterm and the final.
    expect(grade.floor).toBeCloseTo(18);
  });

  it("never lets a category go below zero when its rows carry more than it", () => {
    const items = [item("mid1", { category: "mid", weight: 30 }), item("mid2", { category: "mid", weight: 30 })];
    const grade = computeCourseGrade(items, { categories: [MIDTERMS] });
    expect(grade.totalWeight).toBe(60);
    expect(grade.categories?.[0].weight).toBe(0);
    expect(grade.notes).toContainEqual({ code: "weights_sum", sum: 60 });
  });
});

/** The QA workspace: "Midterms 40%" in the grading scheme and 20 % on each midterm row. */
function qaDatabase(): Database {
  return {
    id: "db-graded",
    name: "Coursework",
    properties: [
      { id: "g-name", name: "Item", type: "text" },
      { id: "g-due", name: "Due", type: "date" },
      { id: "g-course", name: "Course", type: "select", options: [{ id: "co-phys201", label: "PHYS 201" }] },
      {
        id: "g-type",
        name: "Type",
        type: "select",
        options: [
          { id: "ty-ps", label: "Problem Set" },
          { id: "ty-quiz", label: "Quiz" },
          { id: "ty-midterm", label: "Midterm" },
          { id: "ty-final", label: "Final" },
        ],
      },
      { id: "g-weight", name: "Weight %", type: "number" },
      { id: "g-score", name: "Score", type: "number" },
    ],
    rows: [
      { id: "gw-ps5", cells: { "g-name": "Problem Set 5", "g-due": "2026-10-30", "g-course": "co-phys201", "g-type": "ty-ps", "g-weight": null, "g-score": 70 } },
      { id: "gw-q8", cells: { "g-name": "Quiz 8", "g-due": "2026-11-17", "g-course": "co-phys201", "g-type": "ty-quiz", "g-weight": null, "g-score": null } },
      { id: "gw-mid1", cells: { "g-name": "Midterm 1", "g-due": "2026-10-08", "g-course": "co-phys201", "g-type": "ty-midterm", "g-weight": 20, "g-score": 82 } },
      { id: "gw-mid2", cells: { "g-name": "Midterm 2", "g-due": null, "g-course": "co-phys201", "g-type": "ty-midterm", "g-weight": 20, "g-score": null } },
      { id: "gw-final", cells: { "g-name": "Final exam (cumulative)", "g-due": "2026-12-15", "g-course": "co-phys201", "g-type": "ty-final", "g-weight": 25, "g-score": null } },
    ],
    views: [{ id: "t", name: "Table", type: "table" }],
    grading: {
      categories: [
        { id: "cat-ps", course: "co-phys201", name: "Problem sets", weight: 20, dropLowest: 1, expectedCount: 10 },
        { id: "cat-quiz", course: "co-phys201", name: "Weekly quizzes", weight: 15 },
        { id: "cat-midterms", course: "co-phys201", name: "Midterms", weight: 40, expectedCount: 2 },
      ],
    },
  };
}

function ws(db: Database): Workspace {
  return {
    id: "ws",
    name: "PHYS",
    pages: [{ id: "p", title: "Grades", blocks: [{ id: "g", type: "grades", databaseId: db.id }] }],
    databases: [db],
  };
}

describe("an already saved workspace with both weights", () => {
  it("adds up to 100 and shows each weight as given", () => {
    const report = buildGradeReport(ws(qaDatabase()), { databaseId: "db-graded", defaultTarget: 85 })!;
    const course = report.courses[0];
    expect(course.grade.totalWeight).toBe(100);
    expect(course.grade.notes.some((n) => n.code === "weights_sum")).toBe(false);
    const mid1 = course.grade.items.find((i) => i.id === "gw-mid1");
    expect(mid1).toMatchObject({ weight: 20, category: "cat-midterms", ownWeight: true });
    expect(course.grade.items.find((i) => i.id === "gw-final")?.weight).toBe(25);
  });
});

describe("settleDoubleWeights", () => {
  const settle = (db: Database) => {
    const workspace = ws(db);
    const columns = resolveGradeColumns(db, undefined);
    return settleDoubleWeights(db, columns, (row) => rowCourseKey(workspace, db, columns, row));
  };

  it("removes a category its rows already cover in full", () => {
    const db = qaDatabase();
    expect(settle(db)).toBe(1);
    expect(db.grading?.categories.map((c) => c.name)).toEqual(["Problem sets", "Weekly quizzes"]);
    expect(db.rows.find((r) => r.id === "gw-mid1")?.cells["g-weight"]).toBe(20);
  });

  it("clears the per-item copies when the rows carry the 'each' share and some are not listed yet", () => {
    const db = qaDatabase();
    db.rows = db.rows.filter((r) => r.id !== "gw-mid2");
    expect(settle(db)).toBe(1);
    expect(db.rows.find((r) => r.id === "gw-mid1")?.cells["g-weight"]).toBeNull();
    expect(db.grading?.categories.some((c) => c.name === "Midterms")).toBe(true);
    const grade = buildGradeReport(ws(db), { databaseId: "db-graded" })!.courses[0].grade;
    expect(grade.totalWeight).toBe(100);
    expect(grade.items.find((i) => i.id === "gw-mid1")?.weight).toBeCloseTo(20);
  });

  it("leaves weights it cannot place alone (the calculation still counts each once)", () => {
    const db = qaDatabase();
    db.rows.find((r) => r.id === "gw-mid1")!.cells["g-weight"] = 15;
    expect(settle(db)).toBe(0);
    expect(db.grading?.categories).toHaveLength(3);
  });

  it("runs after generation (categoriesFromRows)", () => {
    const db = qaDatabase();
    categoriesFromRows(ws(db), db);
    expect(db.grading?.categories.some((c) => c.name === "Midterms")).toBe(false);
  });
});

describe("from the syllabus to the structure (the QA syllabus)", () => {
  const SYLLABUS = [
    "PHYS 201 - Classical Mechanics - Fall 2026",
    "GRADING",
    "- Problem sets 20% (10 problem sets, lowest score dropped)",
    "- Weekly quizzes 15%",
    "- Two midterms 20% each",
    "- Final exam 25%",
    "SCHEDULE",
    "- Midterm 1: Thursday, October 8, 2026 (in class)",
    "- Final exam (cumulative): Tuesday, December 15, 2026, 13:00-16:00",
  ].join("\n");

  it("the merged workspace counts every weight once, whatever the model wrote", () => {
    const facts = extractSyllabusFacts(SYLLABUS, "2026-11-12", "en");
    expect(facts.assessments.find((a) => a.name === "Midterms")).toMatchObject({ weight: 40, count: 2, each: 20, group: true });
    // The model gave the midterm rows their 20 % (and no category).
    const db = qaDatabase();
    delete db.grading;
    const merged = applySyllabusFacts(ws(db), facts, {
      database: "Assessments",
      description: "",
      name: "Name",
      course: "Course",
      weight: "Weight %",
      due: "Due",
      table: "Table",
      calendar: "Calendar",
    });
    const report = buildGradeReport(merged, { databaseId: "db-graded" })!;
    const grade = report.courses[0].grade;
    expect(grade.totalWeight).toBe(100);
    expect(grade.items.find((i) => i.id === "gw-mid1")?.weight).toBe(20);
    expect(grade.items.find((i) => i.id === "gw-final")?.weight).toBe(25);
  });
});
