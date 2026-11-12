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
