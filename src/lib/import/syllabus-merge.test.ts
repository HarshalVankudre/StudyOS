import { describe, expect, it } from "vitest";
import { sampleWorkspace } from "@/lib/workspace/sample";
import { safeParseWorkspace } from "@/lib/workspace/schema";
import type { Workspace } from "@/lib/workspace/types";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { applySyllabusFacts } from "./syllabus-merge";

const labels = getDictionary("en").ai.generate.assessments;

function workspaceWithAssignments(): Workspace {
  return {
    id: "ws",
    name: "Study HQ",
    homePageId: "home",
    pages: [{ id: "home", title: "Home", blocks: [] }],
    databases: [
      {
        id: "db-assignments",
        name: "Assignments",
        properties: [
          { id: "a-name", name: "Assignment", type: "text" },
          {
            id: "a-course",
            name: "Course",
            type: "select",
            options: [
              { id: "co-cs", label: "CS 201" },
              { id: "co-math", label: "MATH 240" },
            ],
          },
          { id: "a-status", name: "Status", type: "status", options: [{ id: "st-todo", label: "To do" }] },
          { id: "a-due", name: "Due", type: "date" },
          { id: "a-weight", name: "Weight %", type: "number" },
        ],
        rows: [
          { id: "r1", cells: { "a-name": "Midterm Exam", "a-course": "co-cs", "a-due": null, "a-weight": null } },
          { id: "r2", cells: { "a-name": "Final", "a-course": "co-cs", "a-due": "2026-12-15", "a-weight": 50 } },
        ],
        views: [{ id: "v1", name: "All", type: "table" }],
      },
    ],
  };
}

describe("applySyllabusFacts", () => {
  it("fills missing weights and dates without overwriting what the model wrote", () => {
    const merged = applySyllabusFacts(
      workspaceWithAssignments(),
      {
        assessments: [
          { course: "CS 201 Data Structures", name: "Midterm", weight: 25, date: "2027-01-21" },
          { course: "CS 201 Data Structures", name: "Final exam", weight: 35, date: "2027-03-18" },
        ],
      },
      labels,
    );
    const rows = merged.databases[0].rows;
    expect(rows.find((row) => row.id === "r1")?.cells).toMatchObject({
      "a-due": "2027-01-21",
      "a-weight": 25,
    });
    // The model's own values stay.
    expect(rows.find((row) => row.id === "r2")?.cells).toMatchObject({
      "a-due": "2026-12-15",
      "a-weight": 50,
    });
    expect(rows).toHaveLength(2);
  });

  it("adds assessments the model dropped, mapped onto the course option", () => {
    const merged = applySyllabusFacts(
      workspaceWithAssignments(),
      { assessments: [{ course: "MATH 240 Linear Algebra", name: "Quizzes", weight: 20 }] },
      labels,
    );
    const added = merged.databases[0].rows.at(-1)!;
    expect(added.cells).toEqual({
      "a-name": "Quizzes",
      "a-weight": 20,
      "a-course": "co-math",
      "a-status": "st-todo",
    });
    expect(safeParseWorkspace(merged).success).toBe(true);
  });

  it("does not match a same-named item from another course", () => {
    const merged = applySyllabusFacts(
      workspaceWithAssignments(),
      { assessments: [{ course: "MATH 240", name: "Final", weight: 60 }] },
      labels,
    );
    const finals = merged.databases[0].rows.filter((row) => row.cells["a-name"] === "Final");
    expect(finals).toHaveLength(2);
    expect(finals[1].cells).toMatchObject({ "a-course": "co-math", "a-weight": 60 });
  });

  it("creates a graded-work database on the home page when none exists", () => {
    const bare: Workspace = {
      id: "ws",
      name: "Notes",
      homePageId: "home",
      pages: [{ id: "home", title: "Home", blocks: [] }],
      databases: [],
    };
    const merged = applySyllabusFacts(
      bare,
      { assessments: [{ name: "Final", weight: 40, date: "2027-03-18" }] },
      labels,
    );
    expect(merged.databases).toHaveLength(1);
    expect(merged.databases[0].rows[0].cells).toMatchObject({
      "sa-name": "Final",
      "sa-weight": 40,
      "sa-due": "2027-03-18",
    });
    expect(merged.pages[0].blocks.some((block) => block.type === "database_view")).toBe(true);
    expect(safeParseWorkspace(merged).success).toBe(true);
  });

  it("works on the sample workspace and leaves it valid", () => {
    const merged = applySyllabusFacts(
      sampleWorkspace,
      { assessments: [{ name: "Capstone presentation", weight: 15, date: "2027-04-30" }] },
      labels,
    );
    expect(safeParseWorkspace(merged).success).toBe(true);
    expect(JSON.stringify(merged)).toContain("Capstone presentation");
    // Input is not mutated.
    expect(JSON.stringify(sampleWorkspace)).not.toContain("Capstone presentation");
  });

  it("returns the workspace untouched when there are no facts", () => {
    const ws = workspaceWithAssignments();
    expect(applySyllabusFacts(ws, { assessments: [] }, labels)).toBe(ws);
  });
});

