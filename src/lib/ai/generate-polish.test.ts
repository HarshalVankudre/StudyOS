import { describe, expect, it } from "vitest";
import { sampleWorkspace } from "@/lib/workspace/sample";
import { safeParseWorkspace } from "@/lib/workspace/schema";
import type { Workspace } from "@/lib/workspace/types";
import {
  inputEvidence,
  naturalDatesInText,
  polishGeneratedWorkspace,
  removeUnsupportedFacts,
} from "./generate-polish";

const OPTIONS = { locale: "en", today: "2026-11-12", labels: { thisWeek: "This week", gradesTitle: "Grades" } };

function polish(ws: Workspace, options = OPTIONS) {
  const out = polishGeneratedWorkspace(ws, options);
  expect(safeParseWorkspace(out).success).toBe(true);
  return out;
}

describe("natural dates in prose", () => {
  it("writes ISO dates the way the student's language does", () => {
    expect(naturalDatesInText("Midterm on 2026-12-03, final 2027-01-18.", "en", "2026-11-12")).toBe(
      "Midterm on December 3, final January 18, 2027.",
    );
    expect(naturalDatesInText("Klausur am 2026-12-03", "de", "2026-11-12")).toBe("Klausur am 3. Dezember");
    expect(naturalDatesInText("Examen el 2026-12-03", "es", "2026-11-12")).toBe("Examen el 3 de diciembre");
    expect(naturalDatesInText("期末 2026-12-03", "ja", "2026-11-12")).toBe("期末 12月3日");
  });

  it("leaves things that only look like dates alone", () => {
    expect(naturalDatesInText("see /files/2026-12-03-notes.pdf", "en", "2026-11-12")).toBe(
      "see /files/2026-12-03-notes.pdf",
    );
    expect(naturalDatesInText("Version 2026-12-03b", "en", "2026-11-12")).toBe("Version 2026-12-03b");
  });

  it("fixes callouts, cards and quiz text but never date cells", () => {
    const ws = structuredClone(sampleWorkspace);
    ws.pages[0].blocks.unshift({ id: "c", type: "callout", text: "Midterm is 2026-12-03." });
    const out = polish(ws);
    expect(out.pages[0].blocks[0]).toMatchObject({ text: "Midterm is December 3." });
    const due = out.databases.find((d) => d.id === "db-assignments")!.rows[0].cells["a-due"];
    expect(due).toBe("2026-06-22");
  });
});

describe("title headings", () => {
  it("drops a first heading that repeats the page title, emoji and case aside", () => {
    const out = polish(sampleWorkspace);
    const assignments = out.pages.find((p) => p.id === "page-assignments")!;
    expect(assignments.blocks[0].type).toBe("paragraph");
    const ws = structuredClone(sampleWorkspace);
    ws.pages[1].blocks[0] = { id: "pa-h", type: "heading", level: 1, text: "📝 assignments" };
    expect(polish(ws).pages[1].blocks[0].type).toBe("paragraph");
  });

  it("keeps a first heading that says something else", () => {
    const ws = structuredClone(sampleWorkspace);
    ws.pages[1].blocks[0] = { id: "pa-h", type: "heading", level: 2, text: "Due before the midterm" };
    expect(polish(ws).pages[1].blocks[0]).toMatchObject({ type: "heading", text: "Due before the midterm" });
  });
});

describe("statuses", () => {
  it("gives rows without a status the open option, and maps a label written as a value", () => {
    const ws = structuredClone(sampleWorkspace);
    const db = ws.databases.find((d) => d.id === "db-assignments")!;
    delete db.rows[0].cells["a-status"];
    db.rows[1].cells["a-status"] = null;
    db.rows[2].cells["a-status"] = "Done";
    const rows = polish(ws).databases.find((d) => d.id === "db-assignments")!.rows;
    expect(rows[0].cells["a-status"]).toBe("st-todo");
    expect(rows[1].cells["a-status"]).toBe("st-todo");
    expect(rows[2].cells["a-status"]).toBe("st-done");
    // Rows that had a status keep it.
    expect(rows[4].cells["a-status"]).toBe("st-done");
  });
});

describe("This week on the dashboard", () => {
  it("adds a 'due in the next 7 days, not done' list right under the welcome callout", () => {
    const out = polish(sampleWorkspace);
    const db = out.databases.find((d) => d.id === "db-assignments")!;
    const view = db.views.find((v) => v.name === "This week")!;
    expect(view).toMatchObject({
      type: "list",
      filters: [
        { propertyId: "a-due", operator: "next_days", value: 7 },
        { propertyId: "a-status", operator: "is_not", value: ["st-done"] },
      ],
      sorts: [{ propertyId: "a-due", direction: "asc" }],
    });
    const home = out.pages.find((p) => p.id === out.homePageId)!;
    expect(home.blocks[0].type).toBe("callout");
    expect(home.blocks[1]).toMatchObject({ type: "heading", text: "📅 This week" });
    expect(home.blocks[2]).toMatchObject({ type: "database_view", databaseId: "db-assignments", viewId: view.id });
  });

  it("is added once, and reuses a 'next days' view the model already made", () => {
    const once = polish(sampleWorkspace);
    const twice = polish(once);
    expect(twice).toEqual(once);
    const ws = structuredClone(sampleWorkspace);
    ws.databases[1].views.push({
      id: "v-soon",
      name: "Soon",
      type: "table",
      filters: [{ propertyId: "a-due", operator: "next_days", value: 5 }],
    });
    const out = polish(ws);
    expect(out.databases[1].views.filter((v) => v.filters?.some((f) => f.operator === "next_days"))).toHaveLength(1);
    expect(out.pages[0].blocks.some((b) => b.type === "database_view" && b.viewId === "v-soon")).toBe(true);
  });
});

