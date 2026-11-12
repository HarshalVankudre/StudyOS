/**
 * The bridge between a workspace and the grade math: find the database of
 * graded work, work out which column is which (in any of the ten languages),
 * group its rows by course, look up course credits, and run the calculation.
 *
 * Pure (no React): the grades block renders `buildGradeReport`, and the daily
 * planner can call the same function to find courses at risk.
 */
import type {
  CellValue,
  Database,
  DatabaseProperty,
  DatabaseRow,
  GradeCategory,
  GradesBlock,
  GradesColumns,
  Workspace,
} from "@/lib/workspace/types";
import { titleProperty } from "@/lib/workspace/helpers";
import { completionField, isRowComplete } from "@/lib/workspace/view-logic";
import { findRow } from "@/lib/workspace/row-lookup";
import {
  computeCourseGrade,
  courseRisk,
  summarizeCourses,
  type CourseGrade,
  type CourseRisk,
  type GradeItemInput,
  type GradeSummary,
} from "./calc";
import { pointsFor, resolveScale, type ScaleDefinition, type UkClassLabels } from "./scales";
import {
  categoriesFor,
  findCategoryRows,
  placeRow,
  rowTypeLabels,
  type CategoryRowCandidate,
} from "./categories";

// ---------------------------------------------------------------------------
// Column names in the ten product languages (en es de fr it pt nl zh ja ar)
// ---------------------------------------------------------------------------

/** Clearly "out of" / maximum points ("Points possible", "Max", "满分"). */
const MAX_STRONG =
  /out of|max|possible|höchst|bar[eè]me|massimo|m[aá]ximo|maximaal|满分|总分|満点|العظمى|الكاملة|القصوى/i;
/** Maybe a maximum ("Total", "von", "sobre"), unless it also names a score ("Nota de examen"). */
const MAX_WEAK = /total|totaal|totale|(^|[\s(])(von|sobre|sur|su|uit|de|of)([\s)]|$)/i;
/** Numbers that are about the student's goal, not a result. */
const TARGET_NAME = /target|goal|wanted|ziel|wunsch|objetivo|meta|objectif|obiettivo|doel|目标|目標|هدف/i;
const WEIGHT_WORD =
  /weight|gewicht|peso|poids|pond[ée]ration|ponderaci[oó]n|ponderazione|pondera[cç][aã]o|weging|权重|比重|配点|割合|重み|وزن/i;
const SCORE_NAME =
  /score|grade|mark|result|points|pts|earned|nota|calificaci[oó]n|puntuaci[oó]n|puntaje|resultado|note|punkte|punktzahl|ergebnis|bewertung|r[ée]sultat|voto|punteggio|risultato|punti|pontua[cç][aã]o|pontos|cijfer|resultaat|punten|成绩|得分|分数|得点|点数|成績|スコア|درجة|علامة|نتيجة/i;
const COURSE_NAME =
  /course|class|module|subject|kurs|fach|modul|curso|asignatura|cours|mati[eè]re|corso|materia|insegnamento|disciplina|vak|cursus|课程|科目|授業|講義|مقرر|مادة|مساق/i;
const CREDITS_NAME =
  /credit|ects|(^|[\s(])(cp|lp|ec|cfu|sws|units?)([\s)]|$)|leistungspunkt|cr[ée]dit|cr[ée]dito|crediti|studiepunt|学分|単位|ساعات|معتمدة|وحدات/i;
const DUE_NAME =
  /due|deadline|date|fällig|abgabe|termin|datum|entrega|fecha|échéance|date|scadenza|data|prazo|inleverdatum|截止|日期|締切|期限|日付|موعد|تاريخ/i;
const GRADED_DB_NAME =
  /assign|assess|grade|graded|course ?work|homework|exam|deadline|aufgab|prüfung|leistung|note|tarea|entrega|examen|evaluaci|nota|devoir|évaluation|compit|esame|valutazion|voti|tarefa|prova|avalia|opdracht|toets|tentamen|cijfer|作业|考试|成绩|課題|試験|成績|課題|واجب|اختبار|درجات|تقييم/i;

