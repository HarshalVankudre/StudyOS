import { describe, expect, it } from "vitest";
import { findGradeDatabase } from "@/lib/grades/workspace";
import { sampleWorkspace } from "@/lib/workspace/sample";
import { safeParseWorkspace } from "@/lib/workspace/schema";
import type { Workspace } from "@/lib/workspace/types";
import { applyView } from "@/lib/workspace/view-logic";
import deKlausuren from "./__fixtures__/gen-samples/de-informatik-klausuren.json";
import enTwoThisWeek from "./__fixtures__/gen-samples/en-econ-two-this-week.json";
import frPartiels from "./__fixtures__/gen-samples/fr-droit-partiels.json";
import {
  findDeadlineDatabase,
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
    const ws = structuredClone(sampleWorkspace);
    const page = ws.pages.find((p) => p.id === "page-assignments")!;
    const first = page.blocks[0].id;
    page.blocks.unshift({ id: "pa-h", type: "heading", level: 1, text: "📝 assignments" });
    const out = polish(ws).pages.find((p) => p.id === "page-assignments")!;
    expect(out.blocks[0].id).toBe(first);
    page.blocks[0] = { id: "pa-h", type: "heading", level: 2, text: "Assignments" };
    expect(polish(ws).pages.find((p) => p.id === "page-assignments")!.blocks[0].id).toBe(first);
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

/** A saved generator output (trimmed, the blocks polish itself adds removed). */
function fixture(doc: { workspace: unknown; locale: string; today: string }) {
  const ws = structuredClone(doc.workspace) as Workspace;
  expect(safeParseWorkspace(ws).success).toBe(true);
  return { ws, options: { ...OPTIONS, locale: doc.locale, today: doc.today } };
}

function blocksOf(ws: Workspace, pageId: string) {
  return ws.pages.find((p) => p.id === pageId)!.blocks;
}

function rowsShown(ws: Workspace, databaseId: string, viewId: string) {
  const db = ws.databases.find((d) => d.id === databaseId)!;
  const view = db.views.find((v) => v.id === viewId)!;
  return applyView(db, view, { today: "2026-11-12" });
}

describe("exams in a database of their own", () => {
  it("merges the exams into the graded-work list when the columns line up (de sample)", () => {
    const { ws, options } = fixture(deKlausuren);
    const out = polish(ws, options);
    expect(out.databases.map((d) => d.id)).toEqual(["db-uebungsblaetter", "db-lernplan"]);
    const work = out.databases.find((d) => d.id === "db-uebungsblaetter")!;
    // It holds the exams too now: not "Übungsblätter" any more, but the neutral name.
    expect(work.name).toBe("Bewertete Leistungen");
    expect(findDeadlineDatabase(out)?.id).toBe("db-uebungsblaetter");
    expect(findGradeDatabase(out)?.id).toBe("db-uebungsblaetter");

    // A type column tells the exams apart; the sheets stay untyped.
    const type = work.properties.find((p) => p.name === "Typ")!;
    expect(type).toMatchObject({ type: "select", options: [{ label: "Prüfung" }] });
    expect(work.properties.map((p) => p.id)).toEqual(["u-name", "u-modul", type.id, "u-status", "u-faellig", "u-punkte"]);
    const exam = type.options![0].id;

    const exams = work.rows.filter((r) => r.cells[type.id] === exam);
    expect(exams.map((r) => r.id)).toEqual(["kl-ana", "kl-algo", "kl-rn", "kl-theo"]);
    expect(exams[0].cells).toEqual({
      "u-name": "Klausur Analysis II",
      // Same course by label, so the existing option.
      "u-modul": "mo-ana",
      "u-faellig": "2027-02-15",
      // "Nicht begonnen" is the same state in both.
      "u-status": "us-todo",
      [type.id]: exam,
    });
    // No new course options or status columns.
    expect(work.properties.find((p) => p.id === "u-modul")!.options).toHaveLength(4);
    expect(work.properties.find((p) => p.id === "u-status")!.options).toHaveLength(3);
    expect(work.rows.filter((r) => r.cells[type.id] !== exam)).toHaveLength(4);

    // The Klausuren page shows the same two views, over the merged list, exams only.
    const page = blocksOf(out, "page-klausuren");
    const views = page.filter((b) => b.type === "database_view");
    expect(views).toHaveLength(2);
    for (const block of views) {
      expect(block).toMatchObject({ databaseId: "db-uebungsblaetter" });
      const shown = rowsShown(out, "db-uebungsblaetter", (block as { viewId: string }).viewId);
      expect(shown.map((r) => r.id)).toEqual(["kl-ana", "kl-algo", "kl-rn", "kl-theo"]);
    }
    const board = work.views.find((v) => v.name === "Nach Vorbereitung")!;
    expect(board).toMatchObject({ type: "board", groupByPropertyId: "u-status" });
    // The sheets' own views now list the exams too: one list.
    expect(rowsShown(out, "db-uebungsblaetter", "v-ub-table")).toHaveLength(8);

    expect(JSON.stringify(out)).not.toContain("db-klausuren");
    expect(JSON.stringify(out)).not.toMatch(/"k-(name|modul|datum|status)"/);
  });

  it("maps states and courses that differ by label, and fixes grades blocks and relations", () => {
    const { ws, options } = fixture(deKlausuren);
    const exams = ws.databases.find((d) => d.id === "db-klausuren")!;
    exams.rows[0].cells["k-status"] = "ks-done"; // "Bereit" -> the list's done state
    exams.rows[1].cells["k-status"] = "ks-doing"; // "In Vorbereitung" -> "In Bearbeitung"
    exams.properties[1].options!.push({ id: "km-new", label: "Lineare Algebra", color: "rose" });
    exams.rows[2].cells["k-modul"] = "km-new";
    // A grades block and a relation that point at the exams.
    blocksOf(ws, "page-klausuren").push({
      id: "g", type: "grades", databaseId: "db-klausuren", columns: { course: "k-modul", due: "k-datum" },
    });
    const plan = ws.databases.find((d) => d.id === "db-lernplan")!;
    plan.properties.push({ id: "l-exam", name: "Klausur", type: "relation", relationDatabaseId: "db-klausuren" });
    plan.rows[0].cells["l-exam"] = ["kl-ana"];

    const out = polish(ws, options);
    const work = out.databases.find((d) => d.id === "db-uebungsblaetter")!;
    const row = (id: string) => work.rows.find((r) => r.id === id)!;
    expect(row("kl-ana").cells["u-status"]).toBe("us-done");
    expect(row("kl-algo").cells["u-status"]).toBe("us-doing");
    const added = work.properties.find((p) => p.id === "u-modul")!.options!.find((o) => o.label === "Lineare Algebra")!;
    expect(row("kl-rn").cells["u-modul"]).toBe(added.id);
    expect(blocksOf(out, "page-klausuren").find((b) => b.id === "g")).toMatchObject({
      databaseId: "db-uebungsblaetter",
      columns: { course: "u-modul", due: "u-faellig" },
    });
    const relation = out.databases.find((d) => d.id === "db-lernplan")!.properties.find((p) => p.id === "l-exam");
    expect(relation?.relationDatabaseId).toBe("db-uebungsblaetter");
    expect(out.databases.find((d) => d.id === "db-lernplan")!.rows[0].cells["l-exam"]).toEqual(["kl-ana"]);
  });

  it("types exams with the list's own exam option, and renames rows whose ids are taken", () => {
    const { ws, options } = fixture(deKlausuren);
    const work = ws.databases.find((d) => d.id === "db-uebungsblaetter")!;
    work.properties.splice(2, 0, {
      id: "u-art",
      name: "Art",
      type: "select",
      options: [
        { id: "a-blatt", label: "Übungsblatt" },
        { id: "a-test", label: "Test" },
        { id: "a-klausur", label: "Klausur" },
      ],
    });
    work.rows[0].id = "kl-ana";
    const out = polish(ws, options);
    const merged = out.databases.find((d) => d.id === "db-uebungsblaetter")!;
    expect(merged.properties.filter((p) => p.type === "select")).toHaveLength(2);
    const exams = merged.rows.filter((r) => r.cells["u-art"] === "a-klausur");
    expect(exams.map((r) => r.id)).toEqual(["kl-ana-2", "kl-algo", "kl-rn", "kl-theo"]);
    expect(new Set(merged.rows.map((r) => r.id)).size).toBe(merged.rows.length);
  });

  it("carries an exams database's own type column over to the merged list", () => {
    const { ws, options } = fixture(deKlausuren);
    const exams = ws.databases.find((d) => d.id === "db-klausuren")!;
    exams.properties.push({
      id: "k-art",
      name: "Art",
      type: "select",
      options: [
        { id: "ka-zwischen", label: "Zwischenklausur" },
        { id: "ka-end", label: "Endklausur" },
      ],
    });
    exams.rows[0].cells["k-art"] = "ka-end";
    exams.rows[1].cells["k-art"] = "ka-zwischen";
    const out = polish(ws, options);
    expect(out.databases).toHaveLength(2);
    const work = out.databases.find((d) => d.id === "db-uebungsblaetter")!;
    const type = work.properties.find((p) => p.name === "Typ")!;
    expect(type.options!.map((o) => o.label)).toEqual(["Zwischenklausur", "Endklausur", "Prüfung"]);
    const label = (rowId: string) =>
      type.options!.find((o) => o.id === work.rows.find((r) => r.id === rowId)!.cells[type.id])!.label;
    expect(["kl-ana", "kl-algo", "kl-rn"].map(label)).toEqual(["Endklausur", "Zwischenklausur", "Prüfung"]);
    const page = blocksOf(out, "page-klausuren").filter((b) => b.type === "database_view");
    const shown = rowsShown(out, "db-uebungsblaetter", (page[0] as { viewId: string }).viewId);
    expect(shown).toHaveLength(4);
  });

  it("leaves the exams alone when a column has no counterpart (fr sample: Coefficient vs Poids %)", () => {
    const { ws, options } = fixture(frPartiels);
    const out = polish(ws, options);
    expect(out.databases.map((d) => d.id)).toEqual(["db-fiches", "db-partiels", "db-planning"]);
    const fiches = out.databases.find((d) => d.id === "db-fiches")!;
    expect(fiches.properties).toEqual(ws.databases.find((d) => d.id === "db-fiches")!.properties);
    expect(fiches.rows).toHaveLength(2);
    expect(blocksOf(out, "page-partiels").every((b) => b.type !== "database_view" || b.databaseId === "db-partiels")).toBe(true);
  });

  it("leaves a database alone that mixes exams with other work, or is linked to the graded work", () => {
    const { ws, options } = fixture(deKlausuren);
    ws.databases.find((d) => d.id === "db-klausuren")!.name = "Klausuren und Abgaben";
    expect(polish(ws, options).databases).toHaveLength(3);

    const linked = fixture(deKlausuren);
    linked.ws.databases.find((d) => d.id === "db-uebungsblaetter")!.properties.push({
      id: "u-exam", name: "Klausur", type: "relation", relationDatabaseId: "db-klausuren",
    });
    expect(polish(linked.ws, linked.options).databases).toHaveLength(3);
  });

  it("merges once", () => {
    const { ws, options } = fixture(deKlausuren);
    const once = polish(ws, options);
    expect(polish(once, options)).toEqual(once);
  });
});

describe("one section per heading on the dashboard", () => {
  it("folds the model's '🗓️ This week' into the added '📅 This week' (en sample)", () => {
    const { ws, options } = fixture(enTwoThisWeek);
    const out = polish(ws, options);
    const home = blocksOf(out, "page-home");
    const headings = home.filter((b) => b.type === "heading").map((b) => (b as { text: string }).text);
    expect(headings).toEqual(["📅 This week", "📊 Where your grades stand", "📌 Everything by status"]);
    expect(home.map((b) => b.id)).toEqual([
      "b-welcome",
      "b-this-week-heading",
      "b-this-week",
      // The study plan joins the deadlines under one heading.
      "b-weekly",
      "b-h-grades",
      "b-grades",
      "b-h-board",
      "b-board",
    ]);
    expect(polish(out, options)).toEqual(out);
  });

  it("keeps headings that only share words, and repeated headings under different parents", () => {
    const { ws, options } = fixture(enTwoThisWeek);
    const home = blocksOf(ws, "page-home");
    (home.find((b) => b.id === "b-h-plan") as { text: string }).text = "This week's tasks";
    home.push(
      { id: "x1", type: "heading", level: 2, text: "ECON 201" },
      { id: "x2", type: "heading", level: 3, text: "Notes" },
      { id: "x3", type: "paragraph", text: "a" },
      { id: "x4", type: "heading", level: 2, text: "MATH 221" },
      { id: "x5", type: "heading", level: 3, text: "Notes" },
      { id: "x6", type: "paragraph", text: "b" },
    );
    const out = polish(ws, options);
    const texts = blocksOf(out, "page-home").filter((b) => b.type === "heading").map((b) => (b as { text: string }).text);
    expect(texts).toEqual([
      "📅 This week",
      "This week's tasks",
      "📊 Where your grades stand",
      "📌 Everything by status",
      "ECON 201",
      "Notes",
      "MATH 221",
      "Notes",
    ]);
  });

  it("shows a view once when both sections had it, and leaves other pages alone", () => {
    const { ws, options } = fixture(enTwoThisWeek);
    const home = blocksOf(ws, "page-home");
    home.push(
      { id: "y1", type: "heading", level: 2, text: "📌 Everything by status!" },
      { id: "y2", type: "database_view", databaseId: "db-graded", viewId: "v-graded-board" },
      { id: "y3", type: "paragraph", text: "Drag cards to update them." },
    );
    blocksOf(ws, "page-planner").push(
      { id: "z1", type: "heading", level: 2, text: "Notes" },
      { id: "z2", type: "paragraph", text: "one" },
      { id: "z3", type: "heading", level: 2, text: "Notes" },
    );
    const out = polish(ws, options);
    expect(blocksOf(out, "page-home").slice(-3).map((b) => b.id)).toEqual(["b-h-board", "b-board", "y3"]);
    expect(blocksOf(out, "page-planner").map((b) => b.id).slice(-3)).toEqual(["z1", "z2", "z3"]);
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

describe("the graded-work list's name", () => {
  it("a list named after one kind of work that holds the exams gets the neutral name", () => {
    const ws = structuredClone(sampleWorkspace);
    const db = ws.databases.find((d) => d.id === "db-assignments")!;
    db.name = "Problem Sets & Labs";
    db.rows[0].cells["a-name"] = "Final exam";
    expect(polish(ws).databases.find((d) => d.id === "db-assignments")!.name).toBe("Graded work");
    db.name = "Assignments";
    expect(polish(ws).databases.find((d) => d.id === "db-assignments")!.name).toBe("Assignments");
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

  it("starts rows at the first open status unless the input says otherwise", () => {
    const ws = invented();
    const db = ws.databases.find((d) => d.id === "db-assignments")!;
    const status = db.properties.find((p) => p.type === "status")!;
    const [open, doing] = status.options!.map((o) => o.id);
    db.rows[0].cells[status.id] = doing;
    db.rows[1].cells[status.id] = doing;
    const title = (i: number) => String(db.rows[i].cells["a-name"]);
    const text = `Taking CS. ${title(1)} is already in progress.`;
    const out = removeUnsupportedFacts(ws, inputEvidence(text, 0));
    const rows = out.databases.find((d) => d.id === "db-assignments")!.rows;
    expect(rows[0].cells[status.id]).toBe(open);
    expect(rows[1].cells[status.id]).toBe(doing);
  });

  it("keeps only the grading categories, drops and counts the student gave", () => {
    const ws = invented();
    const db = ws.databases.find((d) => d.id === "db-assignments")!;
    db.grading = { categories: [{ id: "c", course: "x", name: "Weekly homework", weight: 30, dropLowest: 1, expectedCount: 10 }] };
    const given = removeUnsupportedFacts(ws, inputEvidence("Statistics: weekly homework 30%, midterm 30%", 0));
    expect(given.databases.find((d) => d.id === "db-assignments")!.grading?.categories).toEqual([
      { id: "c", course: "x", name: "Weekly homework", weight: 30 },
    ]);
    const stated = removeUnsupportedFacts(ws, inputEvidence("10 homeworks worth 30%, lowest one dropped", 0));
    expect(stated.databases.find((d) => d.id === "db-assignments")!.grading?.categories[0]).toMatchObject({ dropLowest: 1, expectedCount: 10 });
    const none = removeUnsupportedFacts(ws, inputEvidence("Statistics with weekly homework", 0));
    expect(none.databases.find((d) => d.id === "db-assignments")!.grading).toBeUndefined();
  });

  it("implies no dates when none were given: no month names in titles, no urgency in notes", () => {
    const ws = invented();
    const db = ws.databases.find((d) => d.id === "db-assignments")!;
    db.rows[0].cells["a-name"] = "Midterm Exam (February)";
    db.rows[1].cells["a-name"] = "Final exam – December";
    ws.pages[0].blocks.unshift(
      { id: "w1", type: "callout", text: "Welcome to your semester. Your midterm is coming up soon, so start reviewing!" },
      { id: "w2", type: "paragraph", text: "The final is next week." },
    );
    const out = removeUnsupportedFacts(ws, inputEvidence("CS student, midterm and final", 0));
    const rows = out.databases.find((d) => d.id === "db-assignments")!.rows;
    expect(rows[0].cells["a-name"]).toBe("Midterm Exam");
    expect(rows[1].cells["a-name"]).toBe("Final exam");
    expect(out.pages[0].blocks[0]).toMatchObject({ id: "w1", text: "Welcome to your semester." });
    expect(out.pages[0].blocks.some((b) => b.id === "w2")).toBe(false);

    // With a date in the input, nothing of this changes.
    const dated = removeUnsupportedFacts(ws, inputEvidence("midterm on 2026-12-03", 1));
    expect(dated.databases.find((d) => d.id === "db-assignments")!.rows[0].cells["a-name"]).toBe("Midterm Exam (February)");
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
