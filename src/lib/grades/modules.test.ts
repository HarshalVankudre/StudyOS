/**
 * Module-grade entry (German grades typed per module): the data model, the
 * reader, and every consumer of grades blocks that must never read a grade
 * such as 1.7 as a percentage.
 */
import { describe, expect, it } from "vitest";
import type { Database, GradesBlock, Workspace } from "@/lib/workspace/types";
import { safeParseWorkspace } from "@/lib/workspace/schema";
import { repairWorkspace } from "@/lib/workspace/repair";
import { sampleWorkspace } from "@/lib/workspace/sample";
import { applyAgentOps, agentOpsSchema } from "@/lib/ai/agent-ops";
import { WORKSPACE_SHAPE } from "@/lib/ai/generate";
import { polishGeneratedWorkspace } from "@/lib/ai/generate-polish";
import { gradesWeightResolver } from "@/lib/agents/daily-study/grades-hook";
import { pageToMarkdown } from "@/lib/export/markdown";
import { toPublicPage } from "@/lib/share/public-view";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { LOCALES } from "@/lib/i18n/config";
import { ensureGradeTracking } from "./ensure";
import { neededAverage } from "./german";
import { buildModuleReport, isGradeEntry, looksLikeModuleGrades, newGradesBlockSettings } from "./modules";
import { buildGradeReport, detectGradeColumns } from "./workspace";

/** A German module list: Modul, LP, Note, a status and the exam date. */
function modulesDb(rows: [id: string, name: string, lp: number | null, note: number | null][], withLp = true): Database {
  return {
    id: "db-mod",
    name: "Module",
    properties: [
      { id: "name", name: "Modul", type: "text" },
      ...(withLp ? [{ id: "lp", name: "LP", type: "number" as const }] : []),
      { id: "note", name: "Note", type: "number" },
      {
        id: "status",
        name: "Status",
        type: "status",
        options: [
          { id: "todo", label: "Not started" },
          { id: "done", label: "Done" },
        ],
      },
      { id: "due", name: "Prüfung", type: "date" },
    ],
    rows: rows.map(([id, name, lp, note]) => ({
      id,
      cells: { name, ...(withLp ? { lp } : {}), note, status: note === null ? "todo" : "done", due: null },
    })),
    views: [{ id: "v", name: "Alle", type: "table" }],
  };
}

const SEMESTER: [string, string, number | null, number | null][] = [
  ["m1", "Mathematik I", 9, 1.3],
  ["m2", "Programmierung", 6, 2.7],
  ["m3", "Statistik", 6, 5.0],
  ["m4", "Datenbanken", 5, null],
  ["m5", "Seminar", 3, 87],
];

const moduleBlock = (extra: Partial<GradesBlock> = {}): GradesBlock => ({
  id: "g",
  type: "grades",
  title: "Noten",
  databaseId: "db-mod",
  scale: "de_grade",
  entry: "grade",
  ...extra,
});

function ws(db: Database, block: GradesBlock = moduleBlock(), more: Database[] = []): Workspace {
  return {
    id: "w",
    name: "Informatik",
    pages: [{ id: "p", title: "Noten", blocks: [block] }],
    databases: [db, ...more],
  };
}

function wsWith(block: unknown): unknown {
  return { id: "w", name: "W", pages: [{ id: "p", title: "P", blocks: [block] }], databases: [] };
}

describe("data model", () => {
  it("accepts entry, targetGrade and a credits column; existing blocks parse as before", () => {
    expect(
      safeParseWorkspace(
        wsWith({ ...moduleBlock(), targetGrade: 2, columns: { score: "note", credits: "lp", course: null } }),
      ).success,
    ).toBe(true);
    expect(safeParseWorkspace(wsWith({ id: "g", type: "grades", scale: "de_grade", defaultTarget: 80 })).success).toBe(true);
  });

  it("rejects an unknown entry and a target average outside 1,0 to 5,0", () => {
    expect(safeParseWorkspace(wsWith({ ...moduleBlock(), entry: "points" })).success).toBe(false);
    expect(safeParseWorkspace(wsWith({ ...moduleBlock(), targetGrade: 0.5 })).success).toBe(false);
    expect(safeParseWorkspace(wsWith({ ...moduleBlock(), targetGrade: 6 })).success).toBe(false);
  });

  it("normalises entry \"grade\" without German grades: it parses, and reads percentages as before", () => {
    const block = moduleBlock({ scale: "percent" });
    expect(safeParseWorkspace(wsWith(block)).success).toBe(true);
    expect(isGradeEntry(block)).toBe(false);
    expect(isGradeEntry({ scale: "de_grade" })).toBe(false);
    expect(isGradeEntry({ scale: "de_grade", entry: "grade" })).toBe(true);
  });

  it("repair keeps the block and drops a broken entry or target", () => {
    const result = repairWorkspace(wsWith({ ...moduleBlock(), entry: "nonsense", targetGrade: "two" }));
    const block = result!.workspace.pages[0].blocks[0] as GradesBlock;
    expect(block).toMatchObject({ type: "grades", scale: "de_grade", databaseId: "db-mod" });
    expect(block.entry).toBeUndefined();
    expect(block.targetGrade).toBeUndefined();
  });

  it("detects the LP column as credits, never as a score or weight", () => {
    const cols = detectGradeColumns(modulesDb(SEMESTER));
    expect(cols.score?.id).toBe("note");
    expect(cols.credits?.id).toBe("lp");
    expect(cols.weight).toBeUndefined();
  });

  it("a new block in a German interface starts with German module grades, elsewhere as today", () => {
    expect(newGradesBlockSettings("de")).toEqual({ scale: "de_grade", entry: "grade" });
    expect(newGradesBlockSettings("en")).toEqual({});
    expect(newGradesBlockSettings("fr")).toEqual({});
  });
});