/** Every column the block can use, resolved to the actual properties. */
export interface ResolvedColumns {
  course?: DatabaseProperty;
  score?: DatabaseProperty;
  maxScore?: DatabaseProperty;
  weight?: DatabaseProperty;
  due?: DatabaseProperty;
}

export type GradeColumnKey = keyof ResolvedColumns;

export const GRADE_COLUMN_KEYS: readonly GradeColumnKey[] = ["course", "score", "maxScore", "weight", "due"];

/** Property types each column may have. */
export const GRADE_COLUMN_TYPES: Record<GradeColumnKey, readonly DatabaseProperty["type"][]> = {
  course: ["select", "multi_select", "relation", "text"],
  score: ["number"],
  maxScore: ["number"],
  weight: ["number"],
  due: ["date"],
};

/** Whether `prop` may serve as column `key` of `db` (the title is never a course). */
export function columnFits(db: Database, key: GradeColumnKey, prop: DatabaseProperty): boolean {
  if (!GRADE_COLUMN_TYPES[key].includes(prop.type)) return false;
  if (key === "course" && prop.type === "text" && prop.id === titleProperty(db)?.id) return false;
  return true;
}

/** Guess every column from names and types. */
export function detectGradeColumns(db: Database): ResolvedColumns {
  const numbers = db.properties.filter((p) => p.type === "number");
  const taken = new Set<string>();
  const pick = (candidates: DatabaseProperty[]) => {
    const found = candidates.find((p) => !taken.has(p.id));
    if (found) taken.add(found.id);
    return found;
  };

  const other = (p: DatabaseProperty) => CREDITS_NAME.test(p.name) || TARGET_NAME.test(p.name);
  const weight =
    pick(numbers.filter((p) => WEIGHT_WORD.test(p.name))) ??
    pick(numbers.filter((p) => p.name.includes("%") && !SCORE_NAME.test(p.name) && !other(p)));
  const maxScore =
    pick(numbers.filter((p) => MAX_STRONG.test(p.name) && !other(p))) ??
    pick(numbers.filter((p) => MAX_WEAK.test(p.name) && !SCORE_NAME.test(p.name) && !other(p)));
  const score = pick(numbers.filter((p) => SCORE_NAME.test(p.name) && !other(p)));

  const title = titleProperty(db);
  const courseCandidates = db.properties.filter(
    (p) => columnFits(db, "course", p) && p.id !== title?.id,
  );
  const course =
    courseCandidates.find((p) => p.type === "relation" && COURSE_NAME.test(p.name)) ??
    courseCandidates.find((p) => COURSE_NAME.test(p.name));

  const dates = db.properties.filter((p) => p.type === "date");
  const due = dates.find((p) => DUE_NAME.test(p.name)) ?? dates[0];

  return { course, score, maxScore, weight, due };
}

/**
 * The columns the block actually uses: what the student or agent set (when it
 * still exists and fits), `null` = deliberately none, anything else detected.
 */
export function resolveGradeColumns(db: Database, configured: GradesColumns | undefined): ResolvedColumns {
  const detected = detectGradeColumns(db);
  const out: ResolvedColumns = {};
  const used = new Set<string>();
  // Explicit choices first, so detection never steals a column the student picked.
  for (const key of GRADE_COLUMN_KEYS) {
    const id = configured?.[key];
    if (typeof id !== "string") continue;
    const prop = db.properties.find((p) => p.id === id);
    if (prop && columnFits(db, key, prop) && !used.has(prop.id)) {
      out[key] = prop;
      used.add(prop.id);
    }
  }
  for (const key of GRADE_COLUMN_KEYS) {
    if (out[key] || configured?.[key] === null) continue;
    const prop = detected[key];
    if (prop && !used.has(prop.id)) {
      out[key] = prop;
      used.add(prop.id);
    }
  }
  return out;
}

