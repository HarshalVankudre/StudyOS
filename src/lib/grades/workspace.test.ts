import { describe, expect, it } from "vitest";
import type { Database, DatabaseProperty, Workspace } from "@/lib/workspace/types";
import { sampleWorkspace } from "@/lib/workspace/sample";
import {
  buildGradeReport,
  columnsToIds,
  detectGradeColumns,
  findGradeDatabase,
  gradeCourses,
  resolveGradeColumns,
  targetFor,
} from "./workspace";

function db(name: string, props: [string, DatabaseProperty["type"]][], extra: Partial<Database> = {}): Database {
  return {
    id: `db-${name}`,
    name,
    properties: props.map(([n, type], i) => ({ id: `p${i}`, name: n, type })),
    rows: [],
    views: [{ id: "v", name: "All", type: "table" }],
    ...extra,
  };
}

function names(d: Database) {
  const cols = detectGradeColumns(d);
  return {
    course: cols.course?.name,
    score: cols.score?.name,
    maxScore: cols.maxScore?.name,
    weight: cols.weight?.name,
    due: cols.due?.name,
  };
}

describe("detectGradeColumns in the product's ten languages", () => {
  it.each([
    ["en", ["Assignment", "Course", "Due", "Weight %", "Score", "Out of"]],
    ["es", ["Tarea", "Asignatura", "Fecha de entrega", "Peso %", "Nota", "Sobre"]],
    ["de", ["Aufgabe", "Kurs", "Fällig", "Gewichtung %", "Punkte", "Maximal"]],
    ["fr", ["Devoir", "Cours", "Échéance", "Pondération", "Note", "Barème"]],
    ["it", ["Compito", "Corso", "Scadenza", "Peso", "Voto", "Massimo"]],
    ["pt", ["Tarefa", "Disciplina", "Prazo", "Peso %", "Nota", "Máximo"]],
    ["nl", ["Opdracht", "Vak", "Deadline", "Weging", "Cijfer", "Maximaal"]],
    ["zh", ["作业", "课程", "截止日期", "权重", "成绩", "满分"]],
    ["ja", ["課題", "科目", "締切", "配点", "得点", "満点"]],
    ["ar", ["الواجب", "المقرر", "موعد التسليم", "الوزن", "الدرجة", "الدرجة العظمى"]],
  ])("%s", (_lang, cols) => {
    const [title, course, due, weight, score, max] = cols as string[];
    const d = db("x", [
      [title, "text"],
      [course, "select"],
      [due, "date"],
      [weight, "number"],
      [score, "number"],
      [max, "number"],
    ]);
    expect(names(d)).toEqual({ course, score, maxScore: max, weight, due });
  });

  it("does not mistake credits, targets or a Spanish 'Nota de examen' for the wrong column", () => {
    const d = db("x", [
      ["Name", "text"],
      ["Credits", "number"],
      ["Target grade", "number"],
      ["Nota de examen", "number"],
    ]);
    expect(names(d)).toMatchObject({ score: "Nota de examen", maxScore: undefined, weight: undefined });
  });

  it("'Grade %' is a score, a bare '%' is a weight", () => {
    expect(names(db("x", [["Name", "text"], ["Grade %", "number"], ["%", "number"]]))).toMatchObject({
      score: "Grade %",
      weight: "%",
    });
  });

  it("prefers a relation to courses, and never uses the title as the course", () => {
    const d = db("x", [
      ["Course", "text"],
      ["Class", "relation"],
    ]);
    expect(names(d).course).toBe("Class");
    expect(names(db("x", [["Course", "text"]])).course).toBeUndefined();
  });

  it("finds nothing in a database without numbers", () => {
    expect(names(db("x", [["Name", "text"]]))).toEqual({
      course: undefined,
      score: undefined,
      maxScore: undefined,
      weight: undefined,
      due: undefined,
    });
  });
});