/** One course, a status with a green "Done", and whatever rows a case needs. */
function econWorkspace(rows: Array<{ title: string; due?: string | null; weight?: number | null; status?: string }>): Workspace {
  return {
    id: "ws",
    name: "Study HQ",
    homePageId: "home",
    pages: [{ id: "home", title: "Home", blocks: [] }],
    databases: [
      {
        id: "db-assignments",
        name: "Assignments",
        properties: [
          { id: "a-name", name: "Assignment", type: "text" },
          { id: "a-course", name: "Course", type: "select", options: [{ id: "co-econ", label: "ECON 201" }] },
          {
            id: "a-status",
            name: "Status",
            type: "status",
            options: [
              { id: "st-todo", label: "Not started", color: "zinc" },
              { id: "st-doing", label: "In progress", color: "amber" },
              { id: "st-done", label: "Done", color: "green" },
            ],
          },
          { id: "a-due", name: "Due", type: "date" },
          { id: "a-weight", name: "Weight %", type: "number" },
        ],
        rows: rows.map((row, index) => ({
          id: `r${index + 1}`,
          cells: {
            "a-name": row.title,
            "a-course": "co-econ",
            "a-status": row.status ?? "st-todo",
            "a-due": row.due ?? null,
            "a-weight": row.weight ?? null,
          },
        })),
        views: [{ id: "v1", name: "All", type: "table" }],
      },
    ],
  };
}

