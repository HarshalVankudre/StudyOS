/**
 * Grading categories: parts of a course grade shared by many items
 * ("Problem sets 20%", "Weekly homework 30%, lowest two dropped"). They live
 * in the graded-work database's grading scheme (`Database.grading`), never as
 * rows, so boards, calendars, the daily plan and exports only ever show real
 * work.
 *
 * This module decides which category a row counts in (by its type and title,
 * in any of the ten languages, unless the student placed it by hand), finds
 * old-style category rows (a weighted, undated row standing for a group of
 * items) and turns them into categories. Pure: no React.
 */
import type {
  CellValue,
  Database,
  DatabaseProperty,
  DatabaseRow,
  GradeCategory,
  GradingScheme,
} from "@/lib/workspace/types";
import { titleProperty } from "@/lib/workspace/helpers";
import { assessmentKey, looksLikeCategoryName, matchAssessments, nameStems } from "@/lib/import/assessment-match";

/** Rows of a type like "Grade group" or "Category" stand for a group of items. */
const GROUP_TYPE =
  /group|categor|gruppe|grupo|groupe|gruppo|groep|component|komponente|componente|composante|bereich|rubri|类别|分类|類別|カテゴリ|区分|فئة|مجموعة/i;

const SITTINGS = new Set(["exam", "midterm", "final"]);

export interface CategoryLike {
  id: string;
  name: string;
}

function kindsMatch(category: Set<string>, item: Set<string>): "yes" | "no" | "unknown" {
  if (category.size === 0 || item.size === 0) return "unknown";
  for (const kind of category) if (item.has(kind)) return "yes";
  // A generic "Exams" category takes midterms and finals.
  if (category.size === 1 && category.has("exam") && [...item].every((k) => SITTINGS.has(k))) return "yes";
  return "no";
}

/**
 * The category (of one course) an item counts in, judged by its title and
 * type labels: the one sharing the most name words and kinds. Null when no
 * category fits, or two fit equally well (then the student decides).
 */
export function matchCategory(
  title: string,
  typeLabels: readonly string[],
  categories: readonly CategoryLike[],
): string | null {
  if (categories.length === 0) return null;
  const read = (t: string) => ({ kinds: assessmentKey(t).kinds, stems: new Set(nameStems(t)) });
  const titleKey = title.trim() ? read(title) : null;
  const typeKeys = typeLabels.filter((t) => t.trim() && !GROUP_TYPE.test(t)).map(read);
  if (!titleKey && typeKeys.length === 0) return null;
  let best: { id: string; score: number } | null = null;
  let tie = false;
  for (const category of categories) {
    const kinds = assessmentKey(category.name).kinds;
    const stems = nameStems(category.name);
    // The title names another kind of work ("Quiz 3" against "Problem sets"): never.
    if (titleKey && kindsMatch(kinds, titleKey.kinds) === "no") continue;
    let score = 0;
    for (const key of [...(titleKey ? [titleKey] : []), ...typeKeys]) {
      const kind = kindsMatch(kinds, key.kinds);
      if (kind === "no") continue;
      score += (kind === "yes" ? 1 : 0) + 2 * stems.filter((s) => key.stems.has(s)).length;
    }
    if (score <= 0) continue;
    if (!best || score > best.score) {
      best = { id: category.id, score };
      tie = false;
    } else if (score === best.score) {
      tie = true;
    }
  }
  return best && !tie ? best.id : null;
}

// ---------------------------------------------------------------------------
// Reading rows

function compact(value: string): string {
  return value.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
}

export function cellText(value: CellValue | undefined): string {
  return typeof value === "string" ? value.trim() : typeof value === "number" ? String(value) : "";
}

/** Labels of the row's select columns other than the course and the status ("Problem set", "Exam"). */
export function rowTypeLabels(db: Database, row: DatabaseRow, courseProp?: DatabaseProperty): string[] {
  const out: string[] = [];
  for (const prop of db.properties) {
    if ((prop.type !== "select" && prop.type !== "multi_select") || prop.id === courseProp?.id) continue;
    const value = row.cells[prop.id];
    const ids = Array.isArray(value) ? value : typeof value === "string" ? [value] : [];
    for (const id of ids) {
      const label = prop.options?.find((o) => o.id === id)?.label;
      if (label) out.push(label);
    }
  }
  return out;
}

/** The categories of one course in a scheme. */
export function categoriesFor(scheme: GradingScheme | undefined, courseKey: string): GradeCategory[] {
  return (scheme?.categories ?? []).filter((c) => c.course === courseKey);
}

export type Placement =
  | { kind: "category"; categoryId: string; byHand: boolean }
  | { kind: "single" }
  | { kind: "excluded" }
  | { kind: "uncategorized" };

/**
 * Where a row counts when its course has categories: placed by hand, on its
 * own weight, in the category its type or title names, or nowhere yet.
 */