describe("buildModuleReport", () => {
  it("reads every row as a module: grade, credits, passed, failed, open and not a grade", () => {
    const report = buildModuleReport(ws(modulesDb(SEMESTER)), moduleBlock())!;
    expect(report.modules.map((m) => [m.name, m.credits, m.grade, m.status])).toEqual([
      ["Mathematik I", 9, 1.3, "passed"],
      ["Programmierung", 6, 2.7, "passed"],
      ["Statistik", 6, 5, "failed"],
      ["Datenbanken", 5, null, "open"],
      // 87 is not a German grade: flagged and left out, never read as 8,7 or 87 %.
      ["Seminar", 3, null, "invalid"],
    ]);
    expect(report.modules[4].invalid).toBe(87);
    // (1,3 · 9 + 2,7 · 6) / 15 = 1,86: shown 1,8, failed and invalid modules left out.
    expect(report.average).toMatchObject({
      shown: 1.8,
      unrounded: 1.86,
      passed: 2,
      failed: 1,
      open: 1,
      excluded: 1,
      earnedEcts: 15,
      openEcts: 5,
      weighting: "ects",
    });
  });

  it("answers what the open modules need for the target average", () => {
    const report = buildModuleReport(ws(modulesDb(SEMESTER)), moduleBlock({ targetGrade: 2 }))!;
    expect(report.target).toBe(2);
    const list = [
      { ects: 9, grade: 1.3 },
      { ects: 6, grade: 2.7 },
      { ects: 6, grade: 5 },
      { ects: 5, grade: null },
    ];
    expect(report.needed).toEqual(neededAverage(list, 2));
    expect(report.needed?.kind).toBe("needed");
    // A target that is not a passing grade is no target.
    expect(buildModuleReport(ws(modulesDb(SEMESTER)), moduleBlock({ targetGrade: 4.5 }))!.needed).toBeNull();
  });

  it("takes the credits from the course when the list has no credits column, else leaves them unknown", () => {
    const db = modulesDb(
      [
        ["a", "Analysis", null, 1.0],
        ["b", "Algebra", null, 1.2],
        ["c", "Physik", null, null],
      ],
      false,
    );
    db.properties.push({ id: "course", name: "Kurs", type: "relation", relationDatabaseId: "db-courses" });
    db.rows[0].cells.course = ["k1"];
    db.rows[1].cells.course = ["k2"];
    const courses: Database = {
      id: "db-courses",
      name: "Kurse",
      properties: [
        { id: "kn", name: "Kurs", type: "text" },
        { id: "ke", name: "ECTS", type: "number" },
      ],
      rows: [
        { id: "k1", cells: { kn: "Analysis", ke: 8 } },
        { id: "k2", cells: { kn: "Algebra", ke: 8 } },
      ],
      views: [],
    };
    const report = buildModuleReport(ws(db, moduleBlock(), [courses]), moduleBlock({ targetGrade: 1.5 }))!;
    expect(report.modules.map((m) => m.credits)).toEqual([8, 8, null]);
    // 1,0 and 1,2 at equal credits: exactly 1,1, never 1,0 from 1,0999...
    expect(report.average.shown).toBe(1.1);
    // Physik has no credits: what it needs cannot be said.
    expect(report.needed).toEqual({ kind: "missingEcts", count: 1 });
  });

  it("what-if grades count for open modules only and are marked", () => {
    const report = buildModuleReport(ws(modulesDb(SEMESTER)), moduleBlock(), { whatIf: { m4: 1.0, m1: 4.0 } })!;
    const db = report.modules.find((m) => m.id === "m4")!;
    expect(db).toMatchObject({ grade: 1, hypothetical: true, status: "passed" });
    expect(report.modules.find((m) => m.id === "m1")).toMatchObject({ grade: 1.3, hypothetical: false });
    // (13·9 + 27·6 + 10·5) / 20 = 16,45 tenths -> 1,6.
    expect(report.average.shown).toBe(1.6);
  });

  it("weights, max scores and categories do not apply", () => {
    const db = modulesDb(SEMESTER);
    db.properties.push({ id: "w", name: "Weight %", type: "number" });
    db.rows[0].cells.w = 50;
    db.grading = { categories: [{ id: "c", course: "*", name: "Übungen", weight: 30 }] };
    expect(buildModuleReport(ws(db), moduleBlock())!.average.shown).toBe(1.8);
  });
});