/** Resolved columns written back as ids (what setup saves). */
export function columnsToIds(columns: ResolvedColumns): GradesColumns {
  const out: GradesColumns = {};
  for (const key of GRADE_COLUMN_KEYS) out[key] = columns[key]?.id ?? null;
  return out;
}

/** How well a database looks like a list of graded work (0 = not at all). */
export function gradeDatabaseScore(db: Database): number {
  const cols = detectGradeColumns(db);
  if (!cols.score && !cols.weight) return 0;
  return (
    (cols.score ? 3 : 0) +
    (cols.weight ? 2 : 0) +
    (cols.course ? 1 : 0) +
    (cols.due ? 0.5 : 0) +
    (GRADED_DB_NAME.test(`${db.name} ${db.description ?? ""}`) ? 1 : 0)
  );
}

/** The workspace database that best looks like graded work, if any. */
export function findGradeDatabase(workspace: Workspace): Database | undefined {
  let best: { db: Database; score: number } | undefined;
  for (const db of workspace.databases) {
    const score = gradeDatabaseScore(db);
    if (score > 0 && (!best || score > best.score)) best = { db, score };
  }
  return best?.db;
}

// ---------------------------------------------------------------------------
// Courses
// ---------------------------------------------------------------------------

export interface GradeCourse {
  /** Stable key for targets: option id, related row id, course name, "" = none. */
  key: string;
  /** Empty for the "no course" group (the UI names it). */
  label: string;
  color?: string;
  credits: number | null;
  items: GradeItemInput[];
  /** The course's grading categories (from the database's grading scheme). */
  categories: GradeCategory[];
}

/** Key used when the database has no course column at all. */
export const ALL_COURSES_KEY = "*";

function compact(value: string): string {
  return value.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
}

