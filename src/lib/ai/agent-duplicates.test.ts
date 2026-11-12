import { describe, expect, it } from "vitest";
import type { Workspace } from "@/lib/workspace/types";
import { safeParseWorkspace } from "@/lib/workspace/schema";
import { buildGradeReport } from "@/lib/grades/workspace";
import { createToolRegistry, type ToolContext } from "./tools/registry";
import { registerWorkspaceTools } from "./tools/workspace-tools";
import { applyAgentOps, agentOpsSchema } from "./agent-ops";
import { findDuplicateRowAdds } from "./agent-duplicates";
import { workspaceOutline } from "./agent-context";

function ws(): Workspace {
  return {
    id: "w",
    name: "W",
    homePageId: "home",
    pages: [{ id: "home", title: "Home", blocks: [] }],
    databases: [
      {
        id: "db-a",
        name: "Graded work",
        properties: [
          { id: "a-name", name: "Assignment", type: "text" },
          { id: "a-course", name: "Course", type: "select", options: [{ id: "co-econ", label: "ECON 101" }, { id: "co-bio", label: "BIO 110" }] },
          { id: "a-due", name: "Due", type: "date" },
          { id: "a-weight", name: "Weight %", type: "number" },
          { id: "a-score", name: "Score", type: "number" },
        ],
        rows: [
          { id: "mid", cells: { "a-name": "Midterm", "a-course": "co-econ" } },
          { id: "hw1", cells: { "a-name": "Homework 1", "a-course": "co-econ", "a-due": "2026-11-02", "a-score": 90 } },
          { id: "g-hw", cells: { "a-name": "Homework", "a-course": "co-econ", "a-weight": 30 } },
        ],
        views: [{ id: "v", name: "All", type: "table" }],
      },
    ],
  };
}

const add = (id: string, cells: Record<string, string | number | null>, distinct?: boolean) =>
  agentOpsSchema.parse([{ op: "add_row", databaseId: "db-a", row: { id, cells }, ...(distinct ? { distinct } : {}) }]);

describe("the agent's duplicate check", () => {
  it("refuses a dated second midterm and names the undated one to update", async () => {
    const reg = createToolRegistry();
    registerWorkspaceTools(reg);
    const ctx: ToolContext = { taskId: "t", workspaceJson: JSON.stringify(ws()) };
    const ops = add("mid-2", { "a-name": "Midterm exam", "a-course": "co-econ", "a-due": "2027-03-05" });
    const out = (await reg.run("apply_ops", { ops }, ctx)) as { ok: boolean; error?: string };
    expect(out.ok).toBe(false);
    expect(out.error).toContain("[mid]");
    expect(out.error).toContain("update_row");
    expect(out.error).toContain("(no date yet)");

    // The agent then updates the existing row: accepted.
    const update = agentOpsSchema.parse([{ op: "update_row", databaseId: "db-a", rowId: "mid", cells: { "a-due": "2027-03-05" } }]);
    expect(((await reg.run("apply_ops", { ops: update }, ctx)) as { ok: boolean }).ok).toBe(true);
  });

  it("lets different items through, and a checked one with distinct: true", () => {
    expect(findDuplicateRowAdds(ws(), add("m2", { "a-name": "Midterm 2", "a-course": "co-econ", "a-due": "2027-04-01" }))).toEqual([]);
    expect(findDuplicateRowAdds(ws(), add("hw2", { "a-name": "Homework 2", "a-course": "co-econ" }))).toEqual([]);
    // Same name in another course is another course's midterm.
    expect(findDuplicateRowAdds(ws(), add("bm", { "a-name": "Midterm", "a-course": "co-bio" }))).toEqual([]);
    expect(findDuplicateRowAdds(ws(), add("m3", { "a-name": "Midterm exam", "a-course": "co-econ" }, true))).toEqual([]);
    expect(findDuplicateRowAdds(ws(), add("m4", { "a-name": "Midterm exam", "a-course": "co-econ" }))).toHaveLength(1);
  });
});