describe("competing grade tables", () => {
  function withGradeTracker(): Workspace {
    const ws = structuredClone(sampleWorkspace);
    ws.databases.push({
      id: "db-grades",
      name: "Grade Tracker",
      properties: [
        { id: "g-course", name: "Course", type: "text" },
        { id: "g-current", name: "Current %", type: "number" },
        { id: "g-target", name: "Target %", type: "number" },
      ],
      rows: [
        { id: "g1", cells: { "g-course": "CS 101", "g-current": null, "g-target": 90 } },
        { id: "g2", cells: { "g-course": "MATH 201", "g-current": null, "g-target": 85 } },
      ],
      views: [{ id: "v-grades", name: "Grades", type: "table" }],
    });
    ws.pages.push({
      id: "page-grades",
      title: "Grade Tracker",
      icon: "💯",
      blocks: [
        { id: "pg-p", type: "paragraph", text: "Your targets." },
        { id: "pg-t", type: "database_view", databaseId: "db-grades", viewId: "v-grades" },
      ],
    });
    // The dashboard's calculator is the only grades block.
    return ws;
  }

  it("removes a grade table without deadlines and puts the calculator where it was shown", () => {
    const out = polish(withGradeTracker());
    expect(out.databases.some((d) => d.id === "db-grades")).toBe(false);
    const page = out.pages.find((p) => p.id === "page-grades")!;
    expect(page.blocks.map((b) => b.type)).toEqual(["paragraph", "grades"]);
    expect(page.blocks[1]).toMatchObject({ type: "grades", databaseId: "db-assignments", title: "Grades" });
    expect(JSON.stringify(out)).not.toContain("db-grades");
  });

  it("keeps a table that holds dated work (that is graded work, not a tracker)", () => {
    const ws = withGradeTracker();
    const grades = ws.databases.find((d) => d.id === "db-grades")!;
    grades.properties.push({ id: "g-date", name: "Date", type: "date" });
    grades.rows[0].cells["g-date"] = "2026-12-01";
    expect(polish(ws).databases.some((d) => d.id === "db-grades")).toBe(true);
  });
});

describe("icons", () => {
  it("gives pages without an icon one", () => {
    const ws = structuredClone(sampleWorkspace);
    delete ws.pages[0].icon;
    delete ws.pages[1].icon;
    const out = polish(ws);
    expect(out.pages[0].icon).toBe("🏠");
    expect(out.pages[1].icon).toBe("📄");
  });
});

describe("facts the student never gave", () => {
  function invented(): Workspace {
    const ws = structuredClone(sampleWorkspace);
    ws.databases.push({
      id: "db-plan",
      name: "Study plan",
      properties: [
        { id: "p-name", name: "Session", type: "text" },
        { id: "p-day", name: "Day", type: "date" },
      ],
      rows: [{ id: "p1", cells: { "p-name": "Review recursion", "p-day": "2026-11-14" } }],
      views: [{ id: "v-plan", name: "All", type: "table" }],
    });
    return ws;
  }

  it("reads what the input gives", () => {
    expect(inputEvidence("Klausuren sind im Februar", 0)).toMatchObject({ hasDates: false, hasWeights: false });
    expect(inputEvidence("midterm next Friday", 0).hasDates).toBe(true);
    expect(inputEvidence("期末は来週", 0).hasDates).toBe(true);
    expect(inputEvidence("Final 40 %", 0).hasWeights).toBe(true);
    expect(inputEvidence("anything", 2).hasDates).toBe(true);
  });

  it("clears invented deadlines, weights and course codes, but not a study plan's days", () => {
    const out = removeUnsupportedFacts(invented(), inputEvidence("1st-year CS student taking 5 courses", 0));
    const assignments = out.databases.find((d) => d.id === "db-assignments")!;
    expect(assignments.rows.every((r) => r.cells["a-due"] === null)).toBe(true);
    expect(assignments.rows.every((r) => r.cells["a-weight"] === null)).toBe(true);
    // Everything else on the rows stays.
    expect(assignments.rows[0].cells["a-name"]).toBe("Problem Set 3");
    expect(out.databases.find((d) => d.id === "db-courses")!.rows[0].cells["c-code"]).toBeNull();
    expect(out.databases.find((d) => d.id === "db-plan")!.rows[0].cells["p-day"]).toBe("2026-11-14");
    expect(safeParseWorkspace(out).success).toBe(true);
  });

  it("keeps what the student did give", () => {
    const text = "CS 101 midterm on 2026-07-01, worth 30%";
    const out = removeUnsupportedFacts(invented(), inputEvidence(text, 1));
    const assignments = out.databases.find((d) => d.id === "db-assignments")!;
    expect(assignments.rows[0].cells["a-due"]).toBe("2026-06-22");
    expect(assignments.rows[0].cells["a-weight"]).toBe(10);
    const codes = out.databases.find((d) => d.id === "db-courses")!.rows.map((r) => r.cells["c-code"]);
    expect(codes[0]).toBe("CS 101");
    expect(codes[1]).toBeNull();
  });
});

it("does not change its input", () => {
  const before = JSON.stringify(sampleWorkspace);
  polish(sampleWorkspace);
  expect(JSON.stringify(sampleWorkspace)).toBe(before);
});