describe("resolveGradeColumns", () => {
  const d = db("x", [
    ["Name", "text"],
    ["Course", "select"],
    ["Score", "number"],
    ["Weight %", "number"],
    ["Bonus", "number"],
  ]);

  it("keeps explicit choices, detects the rest", () => {
    const cols = resolveGradeColumns(d, { score: "p4" });
    expect(cols.score?.name).toBe("Bonus");
    expect(cols.weight?.name).toBe("Weight %");
    expect(cols.course?.name).toBe("Course");
  });

  it("null means none, and is never re-detected", () => {
    expect(resolveGradeColumns(d, { weight: null }).weight).toBeUndefined();
  });

  it("a deleted or ill-typed column falls back to detection", () => {
    expect(resolveGradeColumns(d, { score: "gone" }).score?.name).toBe("Score");
    expect(resolveGradeColumns(d, { score: "p1" }).score?.name).toBe("Score");
  });

  it("columnsToIds writes null for the missing ones", () => {
    expect(columnsToIds(resolveGradeColumns(d, undefined))).toEqual({
      course: "p1",
      score: "p2",
      maxScore: null,
      weight: "p3",
      due: null,
    });
  });
});

describe("findGradeDatabase", () => {
  it("picks the assignments database of the sample workspace", () => {
    expect(findGradeDatabase(sampleWorkspace)?.id).toBe("db-assignments");
  });

  it("ignores databases with only unrelated numbers", () => {
    const ws: Workspace = {
      id: "w",
      name: "W",
      pages: [],
      databases: [db("Habits", [["Habit", "text"], ["Minutes", "number"]])],
    };
    expect(findGradeDatabase(ws)).toBeUndefined();
  });
});