describe("set_grades_block with categories", () => {
  it("handles 'homework is 30% and the two midterms are 20% each' in one apply", () => {
    const ops = agentOpsSchema.parse([
      {
        op: "set_grades_block",
        pageId: "home",
        block: { id: "g", type: "grades", databaseId: "db-a" },
        categories: [{ course: "co-econ", name: "Homework", weight: 30 }],
      },
      { op: "update_row", databaseId: "db-a", rowId: "mid", cells: { "a-name": "Midterm 1", "a-weight": 20 } },
      { op: "add_row", databaseId: "db-a", row: { id: "mid2", cells: { "a-name": "Midterm 2", "a-course": "co-econ", "a-weight": 20 } } },
    ]);
    const next = applyAgentOps(ws(), ops);
    expect(safeParseWorkspace(next).success).toBe(true);
    const db = next.databases[0];
    // The old "Homework 30%" row is a category now, not a row.
    expect(db.rows.map((r) => r.id)).toEqual(["mid", "hw1", "mid2"]);
    expect(db.grading?.categories).toEqual([{ id: "cat-homework", course: "co-econ", name: "Homework", weight: 30 }]);
    const econ = buildGradeReport(next, { databaseId: "db-a" })!.courses.find((c) => c.key === "co-econ")!;
    expect(econ.grade.totalWeight).toBe(70);
    expect(econ.grade.current).toBeCloseTo(90);
    expect(econ.grade.items.find((i) => i.id === "hw1")?.category).toBe("cat-homework");

    // Shown to the agent in the outline on its next turn.
    expect(workspaceOutline(next)).toContain("grading categories: [cat-homework] Homework 30% (course co-econ)");
  });

  it("replaces a course's categories, keeps their ids and other courses' categories", () => {
    const first = applyAgentOps(
      ws(),
      agentOpsSchema.parse([
        {
          op: "set_grades_block",
          pageId: "home",
          block: { id: "g", type: "grades", databaseId: "db-a" },
          categories: [
            { course: "co-econ", name: "Homework", weight: 30 },
            { course: "co-bio", name: "Labs", weight: 40 },
          ],
        },
      ]),
    );
    const second = applyAgentOps(
      first,
      agentOpsSchema.parse([
        {
          op: "set_grades_block",
          pageId: "home",
          block: { id: "g", type: "grades", databaseId: "db-a" },
          categories: [{ course: "co-econ", name: "homework", weight: 25, dropLowest: 1 }],
          assign: { hw1: "cat-homework" },
        },
      ]),
    );
    expect(second.databases[0].grading?.categories).toEqual([
      { id: "cat-labs", course: "co-bio", name: "Labs", weight: 40 },
      { id: "cat-homework", course: "co-econ", name: "homework", weight: 25, dropLowest: 1 },
    ]);
    expect(second.databases[0].grading?.assign).toEqual({ hw1: "cat-homework" });
    expect(() =>
      applyAgentOps(
        first,
        agentOpsSchema.parse([
          { op: "set_grades_block", pageId: "home", block: { id: "g", type: "grades", databaseId: "db-a" }, assign: { hw1: "nope" } },
        ]),
      ),
    ).toThrow(/unknown category/);
  });

  it("a database rewrite that forgets the scheme keeps it", () => {
    const first = applyAgentOps(
      ws(),
      agentOpsSchema.parse([
        {
          op: "set_grades_block",
          pageId: "home",
          block: { id: "g", type: "grades", databaseId: "db-a" },
          categories: [{ course: "co-econ", name: "Homework", weight: 30 }],
        },
      ]),
    );
    const { grading: _dropped, ...rest } = first.databases[0];
    void _dropped;
    const next = applyAgentOps(first, agentOpsSchema.parse([{ op: "replace_database", database: { ...rest, name: "Coursework" } }]));
    expect(next.databases[0]).toMatchObject({ name: "Coursework", grading: { categories: [expect.objectContaining({ name: "Homework" })] } });
  });
});
