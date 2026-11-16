/**
 * Module-grade entry: how most German students track grades. Every row of
 * the block's list is a module that ends in one grade from 1,0 to 5,0, typed
 * straight into the score column; what counts is the Notenschnitt, the
 * credit-weighted average of the passed modules (lib/grades/german.ts).
 *
 * Weights, "out of" scores and grading categories do not apply here, and a
 * number that is not a German grade (87) is never read as one: the row is
 * reported as "not a grade" and left out.
 *
 * Pure (no React): the grades block, the overview and the Markdown export
 * read the same report.
 */
import type { CellValue, Database, GradesBlock, Workspace } from "@/lib/workspace/types";
import { titleProperty } from "@/lib/workspace/helpers";
import { completionField, isRowComplete } from "@/lib/workspace/view-logic";
import { germanAverage, gradeToTenths, neededAverage, PASS_LIMIT_TENTHS, type GermanAverage, type GermanNeeded } from "./german";
import { resolveScale, type ScaleDefinition } from "./scales";
import {
  courseCredits,
  gradeDatabaseFor,
  resolveGradeColumns,
  rowCourse,
  type GradeReport,
  type ResolvedColumns,
} from "./workspace";

/** True when the block reads module grades (only ever together with German grades). */
export function isGradeEntry(block: Pick<GradesBlock, "entry" | "scale">): boolean {
  return block.entry === "grade" && block.scale === "de_grade";
}

/**
 * The settings of a new grades block: German students get German grades
 * entered as module grades, everyone else today's percentage tracker.
 */
export function newGradesBlockSettings(locale: string): Pick<GradesBlock, "scale" | "entry"> {
  return locale === "de" ? { scale: "de_grade", entry: "grade" } : {};
}

export type ModuleStatus = "passed" | "failed" | "open" | "invalid";

export interface ModuleRow {
  /** The row id. */
  id: string;
  /** The row title ("" when it has none; the UI names it). */
  name: string;
  /** Credits from the credits column, else the course's; null when unknown. */
  credits: number | null;
  /** The grade (1.0..5.0) that counts, an assumed one included; null while open or not a grade. */
  grade: number | null;
  /** The number in the grade cell when it is not a German grade (87), else null. */
  invalid: number | null;
  /** The grade is a what-if assumption, not saved. */
  hypothetical: boolean;
  status: ModuleStatus;
  /** The row is marked done in the list. */
  done: boolean;
}

export interface ModuleReport {
  database: Database;
  columns: ResolvedColumns;
  scale: ScaleDefinition;
  modules: ModuleRow[];
  average: GermanAverage;
  /** The target average, or null (none set, or not a passing grade). */
  target: number | null;
  /** What the open modules need for the target; null without one. */
  needed: GermanNeeded | null;
}

export interface ModuleReportOptions {
  /** What-if grades for open modules, by row id (never saved). */
  whatIf?: Readonly<Record<string, number>>;
}

function num(value: CellValue | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function rowTitle(db: Database, cells: Record<string, CellValue>): string {
  const title = titleProperty(db);
  const value = title ? cells[title.id] : null;
  return typeof value === "string" ? value.trim() : value == null ? "" : String(value);
}

/** The target average a block asks for, when it is a passing German grade. */
export function targetGradeOf(block: Pick<GradesBlock, "targetGrade">): number | null {
  const tenths = gradeToTenths(block.targetGrade);
  return tenths !== null && tenths <= PASS_LIMIT_TENTHS ? tenths / 10 : null;
}

/**
 * The modules of a block in module-grade entry, with the Notenschnitt and
 * what the open modules need for the target. Null when the block's list
 * does not exist (anymore). Callers check `isGradeEntry` first.
 */
export function buildModuleReport(
  workspace: Workspace,
  block: Omit<GradesBlock, "id" | "type">,
  options: ModuleReportOptions = {},
): ModuleReport | null {
  const database = gradeDatabaseFor(workspace, block);
  if (!database) return null;
  const columns = resolveGradeColumns(database, block.columns);
  const scale = resolveScale("de_grade");
  const completion = completionField(database);

  // Credits of the courses the rows name, when the list has no credits column of its own.
  const courses = new Map<string, { key: string; label: string }>();
  if (columns.course && !columns.credits) {
    for (const row of database.rows) {
      const course = rowCourse(workspace, columns.course, row);
      if (course) courses.set(row.id, course);
    }
  }
  const distinct = [...new Map([...courses.values()].map((c) => [c.key, c])).values()];
  const fromCourses = courseCredits(workspace, database, columns.course, distinct);

  const modules: ModuleRow[] = database.rows.map((row) => {
    const own = columns.credits ? num(row.cells[columns.credits.id]) : null;
    const course = courses.get(row.id);
    const viaCourse = course ? (fromCourses.get(course.key) ?? null) : null;
    const credits = own ?? viaCourse;
    const value = columns.score ? num(row.cells[columns.score.id]) : null;
    const tenths = gradeToTenths(value);
    const invalid = value !== null && tenths === null ? value : null;
    let grade = tenths === null ? null : tenths / 10;
    let hypothetical = false;
    const assumed = options.whatIf?.[row.id];
    if (value === null && assumed !== undefined && gradeToTenths(assumed) !== null) {
      grade = assumed;
      hypothetical = true;
    }
    const status: ModuleStatus =
      invalid !== null ? "invalid" : grade === null ? "open" : Math.round(grade * 10) > PASS_LIMIT_TENTHS ? "failed" : "passed";
    return {
      id: row.id,
      name: rowTitle(database, row.cells),
      credits: credits !== null && credits > 0 ? credits : null,
      grade,
      invalid,
      hypothetical,
      status,
      done: isRowComplete(database, row, completion),
    };
  });

  const list = modules.map((m) => ({ ects: m.credits, grade: m.grade, counts: m.status !== "invalid" }));
  const target = targetGradeOf(block);
  return {
    database,
    columns,
    scale,
    modules,
    average: germanAverage(list),
    target,
    needed: target === null ? null : neededAverage(list, target),
  };
}

/**
 * A German block that reads percentages, but every score entered lies
 * between 1 and 5 (and none is points out of something): almost certainly
 * module grades typed as percentages. The block offers to read them as
 * grades; it never switches by itself.
 */
export function looksLikeModuleGrades(block: Pick<GradesBlock, "entry" | "scale">, report: GradeReport | null): boolean {
  if (!report || block.scale !== "de_grade" || isGradeEntry(block)) return false;
  const scored = report.courses.flatMap((c) => c.items).filter((i) => i.score !== null);
  return (
    scored.length > 0 &&
    scored.every((i) => i.maxScore === null && (i.score as number) >= 1 && (i.score as number) <= 5)
  );
}