describe("gradeCourses and buildGradeReport", () => {
  function workspace(): Workspace {
    const courses: Database = {
      id: "db-courses",
      name: "Courses",
      properties: [
        { id: "c-name", name: "Course", type: "text" },
        { id: "c-code", name: "Code", type: "text" },
        { id: "c-ects", name: "ECTS", type: "number" },
      ],
      rows: [
        { id: "r1", cells: { "c-name": "Analysis I", "c-code": "MA 101", "c-ects": 9 } },
        { id: "r2", cells: { "c-name": "Programmieren", "c-code": "IN 101", "c-ects": 6 } },
      ],
      views: [],
    };
    const work: Database = {
      id: "db-work",
      name: "Prüfungsleistungen",
      properties: [
        { id: "w-name", name: "Leistung", type: "text" },
        {
          id: "w-kurs",
          name: "Kurs",
          type: "select",
          options: [
            { id: "o-ma", label: "MA 101" },
            { id: "o-in", label: "Programmieren" },
            { id: "o-empty", label: "Empty course" },
          ],
        },
        { id: "w-gew", name: "Gewichtung %", type: "number" },
        { id: "w-pkt", name: "Punkte", type: "number" },
        { id: "w-max", name: "von", type: "number" },
        {
          id: "w-status",
          name: "Status",
          type: "status",
          options: [
            { id: "s-open", label: "Offen" },
            { id: "s-done", label: "Erledigt", color: "green" },
          ],
        },
      ],
      rows: [
        { id: "a", cells: { "w-name": "Übung", "w-kurs": "o-ma", "w-gew": 40, "w-pkt": 18, "w-max": 20, "w-status": "s-done" } },
        { id: "b", cells: { "w-name": "Klausur", "w-kurs": "o-ma", "w-gew": 60 } },
        { id: "c", cells: { "w-name": "Projekt", "w-kurs": "o-in", "w-gew": 100, "w-pkt": 70 } },
        { id: "d", cells: { "w-name": "Loose", "w-gew": 10, "w-status": "s-done" } },
      ],
      views: [],
    };
    return { id: "w", name: "W", pages: [], databases: [courses, work] };
  }

  it("groups rows by course in option order, no-course last, with credits matched by code or name", () => {
    const ws = workspace();
    const d = ws.databases[1];
    const groups = gradeCourses(ws, d, resolveGradeColumns(d, undefined));
    expect(groups.map((g) => [g.key, g.label, g.credits])).toEqual([
      ["o-ma", "MA 101", 9],
      ["o-in", "Programmieren", 6],
      ["", "", null],
    ]);
    expect(groups[0].items[0]).toMatchObject({ name: "Übung", score: 18, maxScore: 20, weight: 40, done: true });
    expect(groups[2].items[0].done).toBe(true);
  });

  it("builds the whole report with targets, scale and a credit-weighted summary", () => {
    const ws = workspace();
    const report = buildGradeReport(ws, {
      databaseId: "db-work",
      scale: "de_grade",
      defaultTarget: 80,
      targets: { "o-in": 60 },
    })!;
    expect(report.database.id).toBe("db-work");
    const [ma, inf] = report.courses;
    expect(ma.target).toBe(80);
    expect(ma.grade.current).toBeCloseTo(90);
    // (80*100 - 40*90) / 60 = 73.3
    expect(ma.grade.outlook).toEqual({ kind: "needed", average: expect.closeTo(73.33, 1) });
    expect(inf.target).toBe(60);
    expect(inf.grade.outlook).toEqual({ kind: "met", final: 70 });
    expect(report.summary.weighting).toBe("credits");
    expect(report.summary.average).toBeCloseTo((90 * 9 + 70 * 6) / 15);
    // 90 % -> 1,3 ; 70 % -> 2,7
    expect(report.summary.points).toBeCloseTo((1.3 * 9 + 2.7 * 6) / 15);
  });

  it("what-if changes the report without touching the workspace", () => {
    const ws = workspace();
    const before = JSON.stringify(ws);
    const report = buildGradeReport(ws, { databaseId: "db-work" }, { whatIf: { b: 50 } })!;
    expect(report.courses[0].grade.final).toBeCloseTo(66);
    expect(JSON.stringify(ws)).toBe(before);
  });

  it("a block without a database uses the best guess; a missing database gives null", () => {
    const ws = workspace();
    expect(buildGradeReport(ws, {})?.database.id).toBe("db-work");
    expect(buildGradeReport(ws, { databaseId: "gone" })).toBeNull();
  });

  it("relation course columns use the related rows and their credits", () => {
    const ws = workspace();
    const d = ws.databases[1];
    d.properties[1] = { id: "w-kurs", name: "Kurs", type: "relation", relationDatabaseId: "db-courses" };
    d.rows[0].cells["w-kurs"] = ["r1"];
    d.rows[2].cells["w-kurs"] = ["r2"];
    d.rows[1].cells["w-kurs"] = ["r1"];
    const groups = gradeCourses(ws, d, resolveGradeColumns(d, undefined));
    expect(groups.map((g) => [g.key, g.label, g.credits])).toEqual([
      ["r1", "Analysis I", 9],
      ["r2", "Programmieren", 6],
      ["", "", null],
    ]);
  });

  it("text course columns group by name, ignoring case and spacing", () => {
    const ws = workspace();
    const d = ws.databases[1];
    d.properties[1] = { id: "w-kurs", name: "Kurs", type: "text" };
    d.rows[0].cells["w-kurs"] = "Analysis I";
    d.rows[1].cells["w-kurs"] = "analysis  i";
    d.rows[2].cells["w-kurs"] = "Programmieren";
    const groups = gradeCourses(ws, d, resolveGradeColumns(d, undefined));
    expect(groups.map((g) => [g.label, g.items.length, g.credits])).toEqual([
      ["Analysis I", 2, 9],
      ["Programmieren", 1, 6],
      ["", 1, null],
    ]);
  });

  it("targetFor: own target, then the default, then none", () => {
    expect(targetFor({ targets: { a: 70 }, defaultTarget: 50 }, "a")).toBe(70);
    expect(targetFor({ targets: { a: 70 }, defaultTarget: 50 }, "b")).toBe(50);
    expect(targetFor({}, "b")).toBeNull();
  });
});