describe("applySyllabusFacts never duplicates what the model already has", () => {
  const COURSE = "ECON 201 Intermediate Microeconomics";
  type Case = {
    name: string;
    rows: Parameters<typeof econWorkspace>[0];
    fact: { name: string; weight?: number; date?: string; done?: boolean };
    /** "enrich": rows unchanged in number, `row` gets the values; "add": one new row; "skip": nothing changes. */
    outcome: "enrich" | "add" | "skip";
    row?: number;
  };
  const cases: Case[] = [
    {
      name: "the QA case: the model's own title with a note",
      rows: [{ title: "Problem Set 4 (graded)", due: "2026-11-03", status: "st-done" }],
      fact: { name: "Problem Set 4", date: "2026-11-03", done: true },
      outcome: "enrich",
      row: 0,
    },
    {
      name: "the QA case with the old broken extracted title",
      rows: [{ title: "Problem Set 4 (graded)", due: "2026-11-03", status: "st-done" }],
      fact: { name: "Problem Set 4: due Tuesday, (already graded)", date: "2026-11-03" },
      outcome: "enrich",
      row: 0,
    },
    {
      name: "an abbreviation with a topic",
      rows: [{ title: "PS 4 – Elasticity" }, { title: "PS 5 – Welfare" }],
      fact: { name: "Problem Set 4", weight: 5, date: "2026-11-03" },
      outcome: "enrich",
      row: 0,
    },
    {
      name: "renamed into the student's language, same day",
      rows: [{ title: "Examen parcial", due: "2026-10-15" }],
      fact: { name: "Midterm exam", weight: 25, date: "2026-10-15" },
      outcome: "enrich",
      row: 0,
    },
    {
      name: "a category weight is not put on one numbered item",
      rows: [{ title: "Problem Set 4" }, { title: "Problem Set 5" }],
      fact: { name: "Problem sets", weight: 20 },
      outcome: "skip",
    },
    {
      name: "a plural category next to one numbered quiz",
      rows: [{ title: "Quiz 7", due: "2026-11-20" }],
      fact: { name: "Weekly quizzes", weight: 15 },
      outcome: "skip",
    },
    {
      name: "two rows that both fit equally well",
      rows: [{ title: "Midterm" }, { title: "Midterm exam" }],
      fact: { name: "Midterm", weight: 25 },
      outcome: "skip",
    },
    {
      name: "the same name far apart in time",
      rows: [{ title: "Quiz", due: "2026-12-20" }],
      fact: { name: "Quiz", date: "2026-11-01" },
      outcome: "skip",
    },
    {
      name: "a different number is a different item",
      rows: [{ title: "Midterm 1", due: "2026-10-08" }],
      fact: { name: "Midterm 2", weight: 15, date: "2026-11-19" },
      outcome: "add",
    },
    {
      name: "an exam is not the final project",
      rows: [{ title: "Final project" }],
      fact: { name: "Final exam", weight: 35, date: "2026-12-16" },
      outcome: "add",
    },
    {
      name: "nothing like it at all",
      rows: [{ title: "Problem Set 4" }],
      fact: { name: "Participation", weight: 10 },
      outcome: "add",
    },
  ];

  it.each(cases)("$name", ({ rows, fact, outcome, row }) => {
    const before = econWorkspace(rows);
    const merged = applySyllabusFacts(before, { assessments: [{ course: COURSE, ...fact }] }, labels);
    const db = merged.databases[0];
    if (outcome === "skip") {
      expect(merged.databases[0]).toEqual(before.databases[0]);
      return;
    }
    if (outcome === "enrich") {
      expect(db.rows).toHaveLength(rows.length);
      const cells = db.rows[row!].cells;
      if (fact.weight !== undefined && rows[row!].weight == null) expect(cells["a-weight"]).toBe(fact.weight);
      if (fact.date && rows[row!].due == null) expect(cells["a-due"]).toBe(fact.date);
      // The model's title and status stay.
      expect(cells["a-name"]).toBe(rows[row!].title);
      expect(cells["a-status"]).toBe(rows[row!].status ?? "st-todo");
      return;
    }
    expect(db.rows).toHaveLength(rows.length + 1);
    expect(db.rows.at(-1)!.cells).toMatchObject({
      "a-name": fact.name,
      "a-course": "co-econ",
      "a-status": "st-todo",
      ...(fact.weight !== undefined ? { "a-weight": fact.weight } : {}),
      ...(fact.date ? { "a-due": fact.date } : {}),
    });
  });

  it("an item the syllabus says is already graded is added as done", () => {
    const merged = applySyllabusFacts(
      econWorkspace([{ title: "Problem Set 5" }]),
      { assessments: [{ course: COURSE, name: "Problem Set 4", date: "2026-11-03", done: true }] },
      labels,
    );
    expect(merged.databases[0].rows.at(-1)!.cells).toMatchObject({
      "a-name": "Problem Set 4",
      "a-status": "st-done",
    });
  });

  it("a live model's titles (brackets, renames, category rows) get no duplicates", () => {
    // Row titles exactly as claude-haiku-5-5 wrote them for the ECON 201 syllabus.
    const model = econWorkspace([
      { title: "Problem Set 4", due: "2026-11-03", status: "st-done" },
      { title: "Problem Set 5", due: "2026-11-17" },
      { title: "Problem Set 6", due: "2026-12-01" },
      { title: "Problem sets (overall)", weight: 20, status: "st-doing" },
      { title: "Midterm exam", due: "2026-10-15", weight: 25 },
      { title: "Final exam", due: "2026-12-16", weight: 35 },
      { title: "Participation", weight: 10, status: "st-doing" },
      { title: "Group project proposal", due: "2026-11-24" },
      { title: "Group project (final report)", due: "2026-12-08", weight: 10 },
    ]);
    const merged = applySyllabusFacts(
      model,
      {
        assessments: [
          { course: COURSE, name: "Problem sets", weight: 20 },
          { course: COURSE, name: "Midterm exam", weight: 25, date: "2026-10-15" },
          { course: COURSE, name: "Final exam", weight: 35, date: "2026-12-16" },
          { course: COURSE, name: "Participation", weight: 10 },
          { course: COURSE, name: "Group project", weight: 10 },
          { course: COURSE, name: "Problem Set 4", date: "2026-11-03", note: "already graded", done: true },
          { course: COURSE, name: "Problem Set 5", date: "2026-11-17" },
          { course: COURSE, name: "Group project proposal", date: "2026-11-24" },
          { course: COURSE, name: "final report", date: "2026-12-08" },
          { course: COURSE, name: "Problem Set 6", date: "2026-12-01" },
        ],
      },
      labels,
    );
    expect(merged.databases[0].rows).toHaveLength(9);
  });

  it("merges a whole extracted syllabus into a model workspace without a single duplicate", () => {
    const model = econWorkspace([
      { title: "Problem sets (category, 20%)", weight: 20, status: "st-doing" },
      { title: "Problem Set 4 (graded)", due: "2026-11-03", status: "st-done" },
      { title: "Problem Set 5", due: "2026-11-17" },
      { title: "Midterm", due: "2026-10-15", status: "st-done" },
      { title: "Final Exam — ECON 201", due: "2026-12-16" },
    ]);
    const merged = applySyllabusFacts(
      model,
      {
        assessments: [
          { course: COURSE, name: "Problem sets", weight: 20 },
          { course: COURSE, name: "Midterm exam", weight: 25, date: "2026-10-15" },
          { course: COURSE, name: "Final exam", weight: 35, date: "2026-12-16" },
          { course: COURSE, name: "Problem Set 4", date: "2026-11-03", done: true },
          { course: COURSE, name: "Problem Set 5", date: "2026-11-17" },
          { course: COURSE, name: "Participation", weight: 10 },
        ],
      },
      labels,
    );
    const titles = merged.databases[0].rows.map((r) => r.cells["a-name"]);
    expect(titles).toEqual([
      "Problem sets (category, 20%)",
      "Problem Set 4 (graded)",
      "Problem Set 5",
      "Midterm",
      "Final Exam — ECON 201",
      "Participation",
    ]);
    const weights = merged.databases[0].rows.map((r) => r.cells["a-weight"]);
    expect(weights).toEqual([20, null, null, 25, 35, 10]);
  });
});