export function placeRow(
  scheme: GradingScheme | undefined,
  categories: readonly GradeCategory[],
  row: { id: string; title: string; typeLabels: readonly string[]; weight: number | null },
): Placement {
  const hand = scheme?.assign?.[row.id];
  if (hand === "") return { kind: "excluded" };
  if (hand && categories.some((c) => c.id === hand)) return { kind: "category", categoryId: hand, byHand: true };
  if (row.weight !== null) return row.weight > 0 ? { kind: "single" } : { kind: "excluded" };
  const matched = matchCategory(row.title, row.typeLabels, categories);
  return matched ? { kind: "category", categoryId: matched, byHand: false } : { kind: "uncategorized" };
}

// ---------------------------------------------------------------------------
// Old-style category rows

export interface CategoryRowCandidate {
  rowId: string;
  name: string;
  /** Course key (see GradeCategory.course). */
  course: string;
  weight: number;
  /** A score typed on the row (it cannot carry over: scores belong on the items). */
  score: number | null;
}

export interface CategoryRowColumns {
  course?: DatabaseProperty;
  weight?: DatabaseProperty;
  score?: DatabaseProperty;
  due?: DatabaseProperty;
}

/**
 * Weighted rows that stand for a group of items rather than one piece of
 * work: no date, and either typed like a group ("Grade group"), named like
 * one ("Problem sets", "Weekly homework", "Quizzes"), or, without a score,
 * the category of numbered items in the same course ("Problem Set 4" under
 * "Problem sets"). A score typed on such a row (the only place it could go)
 * is reported, not a reason to keep the row. Rows the student chose to keep
 * are left alone.
 */
export function findCategoryRows(
  db: Database,
  columns: CategoryRowColumns,
  courseKeyOf: (row: DatabaseRow) => string,
): CategoryRowCandidate[] {
  const weightProp = columns.weight;
  if (!weightProp) return [];
  const title = titleProperty(db);
  const kept = new Set(db.grading?.keptRows ?? []);
  const assigned = db.grading?.assign ?? {};
  const num = (v: CellValue | undefined) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const info = db.rows.map((row) => ({
    row,
    title: title ? cellText(row.cells[title.id]) : "",
    weight: num(row.cells[weightProp.id]),
    score: columns.score ? num(row.cells[columns.score.id]) : null,
    due: columns.due ? cellText(row.cells[columns.due.id]) : "",
    course: courseKeyOf(row),
    types: rowTypeLabels(db, row, columns.course),
  }));
  const out: CategoryRowCandidate[] = [];
  for (const item of info) {
    if (item.weight === null || item.weight <= 0 || item.due || !item.title) continue;
    if (kept.has(item.row.id) || item.row.id in assigned) continue;
    const grouped = item.types.some((t) => GROUP_TYPE.test(t));
    const named = looksLikeCategoryName(item.title);
    const parent =
      item.score === null &&
      !grouped &&
      !named &&
      info.some(
        (other) =>
          other !== item &&
          other.course === item.course &&
          other.weight === null &&
          assessmentKey(other.title).numbers.length > 0 &&
          matchCategory(other.title, other.types, [{ id: item.row.id, name: item.title }]) === item.row.id,
      );
    if (grouped || named || parent) {
      out.push({ rowId: item.row.id, name: item.title, course: item.course, weight: item.weight, score: item.score });
    }
  }
  return out;
}

function uniqueId(prefix: string, taken: Set<string>): string {
  if (!taken.has(prefix)) return prefix;
  let n = 2;
  while (taken.has(`${prefix}-${n}`)) n += 1;
  return `${prefix}-${n}`;
}

export interface CategoryDraft {
  course: string;
  name: string;
  weight: number;
  dropLowest?: number;
  expectedCount?: number;
}

/**
 * Add a category to the database's scheme, or update the one of the same
 * course with the same name (its weight, drops and count when given).
 * Mutates `db`; returns the category id.
 */
export function upsertCategory(db: Database, draft: CategoryDraft, newId?: () => string): string {
  db.grading ??= { categories: [] };
  const existing = db.grading.categories.find(
    (c) => c.course === draft.course && compact(c.name) === compact(draft.name),
  );
  if (existing) {
    existing.weight = draft.weight;
    if (draft.dropLowest !== undefined) existing.dropLowest = draft.dropLowest;
    if (draft.expectedCount !== undefined) existing.expectedCount = draft.expectedCount;
    return existing.id;
  }
  const taken = new Set(db.grading.categories.map((c) => c.id));
  const base = `cat-${compact(draft.name).slice(0, 24) || "group"}`;
  const id = newId ? newId() : uniqueId(base, taken);
  db.grading.categories.push({
    id,
    course: draft.course,
    name: draft.name.trim().slice(0, 200),
    weight: draft.weight,
    ...(draft.dropLowest ? { dropLowest: draft.dropLowest } : {}),
    ...(draft.expectedCount ? { expectedCount: draft.expectedCount } : {}),
  });
  return id;
}