describe("the offer to read old percentages as grades", () => {
  const percentBlock = (extra: Partial<GradesBlock> = {}): GradesBlock => ({
    id: "g",
    type: "grades",
    databaseId: "db-mod",
    scale: "de_grade",
    columns: { score: "note" },
    ...extra,
  });
  const offer = (db: Database, block: GradesBlock) => looksLikeModuleGrades(block, buildGradeReport(ws(db, block), block));

  it("shows when every score of a German percentage block lies between 1 and 5", () => {
    expect(offer(modulesDb([["a", "A", 6, 1.7], ["b", "B", 6, 2.3], ["c", "C", 6, null]]), percentBlock())).toBe(true);
  });

  it("not with a real percentage, without scores, on another scale, or once switched", () => {
    expect(offer(modulesDb([["a", "A", 6, 1.7], ["b", "B", 6, 87]]), percentBlock())).toBe(false);
    expect(offer(modulesDb([["a", "A", 6, null]]), percentBlock())).toBe(false);
    expect(offer(modulesDb([["a", "A", 6, 1.7]]), percentBlock({ scale: "percent" }))).toBe(false);
    expect(offer(modulesDb([["a", "A", 6, 1.7]]), percentBlock({ entry: "grade" }))).toBe(false);
  });
});

describe("consumers never read a module grade as a percentage", () => {
  it("the planner gets no weight from a block of module grades", () => {
    const db = modulesDb(SEMESTER);
    db.properties.push({ id: "w", name: "Weight %", type: "number" });
    db.rows[0].cells.w = 40;
    const resolver = gradesWeightResolver();
    expect(resolver(ws(db), db, db.rows[0])).toBeUndefined();
    // The same list under a percentage block: its weight column counts, as before.
    const percent = { ...moduleBlock(), entry: undefined };
    expect(gradesWeightResolver()(ws(db, percent), db, db.rows[0])).toBe(40);
  });

  it("the Markdown export writes the average, the target and each module with credits and grade", () => {
    const md = pageToMarkdown(
      { id: "p", title: "Noten", blocks: [moduleBlock({ targetGrade: 2 })] },
      { databases: [modulesDb(SEMESTER)] },
      { today: "2026-11-13" },
    );
    expect(md).toContain("**Noten**");
    expect(md).toContain("Grade average: 1.8 · Unrounded: 1.86 · Target average: 2.0");
    expect(md).toContain(
      "| Module | ECTS | Grade |\n| --- | --- | --- |\n| Mathematik I | 9 | 1.3 |\n| Programmierung | 6 | 2.7 |\n| Statistik | 6 | 5.0 (Not passed) |\n| Datenbanken | 5 | not graded yet |\n| Seminar | 3 | 87 |",
    );
    expect(md).not.toContain("%");
    // In German, as the export menu labels it.
    const E = getDictionary("de").tools.gradeCalculator.ects;
    const de = pageToMarkdown(
      { id: "p", title: "Noten", blocks: [moduleBlock()] },
      { databases: [modulesDb(SEMESTER)] },
      {
        today: "2026-11-13",
        locale: "de",
        labels: { gradeAverage: E.average, gradeModule: E.moduleColumn, gradeCredits: E.ectsColumn, gradeGrade: E.gradeColumn },
      },
    );
    expect(de).toContain("Notenschnitt: 1,8");
    expect(de).toContain("| Modul | LP | Note |");
  });

  it("a shared page leaves a block of module grades out without a trace", () => {
    const page = { id: "p", title: "Noten", blocks: [moduleBlock({ title: "Mein Schnitt" })] };
    const view = toPublicPage(page, { id: "w", databases: [modulesDb(SEMESTER)] }, { token: "t", today: "2026-11-13" });
    expect(view.blocks).toEqual([]);
    expect(JSON.stringify(view)).not.toContain("Mein Schnitt");
  });

  it("post-generation clean-up keeps a real credits column and drops a made-up one", () => {
    const keep = ensureGradeTracking(ws(modulesDb(SEMESTER), moduleBlock({ columns: { score: "note", credits: "lp" } })), {
      score: "Ergebnis",
      heading: "Noten",
      title: "Noten",
    });
    expect((keep.pages[0].blocks[0] as GradesBlock).columns).toEqual({ score: "note", credits: "lp" });
    const drop = ensureGradeTracking(ws(modulesDb(SEMESTER), moduleBlock({ columns: { score: "note", credits: "nope" } })), {
      score: "Ergebnis",
      heading: "Noten",
      title: "Noten",
    });
    expect((drop.pages[0].blocks[0] as GradesBlock).columns).toEqual({ score: "note" });
  });

  it("generation polish keeps a module list a grades block reads, though it has no dates", () => {
    const base = structuredClone(sampleWorkspace);
    base.databases.push({ ...modulesDb(SEMESTER), id: "db-noten", name: "Noten" });
    base.pages.push({ id: "page-noten", title: "Noten", blocks: [moduleBlock({ databaseId: "db-noten" })] });
    const options = { locale: "de", today: "2026-11-12", labels: { thisWeek: "Diese Woche", gradesTitle: "Noten" } };
    const kept = polishGeneratedWorkspace(base, options);
    expect(kept.databases.some((d) => d.id === "db-noten")).toBe(true);
    // A rival grade table that no module-grade block reads is still replaced (as before).
    const rival = structuredClone(base);
    rival.pages = rival.pages.filter((p) => p.id !== "page-noten");
    rival.pages.push({
      id: "page-noten",
      title: "Noten",
      blocks: [{ id: "t", type: "database_view", databaseId: "db-noten", viewId: "v" }],
    });
    expect(polishGeneratedWorkspace(rival, options).databases.some((d) => d.id === "db-noten")).toBe(false);
  });
});