describe("applySyllabusFacts (unchanged workspace)", () => {
  it("returns the workspace untouched when there are no facts", () => {
    const ws = workspaceWithAssignments();
    expect(applySyllabusFacts(ws, { assessments: [] }, labels)).toBe(ws);
  });
});

describe("applySyllabusFacts: grading categories", () => {
  it("turns a weight many items share into a category of the right course, never a row", () => {
    const ws = workspaceWithAssignments();
    // The model made a row for the category, and copied its weight onto an item.
    ws.databases[0].rows.push(
      { id: "g-ps", cells: { "a-name": "Problem sets", "a-course": "co-cs", "a-weight": 20 } },
      { id: "ps4", cells: { "a-name": "Problem Set 4", "a-course": "co-cs", "a-due": "2026-11-03", "a-weight": 20 } },
      { id: "q1", cells: { "a-name": "Quiz 1", "a-course": "co-math", "a-due": "2026-11-10" } },
    );
    const merged = applySyllabusFacts(
      ws,
      {
        assessments: [
          { course: "CS 201 Data Structures", name: "Problem sets", weight: 20, group: true, count: 10, dropLowest: 1 },
          { course: "CS 201 Data Structures", name: "Midterm", weight: 25 },
          // No course header: the quizzes are all in MATH 240.
          { name: "Quizzes", weight: 10, group: true },
        ],
      },
      labels,
    );
    const db = merged.databases[0];
    expect(db.rows.map((r) => r.id)).toEqual(["r1", "r2", "ps4", "q1"]);
    expect(db.grading?.categories).toEqual([
      expect.objectContaining({ course: "co-cs", name: "Problem sets", weight: 20, dropLowest: 1, expectedCount: 10 }),
      expect.objectContaining({ course: "co-math", name: "Quizzes", weight: 10 }),
    ]);
    // The single item's weight is its own; the copied category weight is gone.
    expect(db.rows.find((r) => r.id === "r1")?.cells["a-weight"]).toBe(25);
    expect(db.rows.find((r) => r.id === "ps4")?.cells["a-weight"]).toBeNull();
    expect(safeParseWorkspace(merged).success).toBe(true);
  });

  it("puts categories on a new list's courses when there was no list", () => {
    const ws: Workspace = { id: "w", name: "W", pages: [{ id: "home", title: "Home", blocks: [] }], databases: [], homePageId: "home" };
    const merged = applySyllabusFacts(
      ws,
      { assessments: [{ course: "BIO 110", name: "Lab reports", weight: 30, group: true }, { course: "BIO 110", name: "Final exam", weight: 70 }] },
      labels,
    );
    const db = merged.databases[0];
    expect(db.rows.map((r) => r.cells["sa-name"])).toEqual(["Final exam"]);
    expect(db.grading?.categories).toEqual([expect.objectContaining({ course: "text:bio110", name: "Lab reports", weight: 30 })]);
    expect(safeParseWorkspace(merged).success).toBe(true);
  });
});
