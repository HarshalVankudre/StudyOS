/**
 * Deterministic clean-up after a workspace is generated, so every new
 * workspace with graded work can answer "what is my grade?":
 *   - the graded-work database gets a number column for the score received
 *     (empty until the student enters one);
 *   - every grades block points at a database that exists and only at
 *     columns that exist (detection fills the rest at render time);
 *   - if the model added no grades block, one is added to a grades page
 *     when there is one, otherwise to the home page;
 *   - a row the model made for a share of the grade many items have in
 *     common ("Problem sets 20%", no date) becomes a grading category of the
 *     list, and an item that copied its category's weight loses the copy.
 * Real work is never changed or removed. Pure: returns a new workspace.
 */
import type { Block, Database, GradesBlock, GradesColumns, Page, Workspace } from "@/lib/workspace/types";
import {
  GRADE_COLUMN_KEYS,
  categoryRowsOf,
  columnFits,
  findGradeDatabase,
  resolveGradeColumns,
  rowCourseKey,
} from "./workspace";
import { clearCopiedCategoryWeights, convertCategoryRows, dropSingleItemCategories } from "./categories";

/** Category rows become categories of the scheme; items keep only their own weights. */
export function categoriesFromRows(workspace: Workspace, db: Database): void {
  const columns = resolveGradeColumns(db, undefined);
  convertCategoryRows(db, categoryRowsOf(workspace, db, columns));
  const courseOf = (row: Database["rows"][number]) => rowCourseKey(workspace, db, columns, row);
  dropSingleItemCategories(db, columns, courseOf);
  clearCopiedCategoryWeights(db, columns, courseOf);
  // A zero means none: keep the scheme tidy.
  for (const c of db.grading?.categories ?? []) if (c.dropLowest === 0) delete c.dropLowest;
}

export interface GradeTrackingLabels {
  /** Name of the added score column, e.g. "Score". */
  score: string;
  /** Heading placed above an added grades block, e.g. "🎯 Grades". */
  heading: string;
  /** Title of an added grades block, e.g. "Grades". */
  title: string;
}

// Not "note"/"nota": in French, Spanish and Portuguese that is also a notes page.
const GRADES_PAGE = /grade|gpa|noten|calificaci|cijfer|voti|valutazion|成绩|成績|درجات|علامات/i;
const GRADED_WORK_DB =
  /assign|assess|course ?work|homework|exam|aufgab|prüfung|tarea|evaluaci|devoir|évaluation|compit|esame|tarefa|prova|opdracht|toets|作业|考试|課題|試験|واجب|اختبار|تقييم/i;

function uniqueId(prefix: string, taken: Set<string>): string {
  if (!taken.has(prefix)) return prefix;
  let n = 2;
  while (taken.has(`${prefix}-${n}`)) n += 1;
  return `${prefix}-${n}`;
}

/** The database of graded work: a weight or score column, else an assignment-like name with dates. */
export function findGradedWorkDatabase(workspace: Workspace): Database | undefined {
  return (
    findGradeDatabase(workspace) ??
    workspace.databases.find(
      (db) =>
        GRADED_WORK_DB.test(`${db.name} ${db.description ?? ""}`) &&
        db.properties.some((p) => p.type === "date") &&
        db.properties.some((p) => p.type === "text"),
    )
  );
}

/** Add a number column for scores when the database has none; returns its id. */
export function ensureScoreColumn(db: Database, name: string): string {
  const existing = resolveGradeColumns(db, undefined).score;
  if (existing) return existing.id;
  const id = uniqueId("score", new Set(db.properties.map((p) => p.id)));
  const weightIndex = db.properties.findIndex(
    (p) => p.id === resolveGradeColumns(db, undefined).weight?.id,
  );
  const prop = { id, name, type: "number" as const };
  if (weightIndex >= 0) db.properties.splice(weightIndex + 1, 0, prop);
  else db.properties.push(prop);
  return id;
}

/** Keep only column ids that exist and fit; drop the rest so detection can work. */
function cleanColumns(db: Database, columns: GradesColumns | undefined): GradesColumns | undefined {
  if (!columns) return undefined;
  const out: GradesColumns = {};
  for (const key of GRADE_COLUMN_KEYS) {
    const id = columns[key];
    if (id === null) out[key] = null;
    else if (typeof id === "string") {
      const prop = db.properties.find((p) => p.id === id);
      if (prop && columnFits(db, key, prop)) out[key] = id;
    }
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function gradesBlocks(workspace: Workspace): GradesBlock[] {
  return workspace.pages.flatMap((p) => p.blocks.filter((b): b is GradesBlock => b.type === "grades"));
}

export function ensureGradeTracking(workspace: Workspace, labels: GradeTrackingLabels): Workspace {
  const next = structuredClone(workspace);
  const target = findGradedWorkDatabase(next);
  const blocks = gradesBlocks(next);
  if (!target && blocks.length === 0) return workspace;

  // Repair blocks the model wrote: a real database, real columns.
  for (const block of blocks) {
    let db = block.databaseId ? next.databases.find((d) => d.id === block.databaseId) : undefined;
    if (!db) {
      db = target;
      if (db) block.databaseId = db.id;
      else delete block.databaseId;
    }
    if (!db) {
      delete block.columns;
      continue;
    }
    const cleaned = cleanColumns(db, block.columns);
    if (cleaned) block.columns = cleaned;
    else delete block.columns;
    if (!resolveGradeColumns(db, block.columns).score && block.columns?.score !== null) {
      const id = ensureScoreColumn(db, labels.score);
      block.columns = { ...block.columns, score: id };
    }
  }
  if (!target) return next;

  const scoreId = ensureScoreColumn(target, labels.score);
  categoriesFromRows(next, target);
  if (blocks.length > 0) return next;

  // No grades block yet: add one, configured with what was detected.
  const resolved = resolveGradeColumns(target, { score: scoreId });
  const columns: GradesColumns = {};
  for (const key of GRADE_COLUMN_KEYS) {
    const prop = resolved[key];
    if (prop) columns[key] = prop.id;
  }
  const blockIds = new Set(next.pages.flatMap((p) => p.blocks.map((b) => b.id)));
  const block: GradesBlock = {
    id: uniqueId("b-grades", blockIds),
    type: "grades",
    title: labels.title,
    databaseId: target.id,
    columns,
  };
  const gradesPage = next.pages.find((p) => GRADES_PAGE.test(p.title));
  const home = next.pages.find((p) => p.id === next.homePageId) ?? next.pages[0];
  const page: Page | undefined = gradesPage ?? home;
  if (!page) return next;
  const added: Block[] = gradesPage
    ? [block]
    : [{ id: uniqueId("b-grades-heading", blockIds), type: "heading", level: 2, text: labels.heading }, block];
  // On a grades page, right after its first heading; on the home page, at the end.
  const headingAt = gradesPage ? page.blocks.findIndex((b) => b.type === "heading") : -1;
  if (headingAt >= 0) page.blocks.splice(headingAt + 1, 0, ...added);
  else page.blocks.push(...added);
  return next;
}