describe("the AI agent and generator", () => {
  const base = (): Workspace => structuredClone(sampleWorkspace);

  it("set_grades_block accepts module grades with German grades, a credits column and a target average", () => {
    const ops = agentOpsSchema.parse([
      {
        op: "set_grades_block",
        pageId: "page-home",
        block: {
          id: "b-g",
          type: "grades",
          databaseId: "db-assignments",
          scale: "de_grade",
          entry: "grade",
          targetGrade: 1.7,
          columns: { score: "a-score", credits: null },
        },
      },
    ]);
    const next = applyAgentOps(base(), ops);
    expect(next.pages[0].blocks.find((b) => b.id === "b-g")).toMatchObject({ entry: "grade", targetGrade: 1.7 });
    expect(safeParseWorkspace(next).success).toBe(true);
  });

  it("set_grades_block refuses module grades on any other scale", () => {
    const ops = agentOpsSchema.parse([
      { op: "set_grades_block", pageId: "page-home", block: { id: "b-g", type: "grades", scale: "percent", entry: "grade" } },
    ]);
    expect(() => applyAgentOps(base(), ops)).toThrow(/entry "grade" \(module grades\) needs scale "de_grade"/);
  });

  it("the generator's shape documents entry, targetGrade and the credits column", () => {
    expect(WORKSPACE_SHAPE).toContain('entry?: "percent"|"grade"');
    expect(WORKSPACE_SHAPE).toContain("targetGrade?: number");
    expect(WORKSPACE_SHAPE).toContain("credits? }");
  });
});

describe("strings in all ten languages", () => {
  const codes = LOCALES.map((l) => l.code);
  const en = getDictionary("en");

  it.each(codes)("%s has every module-grade string, with the same placeholders", (code) => {
    const M = getDictionary(code).grades.modules;
    expect(Object.keys(M).sort()).toEqual(Object.keys(en.grades.modules).sort());
    const vars = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    for (const [key, value] of Object.entries(M)) {
      expect(value.trim(), key).not.toBe("");
      expect(vars(value), key).toEqual(vars(en.grades.modules[key as keyof typeof M]));
    }
    if (code !== "en") expect(M.entryGrade).not.toBe(en.grades.modules.entryGrade);
  });

  it("German speaks the students' words", () => {
    const M = getDictionary("de").grades.modules;
    expect(M.entryGrade).toBe("Modulnoten direkt eintragen (1,0 bis 5,0), ein Modul pro Zeile");
    expect(M.looksLikeGrades).toBe("Das sieht nach Noten aus, nicht nach Prozenten. Als Modulnoten lesen?");
    expect(M.counts).toContain("bestanden");
  });

  it.each(codes)("%s: the grades help article mentions the module-grade average", (code) => {
    const text = getDictionary(code).help.articles.grades.sections.map((s) => s.text).join(" ");
    expect(text).toMatch(/Notenschnitt/);
  });
});