function num(value: CellValue | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function rowTitleText(db: Database, row: DatabaseRow): string {
  const title = titleProperty(db);
  const value = title ? row.cells[title.id] : null;
  return typeof value === "string" ? value.trim() : value == null ? "" : String(value);
}

/** The course key of a row (see GradeCategory.course): "" = no course. */
export function rowCourseKey(workspace: Workspace, db: Database, columns: ResolvedColumns, row: DatabaseRow): string {
  if (!columns.course) return ALL_COURSES_KEY;
  return rowCourse(workspace, columns.course, row)?.key ?? "";
}

/** The course key a course name or code maps to in this list (for imports and the agent). */
export function courseKeyForLabel(workspace: Workspace, db: Database, columns: ResolvedColumns, label: string): string | null {
  const course = columns.course;
  if (!course) return ALL_COURSES_KEY;
  const want = compact(label);
  if (!want) return null;
  if (course.type === "text") return `text:${want}`;
  const code = label.match(/[A-Za-z]{2,5}[ -]?\d{2,4}[A-Za-z]?/)?.[0];
  const wantCode = code ? compact(code) : "";
  const fits = (have: string) =>
    have === want || (wantCode !== "" && have.includes(wantCode)) || (have.length >= 4 && want.includes(have));
  if (course.type === "relation") {
    const related = workspace.databases.find((d) => d.id === course.relationDatabaseId);
    const row = related?.rows.find((r) => fits(compact(rowTitleText(related, r))));
    return row?.id ?? null;
  }
  return course.options?.find((o) => fits(compact(o.label)))?.id ?? null;
}

/** The course a row belongs to, as {key, label, color}, or null (no course). */
function rowCourse(
  workspace: Workspace,
  prop: DatabaseProperty,
  row: DatabaseRow,
): { key: string; label: string; color?: string } | null {
  const value = row.cells[prop.id];
  if (prop.type === "text") {
    const text = typeof value === "string" ? value.trim() : "";
    return text ? { key: `text:${compact(text)}`, label: text } : null;
  }
  const id = typeof value === "string" ? value : Array.isArray(value) ? value[0] : undefined;
  if (!id) return null;
  if (prop.type === "relation") {
    const related = workspace.databases.find((d) => d.id === prop.relationDatabaseId);
    const target = related ? findRow(related, id) : undefined;
    if (!related || !target) return null;
    return { key: id, label: rowTitleText(related, target) };
  }
  const option = prop.options?.find((o) => o.id === id);
  return option ? { key: id, label: option.label, color: option.color } : null;
}

/** Credits per course key, from a courses database when the workspace has one. */
export function courseCredits(
  workspace: Workspace,
  db: Database,
  courseProp: DatabaseProperty | undefined,
  courses: readonly { key: string; label: string }[],
): Map<string, number> {
  const out = new Map<string, number>();
  if (!courseProp) return out;
  const creditsOf = (d: Database) =>
    d.properties.find((p) => p.type === "number" && CREDITS_NAME.test(p.name));

  if (courseProp.type === "relation") {
    const related = workspace.databases.find((d) => d.id === courseProp.relationDatabaseId);
    const credits = related && creditsOf(related);
    if (!related || !credits) return out;
    for (const row of related.rows) {
      const n = num(row.cells[credits.id]);
      if (n !== null) out.set(row.id, n);
    }
    return out;
  }

  // Select or text: match course names/codes against a courses table.
  for (const other of workspace.databases) {
    if (other.id === db.id) continue;
    const credits = creditsOf(other);
    if (!credits) continue;
    const texts = other.properties.filter((p) => p.type === "text");
    for (const course of courses) {
      if (out.has(course.key)) continue;
      const want = compact(course.label);
      if (want.length < 2) continue;
      const row =
        other.rows.find((r) => texts.some((p) => compact(String(r.cells[p.id] ?? "")) === want)) ??
        other.rows.find((r) =>
          texts.some((p) => {
            const have = compact(String(r.cells[p.id] ?? ""));
            return have.length >= 3 && want.length >= 3 && (have.includes(want) || want.includes(have));
          }),
        );
      const n = row ? num(row.cells[credits.id]) : null;
      if (n !== null) out.set(course.key, n);
    }
  }
  return out;
}

/** Rows grouped by course, in the course column's own order. */
export function gradeCourses(workspace: Workspace, db: Database, columns: ResolvedColumns): GradeCourse[] {
  const groups = new Map<string, GradeCourse>();
  const completion = completionField(db);
  const course = columns.course;

  // Course order: the select's options, the related table's rows, else first seen.
  if (course?.type === "select" || course?.type === "multi_select") {
    for (const o of course.options ?? []) {
      groups.set(o.id, { key: o.id, label: o.label, color: o.color, credits: null, items: [], categories: [] });
    }
  }

  for (const row of db.rows) {
    const found = course ? rowCourse(workspace, course, row) : { key: ALL_COURSES_KEY, label: db.name };
    const key = found?.key ?? "";
    let group = groups.get(key);
    if (!group) {
      group = { key, label: found?.label ?? "", color: found?.color, credits: null, items: [], categories: [] };
      groups.set(key, group);
    }
    const name = rowTitleText(db, row);
    const weight = columns.weight ? num(row.cells[columns.weight.id]) : null;
    const item: GradeItemInput = {
      id: row.id,
      name,
      weight,
      score: columns.score ? num(row.cells[columns.score.id]) : null,
      maxScore: columns.maxScore ? num(row.cells[columns.maxScore.id]) : null,
      due: columns.due ? (typeof row.cells[columns.due.id] === "string" ? (row.cells[columns.due.id] as string) : null) : null,
      done: isRowComplete(db, row, completion),
    };
    const categories = categoriesFor(db.grading, key);
    if (categories.length > 0) {
      const place = placeRow(db.grading, categories, {
        id: row.id,
        title: name,
        typeLabels: rowTypeLabels(db, row, course),
        weight,
      });
      if (place.kind === "category") item.category = place.categoryId;
      else if (place.kind === "excluded") item.excluded = true;
    }
    group.items.push(item);
  }

  for (const g of groups.values()) g.categories = categoriesFor(db.grading, g.key);
  // "No course" goes last; empty course options are dropped (unless they have categories).
  const list = [...groups.values()].filter((g) => g.items.length > 0 || g.categories.length > 0);
  list.sort((a, b) => (a.key === "" ? 1 : 0) - (b.key === "" ? 1 : 0));
  const credits = courseCredits(workspace, db, course, list.filter((g) => g.key !== ""));
  for (const g of list) g.credits = credits.get(g.key) ?? null;
  return list;
}

// ---------------------------------------------------------------------------
// The whole report
// ---------------------------------------------------------------------------

export interface CourseReport extends GradeCourse {
  target: number | null;
  grade: CourseGrade;
  risk: CourseRisk;
}

export interface GradeReport {
  database: Database;
  columns: ResolvedColumns;
  scale: ScaleDefinition;
  courses: CourseReport[];
  summary: GradeSummary;
  /** Old-style category rows that could become grading categories (the clean-up offer). */
  categoryRows: CategoryRowCandidate[];
}

export interface ReportOptions {
  /** Hypothetical percentages by row id (what-if; never saved). */
  whatIf?: Readonly<Record<string, number>>;
  /** What-if: one percentage for everything not scored yet in a course, by course key. */
  whatIfFill?: Readonly<Record<string, number>>;
  ukLabels?: UkClassLabels;
}

/** Old-style category rows in a database (see findCategoryRows), with the block's columns. */
export function categoryRowsOf(workspace: Workspace, db: Database, columns: ResolvedColumns): CategoryRowCandidate[] {
  return findCategoryRows(db, columns, (row) => rowCourseKey(workspace, db, columns, row));
}

/** The database a block reads: its own, or the best guess when it has none. */
export function gradeDatabaseFor(workspace: Workspace, block: Pick<GradesBlock, "databaseId">): Database | undefined {
  if (block.databaseId) return workspace.databases.find((d) => d.id === block.databaseId);
  return findGradeDatabase(workspace);
}

/** Target for a course: its own, else the block's default, else none. */
export function targetFor(block: Pick<GradesBlock, "targets" | "defaultTarget">, key: string): number | null {
  const own = block.targets?.[key];
  if (typeof own === "number" && Number.isFinite(own)) return own;
  return typeof block.defaultTarget === "number" && Number.isFinite(block.defaultTarget) ? block.defaultTarget : null;
}

/**
 * Everything the grades block shows, computed from the live database. Null
 * when the block's database does not exist (anymore).
 */
export function buildGradeReport(
  workspace: Workspace,
  block: Omit<GradesBlock, "id" | "type">,
  options: ReportOptions = {},
): GradeReport | null {
  const database = gradeDatabaseFor(workspace, block);
  if (!database) return null;
  const columns = resolveGradeColumns(database, block.columns);
  const scale = resolveScale(block.scale, block.bands, options.ukLabels);
  const courses: CourseReport[] = gradeCourses(workspace, database, columns).map((c) => {
    const target = targetFor(block, c.key);
    const fill = options.whatIfFill?.[c.key];
    const grade = computeCourseGrade(c.items, {
      target,
      whatIf: options.whatIf,
      categories: c.categories,
      ...(typeof fill === "number" && Number.isFinite(fill) ? { fill } : {}),
    });
    return { ...c, target, grade, risk: courseRisk(grade) };
  });
  const summary = summarizeCourses(
    courses
      .filter((c) => c.key !== "")
      .map((c) => ({
        key: c.key,
        percent: c.grade.current,
        points: c.grade.current === null ? null : pointsFor(c.grade.current, scale),
        credits: c.credits,
      })),
  );
  return { database, columns, scale, courses, summary, categoryRows: categoryRowsOf(workspace, database, columns) };
}