/**
 * Turn category rows into categories of the database's grading scheme and
 * remove the rows. Mutates `db` (call it on a draft); returns how many rows
 * were converted.
 */
export function convertCategoryRows(
  db: Database,
  candidates: readonly CategoryRowCandidate[],
  newId?: () => string,
): number {
  const ids = new Set(candidates.map((c) => c.rowId));
  const present = candidates.filter((c) => db.rows.some((r) => r.id === c.rowId));
  if (present.length === 0) return 0;
  for (const c of present) upsertCategory(db, { course: c.course, name: c.name, weight: c.weight }, newId);
  db.rows = db.rows.filter((r) => !ids.has(r.id));
  return present.length;
}

/**
 * A numbered item that carries its category's whole weight ("Problem Set 4"
 * at 20 % under "Problem sets 20%") copied it by mistake: the weight is the
 * category's, so the item's own is cleared. Mutates `db`; returns how many.
 */
export function clearCopiedCategoryWeights(
  db: Database,
  columns: CategoryRowColumns,
  courseKeyOf: (row: DatabaseRow) => string,
): number {
  const weightProp = columns.weight;
  if (!weightProp || !db.grading?.categories.length) return 0;
  const title = titleProperty(db);
  let cleared = 0;
  for (const row of db.rows) {
    const weight = row.cells[weightProp.id];
    if (typeof weight !== "number" || !title) continue;
    const name = cellText(row.cells[title.id]);
    if (assessmentKey(name).numbers.length === 0) continue;
    const categories = categoriesFor(db.grading, courseKeyOf(row));
    const matched = matchCategory(name, rowTypeLabels(db, row, columns.course), categories);
    const category = categories.find((c) => c.id === matched);
    if (category && Math.abs(category.weight - weight) < 1e-9) {
      row.cells[weightProp.id] = null;
      cleared += 1;
    }
  }
  return cleared;
}

/**
 * A "category" that is one item the list already has as a row ("Midterm 30%"
 * next to the row "Statistics midterm") would count it twice: the weight
 * belongs on the row. The category is removed, and its weight moves to the
 * row when the row has none. Mutates `db`; returns how many were removed.
 */
export function dropSingleItemCategories(
  db: Database,
  columns: CategoryRowColumns,
  courseKeyOf: (row: DatabaseRow) => string,
): number {
  if (!db.grading?.categories.length) return 0;
  const title = titleProperty(db);
  if (!title) return 0;
  const weightProp = columns.weight;
  let removed = 0;
  db.grading.categories = db.grading.categories.filter((category) => {
    if (looksLikeCategoryName(category.name)) return true;
    const kinds = assessmentKey(category.name).kinds;
    const rows = db.rows.filter((row) => {
      if (courseKeyOf(row) !== category.course) return false;
      const name = cellText(row.cells[title.id]);
      const rowKinds = assessmentKey(name).kinds;
      return name !== "" && matchAssessments(category.name, name).strength !== "different" && [...kinds].some((k) => rowKinds.has(k));
    });
    if (rows.length !== 1) return true;
    const row = rows[0];
    if (weightProp && typeof row.cells[weightProp.id] !== "number") row.cells[weightProp.id] = category.weight;
    removed += 1;
    return false;
  });
  return removed;
}

/** The student keeps these rows as they are: the clean-up is not offered for them again. */
export function keepCategoryRows(db: Database, rowIds: readonly string[]): void {
  db.grading ??= { categories: [] };
  const kept = new Set(db.grading.keptRows ?? []);
  for (const id of rowIds) kept.add(id);
  db.grading.keptRows = [...kept];
}

/** Place a row by hand ("" = counts in no category); null removes the hand placement. */
export function assignRow(db: Database, rowId: string, categoryId: string | null): void {
  db.grading ??= { categories: [] };
  const assign = { ...(db.grading.assign ?? {}) };
  if (categoryId === null) delete assign[rowId];
  else assign[rowId] = categoryId;
  if (Object.keys(assign).length > 0) db.grading.assign = assign;
  else delete db.grading.assign;
}

/** Remove a category; rows placed in it by hand go back to automatic placement. */
export function removeCategory(db: Database, categoryId: string): void {
  if (!db.grading) return;
  db.grading.categories = db.grading.categories.filter((c) => c.id !== categoryId);
  if (db.grading.assign) {
    for (const [row, id] of Object.entries(db.grading.assign)) if (id === categoryId) delete db.grading.assign[row];
    if (Object.keys(db.grading.assign).length === 0) delete db.grading.assign;
  }
}
