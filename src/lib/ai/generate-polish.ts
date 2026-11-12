/**
 * Deterministic finishing touches on a freshly generated workspace, for the
 * things a model gets wrong often enough that the prompt alone is not a
 * guarantee:
 *
 *   - an exams-only database next to the graded-work database is merged into
 *     it when their columns line up (the grade tracker and the Today plan read
 *     one list of graded work), and the places that showed it show the exams
 *     from the merged list instead; a merged list named after one kind of
 *     work ("Problem sets") gets the neutral name for graded work;
 *   - a separate "Grade Tracker" table competing with the grades block is
 *     removed (when it holds no deadlines) and replaced by a grades block;
 *   - a page's first heading that only repeats the page title is dropped;
 *   - ISO dates in prose ("2026-12-03" in a callout or card) are written as
 *     natural dates in the student's language;
 *   - rows with an empty status start in the open state ("Not started");
 *   - the dashboard gets a "This week" list (due in the next 7 days, not
 *     done) over the deadlines database;
 *   - two dashboard sections under the same heading become one;
 *   - pages without an icon get one.
 *
 * Date cells are never changed; rows, views and blocks move only when two
 * databases or two sections are merged. Pure: returns a new workspace.
 */
import { getDictionary } from "@/lib/i18n/dictionaries";
import type { Locale } from "@/lib/i18n/config";
import { gradeDatabaseScore, detectGradeColumns } from "@/lib/grades/workspace";
import { assessmentKey, nameStems } from "@/lib/import/assessment-match";
import { titleProperty } from "@/lib/workspace/helpers";
import type {
  Block,
  CellValue,
  Database,
  DatabaseProperty,
  DatabaseRow,
  DatabaseView,
  GradesBlock,
  GradesColumns,
  Page,
  SelectOption,
  ViewFilter,
  Workspace,
} from "@/lib/workspace/types";
import { completionField, upcomingViewSettings } from "@/lib/workspace/view-logic";

export interface PolishOptions {
  /** BCP 47 locale for natural dates. */
  locale: string;
  /** The student's local date, YYYY-MM-DD (decides whether a year is shown). */
  today: string;
  labels: {
    /** Name of the added view, e.g. "This week". */
    thisWeek: string;
    /** Title of a grades block put where a grade table was, e.g. "Grades". */
    gradesTitle: string;
    /** Name of a type column added when exams are merged in (default: the locale's "Type"). */
    typeColumn?: string;
    /** Type option given to merged exams (default: the locale's "Exam"). */
    examType?: string;
    /** Neutral name for a merged list of graded work (default: the locale's "Graded work"). */
    gradedWork?: string;
  };
}

export function polishGeneratedWorkspace(workspace: Workspace, options: PolishOptions): Workspace {
  const next = structuredClone(workspace);
  const labels = examLabels(options);
  mergeExamDatabases(next, labels);
  neutralGradedWorkName(next, labels.gradedWork);
  dropCompetingGradeTables(next, options.labels.gradesTitle);
  for (const page of next.pages) stripTitleHeading(page);
  naturalDates(next, options.locale, options.today);
  for (const db of next.databases) openStatusDefaults(db);
  ensureThisWeek(next, options.labels.thisWeek);
  mergeDuplicateSections(next);
  pageIcons(next);
  return next;
}

interface MergeLabels {
  typeColumn: string;
  examType: string;
  gradedWork: string;
}

function examLabels(options: PolishOptions): MergeLabels {
  const dict = getDictionary(options.locale as Locale);
  return {
    typeColumn: options.labels.typeColumn ?? dict.mock.assignments.propType,
    examType: options.labels.examType ?? dict.mock.type.exam,
    gradedWork: options.labels.gradedWork ?? dict.ai.generate.assessments.database,
  };
}

// ---------------------------------------------------------------------------
// Ids

function uniqueId(prefix: string, taken: Set<string>): string {
  if (!taken.has(prefix)) return prefix;
  let n = 2;
  while (taken.has(`${prefix}-${n}`)) n += 1;
  return `${prefix}-${n}`;
}

function allBlockIds(workspace: Workspace): Set<string> {
  return new Set(workspace.pages.flatMap((page) => page.blocks.map((block) => block.id)));
}

// ---------------------------------------------------------------------------
// The deadlines / graded-work database

const DEADLINE_DB =
  /assign|assess|deadline|course ?work|homework|exam|task|due|work|aufgab|abgabe|übung|ubung|prüfung|klausur|tarea|entrega|examen|evaluaci|devoir|évaluation|evaluation|partiel|compit|esame|scadenz|consegn|tarefa|prova|avalia|opdracht|toets|tentamen|deadline|作业|考试|任务|課題|試験|締切|提出|واجب|اختبار|مهام|تسليم/i;

/** Number of rows with a date value. */
function datedRows(db: Database): number {
  const dates = db.properties.filter((p) => p.type === "date").map((p) => p.id);
  return db.rows.filter((row) => dates.some((id) => typeof row.cells[id] === "string" && row.cells[id])).length;
}

/**
 * The database the student's deadlines live in: has a date column and a way
 * to mark rows done, named like coursework; most dated rows wins.
 */
export function findDeadlineDatabase(workspace: Workspace): Database | undefined {
  let best: { db: Database; score: number } | undefined;
  for (const db of workspace.databases) {
    if (!db.properties.some((p) => p.type === "date")) continue;
    if (!completionField(db)) continue;
    const named = DEADLINE_DB.test(`${db.name} ${db.description ?? ""}`);
    const hasWeight = db.properties.some((p) => p.type === "number" && /weight|%|gewicht|peso|poids|weging|权重|配点|وزن/i.test(p.name));
    const score = (named ? 1000 : 0) + (hasWeight ? 500 : 0) + datedRows(db);
    if (!best || score > best.score) best = { db, score };
  }
  return best?.db;
}

// ---------------------------------------------------------------------------
// Exams in their own database

/** Named like exams ("Klausuren", "Exams", "試験") ... */
const EXAM_DB =
  /exam|midterm|final|test|quiz|klausur|prüfung|pruefung|parcial|prueba|partiel|épreuve|epreuve|esame|verific|prova|tentamen|toets|考试|考試|测验|期中|期末|試験|テスト|امتحان|اختبار/i;
/** ... and not like other graded work, a mix ("Entregas y exámenes") or exam preparation. */
const NOT_ONLY_EXAMS =
  /assign|assess|homework|course ?work|graded|work|task|project|paper|essay|lab|deadline|übung|ubung|aufgab|abgabe|hausarbeit|leistung|tarea|entrega|trabajo|práctica|practica|devoir|fiche|projet|compit|consegn|progett|tarefa|trabalho|opdracht|huiswerk|作业|任务|課題|宿題|レポート|واجب|مهام|تكليف|prep|vorbereit|preparaci|prépar|prepar|voorbereid|准备|準備|対策|تحضير/i;
/** A type option meaning an exam (not a quiz or a test, which also count as exam-like names). */
const EXAM_OPTION =
  /exam|midterm|final|klausur|prüfung|parcial|partiel|épreuve|esame|prova|tentamen|考试|考試|期中|期末|試験|امتحان/i;
const TYPE_COLUMN =
  /type|kind|categor|tipo|(?<![\p{L}])(typ|art|soort)(?![\p{L}])|catégorie|类型|類型|種類|タイプ|النوع/iu;

const OPTION_TYPES = new Set<DatabaseProperty["type"]>(["select", "multi_select", "status"]);

function optionKey(label: string): string {
  return label.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
}

function isEmptyCell(value: CellValue | undefined): boolean {
  return value === undefined || value === null || value === "" || (Array.isArray(value) && value.length === 0);
}

/** The first column, when it is the text title (the generator's convention). */
function leadingTitle(db: Database): DatabaseProperty | undefined {
  const first = db.properties[0];
  return first?.type === "text" ? first : undefined;
}

function isExamsOnly(db: Database): boolean {
  return (
    EXAM_DB.test(db.name) &&
    !NOT_ONLY_EXAMS.test(db.name) &&
    !PLANNING_DB.test(db.name) &&
    db.properties.some((p) => p.type === "date") &&
    leadingTitle(db) !== undefined
  );
}

/**
 * Where graded work lives, as the grade tracker finds it (score and weight
 * columns first), else as the deadline lists do: a dated list of work with a
 * done state. Never an exams-only or planning database.
 */
function gradedWorkTarget(workspace: Workspace): Database | undefined {
  const candidates = workspace.databases.filter(
    (db) =>
      !isExamsOnly(db) &&
      !PLANNING_DB.test(`${db.name}`) &&
      leadingTitle(db) !== undefined &&
      db.properties.some((p) => p.type === "date") &&
      completionField(db) !== null,
  );
  let best: { db: Database; score: number } | undefined;
  for (const db of candidates) {
    const score = gradeDatabaseScore(db);
    if (score > 0 && (!best || score > best.score)) best = { db, score };
  }
  return (
    best?.db ??
    findDeadlineDatabase({
      ...workspace,
      databases: candidates.filter((db) => DEADLINE_DB.test(`${db.name} ${db.description ?? ""}`)),
    })
  );
}

function percentNamed(prop: DatabaseProperty): boolean {
  return prop.name.includes("%");
}

/**
 * Which target column each exam column becomes, or null when some exam column
 * has no counterpart (then the two stay separate: nothing the model planned is
 * dropped). Columns pair up by role (title, done state, due date, course,
 * weight, score, type), else by name; each target column takes one exam column.
 */
function mapExamColumns(exams: Database, target: Database): Map<string, DatabaseProperty> | null {
  const map = new Map<string, DatabaseProperty>();
  const used = new Set<string>();
  const pair = (from: DatabaseProperty | undefined, to: DatabaseProperty | undefined) => {
    if (!from || !to || map.has(from.id) || used.has(to.id)) return;
    map.set(from.id, to);
    used.add(to.id);
  };
  const sameKind = (a: DatabaseProperty, b: DatabaseProperty) =>
    a.type === b.type || (OPTION_TYPES.has(a.type) && OPTION_TYPES.has(b.type) && a.type !== "multi_select" && b.type !== "multi_select");

  pair(leadingTitle(exams), leadingTitle(target));
  const examDone = completionField(exams)?.property;
  const targetDone = completionField(target)?.property;
  if (examDone && targetDone && sameKind(examDone, targetDone)) pair(examDone, targetDone);

  const examCols = detectGradeColumns(exams);
  const targetCols = detectGradeColumns(target);
  pair(examCols.due, targetCols.due);
  const course = (a?: DatabaseProperty, b?: DatabaseProperty) =>
    a && b && a.type === b.type && (a.type !== "relation" || a.relationDatabaseId === b.relationDatabaseId);
  if (course(examCols.course, targetCols.course)) pair(examCols.course, targetCols.course);
  for (const key of ["weight", "score", "maxScore"] as const) {
    const a = examCols[key];
    const b = targetCols[key];
    // "Coefficient" is not "Weight %": a weight only pairs with one in the same unit.
    if (a && b && percentNamed(a) === percentNamed(b)) pair(a, b);
  }
  const examType = typeColumnOf(exams);
  const targetType = typeColumnOf(target);
  if (examType && targetType && examType.type === targetType.type) pair(examType, targetType);

  for (const prop of exams.properties) {
    if (map.has(prop.id)) continue;
    const named = target.properties.find(
      (p) =>
        !used.has(p.id) &&
        optionKey(p.name) === optionKey(prop.name) &&
        p.type === prop.type &&
        (p.type !== "relation" || p.relationDatabaseId === prop.relationDatabaseId),
    );
    if (!named) return null;
    pair(prop, named);
  }
  return map;
}

function typeColumnOf(db: Database): DatabaseProperty | undefined {
  return db.properties.find((p) => (p.type === "select" || p.type === "multi_select") && TYPE_COLUMN.test(p.name));
}

/** A type column for a target that has none (not yet added to it). */
function newTypeColumn(target: Database, exams: Database, name: string): DatabaseProperty {
  return {
    id: uniqueId("type", new Set(target.properties.map((p) => p.id))),
    name,
    // An exams database's own type column ("Midterm", "Final") carries over as is.
    type: typeColumnOf(exams)?.type ?? "select",
    options: [],
  };
}

/** Exam option id -> target option id; options the target lacks are added to it. */
function mapOptions(
  from: DatabaseProperty,
  to: DatabaseProperty,
  fromDb: Database,
  toDb: Database,
): Map<string, string> {
  const out = new Map<string, string>();
  to.options ??= [];
  const fromDone = completionField(fromDb);
  const toDone = completionField(toDb);
  const doneState = fromDone?.property.id === from.id && toDone?.property.id === to.id ? { fromDone, toDone } : null;
  for (const option of from.options ?? []) {
    const same = to.options.find((o) => optionKey(o.label) === optionKey(option.label));
    if (same) {
      out.set(option.id, same.id);
      continue;
    }
    if (doneState) {
      // A done state maps onto the target's states, never adds a fourth column to its board.
      const { fromDone: f, toDone: t } = doneState;
      const toOptions = to.options;
      const middle = toOptions.find((o) => !t.doneValues.includes(o.id) && o.id !== t.openValue);
      const value = f.doneValues.includes(option.id)
        ? t.doneValue
        : option.id === f.openValue
          ? t.openValue
          : (middle?.id ?? t.openValue);
      if (typeof value === "string") out.set(option.id, value);
      continue;
    }
    const id = uniqueId(option.id, new Set(to.options.map((o) => o.id)));
    const added: SelectOption = { id, label: option.label, ...(option.color ? { color: option.color } : {}) };
    to.options.push(added);
    out.set(option.id, id);
  }
  return out;
}

function convertCell(
  value: CellValue | undefined,
  from: DatabaseProperty,
  to: DatabaseProperty,
  options: Map<string, string> | undefined,
): CellValue {
  if (value === undefined) return null;
  if (from.type === "checkbox" || to.type === "checkbox") return from.type === to.type ? value : null;
  if (!options) return value;
  const one = (id: string) => options.get(id) ?? null;
  if (Array.isArray(value)) {
    const ids = value.map(one).filter((id): id is string => id !== null);
    return to.type === "multi_select" ? ids : (ids[0] ?? null);
  }
  if (typeof value !== "string") return null;
  const id = one(value);
  return to.type === "multi_select" ? (id ? [id] : []) : id;
}

/**
 * Generated workspaces sometimes keep exams in a database of their own next to
 * the graded work. The grade calculator and the Today plan read one list of
 * graded work, so an exam there is missing from both its course grade and the
 * student's countdown. When every exam column has a counterpart, the exams move
 * into the graded-work database as rows typed "Exam", and every place that
 * showed the exams database shows the same views over the merged list,
 * filtered to the exams. Otherwise the two stay as the model made them.
 */
function mergeExamDatabases(workspace: Workspace, labels: MergeLabels) {
  for (;;) {
    const target = gradedWorkTarget(workspace);
    if (!target) return;
    const exams = workspace.databases.find((db) => db.id !== target.id && isExamsOnly(db) && mergeable(db, target, labels.typeColumn));
    if (!exams) return;
    mergeInto(workspace, exams, target, labels);
  }
}

function linked(a: Database, b: Database): boolean {
  return (
    a.properties.some((p) => p.type === "relation" && p.relationDatabaseId === b.id) ||
    b.properties.some((p) => p.type === "relation" && p.relationDatabaseId === a.id)
  );
}

function mergeable(exams: Database, target: Database, typeName: string): boolean {
  if (linked(exams, target)) return false;
  const withType = typeColumnOf(target)
    ? target
    : { ...target, properties: [...target.properties, newTypeColumn(target, exams, typeName)] };
  return mapExamColumns(exams, withType) !== null;
}

/** Names that already fit a list of all graded work ("Assignments", "Coursework", "Bewertete Leistungen"). */
const NEUTRAL_WORK_NAME =
  /assign|assess|graded|course ?work|deadline|leistung|evaluaci|[ée]valuation|valutazion|avalia|beoordeel|toetsing|work|trabaj|travaux|prove|计分|成绩|評価|تقييم|الأعمال/i;

/** A list named after one kind of work ("Problem sets", "Übungsblätter", "Hausaufgaben"). */
function namedAfterOneKind(name: string): boolean {
  if (NEUTRAL_WORK_NAME.test(name)) return false;
  const kinds = assessmentKey(name).kinds;
  return kinds.size > 0 && ![...kinds].some((k) => k === "exam" || k === "midterm" || k === "final");
}

/**
 * The one list of graded work, named after one kind of it ("Problem Sets &
 * Labs") while it also holds the exams, gets the neutral name.
 */
function neutralGradedWorkName(workspace: Workspace, name: string) {
  const target = gradedWorkTarget(workspace);
  if (!target || !namedAfterOneKind(target.name)) return;
  const title = leadingTitle(target);
  const type = typeColumnOf(target);
  const holdsExams = target.rows.some((row) => {
    const text = title ? row.cells[title.id] : undefined;
    const kinds = typeof text === "string" ? assessmentKey(text).kinds : new Set<string>();
    if (kinds.has("exam") || kinds.has("midterm") || kinds.has("final")) return true;
    const value = type ? row.cells[type.id] : undefined;
    const ids = Array.isArray(value) ? value : typeof value === "string" ? [value] : [];
    return ids.some((id) => EXAM_OPTION.test(type?.options?.find((o) => o.id === id)?.label ?? ""));
  });
  if (holdsExams) target.name = name;
}

function mergeInto(
  workspace: Workspace,
  exams: Database,
  target: Database,
  labels: MergeLabels,
) {
  // The merged list holds every kind of graded work now; "Problem sets" would mislabel the exams.
  if (namedAfterOneKind(target.name)) target.name = labels.gradedWork;
  // The type column that tells exams apart in the merged list.
  let typeProp = typeColumnOf(target);
  if (!typeProp) {
    typeProp = newTypeColumn(target, exams, labels.typeColumn);
    const course = detectGradeColumns(target).course;
    const after = course ? target.properties.indexOf(course) : 0;
    target.properties.splice(after + 1, 0, typeProp);
  }
  const typeOptionsBefore = new Set((typeProp.options ?? []).map((o) => o.id));
  const columns = mapExamColumns(exams, target)!;
  const optionMaps = new Map<string, Map<string, string>>();
  for (const prop of exams.properties) {
    const to = columns.get(prop.id)!;
    if (OPTION_TYPES.has(prop.type) && OPTION_TYPES.has(to.type)) {
      optionMaps.set(prop.id, mapOptions(prop, to, exams, target));
    }
  }

  typeProp.options ??= [];
  let examOption =
    typeProp.options.find((o) => optionKey(o.label) === optionKey(labels.examType)) ??
    // The list's own exam option ("Klausur"), not one the exams brought ("Midterm").
    typeProp.options.find((o) => typeOptionsBefore.has(o.id) && EXAM_OPTION.test(o.label));
  if (!examOption) {
    examOption = { id: uniqueId("type-exam", new Set(typeProp.options.map((o) => o.id))), label: labels.examType, color: "red" };
    typeProp.options.push(examOption);
  }

  // Rows.
  const rowIds = new Set(target.rows.map((r) => r.id));
  const rowMap = new Map<string, string>();
  const examTypes = new Set<string>();
  for (const row of exams.rows) {
    const id = uniqueId(row.id, rowIds);
    rowIds.add(id);
    rowMap.set(row.id, id);
    const cells: DatabaseRow["cells"] = {};
    for (const prop of exams.properties) {
      const to = columns.get(prop.id)!;
      cells[to.id] = convertCell(row.cells[prop.id], prop, to, optionMaps.get(prop.id));
    }
    const type = cells[typeProp.id];
    if (isEmptyCell(type)) cells[typeProp.id] = typeProp.type === "multi_select" ? [examOption.id] : examOption.id;
    const typed = cells[typeProp.id];
    for (const value of Array.isArray(typed) ? typed : [typed]) if (typeof value === "string") examTypes.add(value);
    target.rows.push({ id, cells, ...(row.source ? { source: row.source } : {}) });
  }
  if (examTypes.size === 0) examTypes.add(examOption.id);

  // Views: the exams database's views, over the merged list, showing exams only.
  const remapFilter = (filter: ViewFilter): ViewFilter | null => {
    const to = columns.get(filter.propertyId);
    if (!to) return null;
    const options = optionMaps.get(filter.propertyId);
    let value = filter.value;
    if (options && typeof value === "string") value = options.get(value) ?? value;
    else if (options && Array.isArray(value)) value = value.map((v) => options.get(v) ?? v);
    return { ...filter, propertyId: to.id, ...(value !== undefined ? { value } : {}) };
  };
  const onlyExams: ViewFilter = {
    propertyId: typeProp.id,
    operator: typeProp.type === "multi_select" ? "contains" : "is",
    value: [...examTypes],
  };
  const viewIds = new Set(target.views.map((v) => v.id));
  const viewMap = new Map<string, string>();
  for (const view of exams.views) {
    const id = uniqueId(view.id, viewIds);
    viewIds.add(id);
    viewMap.set(view.id, id);
    const prop = (pid: string | undefined) => (pid ? columns.get(pid)?.id : undefined);
    const filters = (view.filters ?? []).map(remapFilter).filter((f): f is ViewFilter => f !== null);
    // "Any of" conditions cannot also require "is an exam"; one condition can.
    const anyOf = view.filterMatch === "any" && filters.length > 1;
    const next: DatabaseView = {
      id,
      name: view.name,
      type: view.type,
      ...(prop(view.groupByPropertyId) ? { groupByPropertyId: prop(view.groupByPropertyId) } : {}),
      ...(prop(view.datePropertyId) ? { datePropertyId: prop(view.datePropertyId) } : {}),
      ...(view.visiblePropertyIds
        ? { visiblePropertyIds: view.visiblePropertyIds.map(prop).filter((p): p is string => !!p) }
        : {}),
      ...(view.sorts
        ? {
            sorts: view.sorts
              .filter((s) => columns.has(s.propertyId))
              .map((s) => ({ ...s, propertyId: columns.get(s.propertyId)!.id })),
          }
        : {}),
      filters: anyOf ? filters : [...filters, onlyExams],
      filterMatch: anyOf ? "any" : "all",
    };
    target.views.push(next);
  }
  const fallbackView = exams.views[0] ? viewMap.get(exams.views[0].id) : target.views[0]?.id;

  // Everything that pointed at the exams database.
  workspace.databases = workspace.databases.filter((db) => db.id !== exams.id);
  for (const db of workspace.databases) {
    for (const prop of db.properties) {
      if (prop.type !== "relation" || prop.relationDatabaseId !== exams.id) continue;
      prop.relationDatabaseId = target.id;
      for (const row of db.rows) {
        const value = row.cells[prop.id];
        if (Array.isArray(value)) row.cells[prop.id] = value.map((v) => rowMap.get(v) ?? v);
      }
    }
  }
  for (const page of workspace.pages) {
    for (const block of page.blocks) {
      if (block.type === "database_view" && block.databaseId === exams.id) {
        block.databaseId = target.id;
        block.viewId = viewMap.get(block.viewId) ?? fallbackView ?? block.viewId;
      } else if (block.type === "grades" && block.databaseId === exams.id) {
        block.databaseId = target.id;
        if (block.columns) {
          const remapped: GradesColumns = {};
          for (const [key, id] of Object.entries(block.columns) as [keyof GradesColumns, string | null | undefined][]) {
            if (id === null) remapped[key] = null;
            else if (typeof id === "string" && columns.has(id)) remapped[key] = columns.get(id)!.id;
          }
          block.columns = remapped;
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Competing grade tables

const GRADE_TABLE =
  /grade|gpa|noten|notenübersicht|calificaci|notas|bulletin|moyenne|voti|valutazion|cijfer|成绩|績点|成績|評定|درجات|علامات|المعدل/i;

/**
 * A "Grade Tracker" table next to the graded-work database splits the
 * student's grades in two (and its footer sums targets). When it holds no
 * deadlines it is removed, and each place that showed it gets a grades block
 * over the graded-work database instead.
 */
function dropCompetingGradeTables(workspace: Workspace, gradesTitle: string) {
  const work = findDeadlineDatabase(workspace);
  if (!work) return;
  const competing = workspace.databases.filter(
    (db) =>
      db.id !== work.id &&
      GRADE_TABLE.test(db.name) &&
      db.properties.some((p) => p.type === "number") &&
      datedRows(db) === 0 &&
      // Never a database the graded work points into.
      !work.properties.some((p) => p.type === "relation" && p.relationDatabaseId === db.id),
  );
  if (competing.length === 0) return;
  const removed = new Set(competing.map((db) => db.id));
  workspace.databases = workspace.databases.filter((db) => !removed.has(db.id));
  for (const db of workspace.databases) {
    const gone = db.properties.filter((p) => p.type === "relation" && p.relationDatabaseId && removed.has(p.relationDatabaseId));
    if (gone.length === 0) continue;
    db.properties = db.properties.filter((p) => !gone.includes(p));
    for (const row of db.rows) for (const p of gone) delete row.cells[p.id];
  }
  const ids = allBlockIds(workspace);
  for (const page of workspace.pages) {
    const hasGrades = page.blocks.some((b) => b.type === "grades");
    const blocks: Block[] = [];
    let replaced = hasGrades;
    for (const block of page.blocks) {
      if (block.type === "database_view" && removed.has(block.databaseId)) {
        if (!replaced) {
          const id = uniqueId("b-grades", ids);
          ids.add(id);
          const grades: GradesBlock = { id, type: "grades", title: gradesTitle, databaseId: work.id };
          blocks.push(grades);
          replaced = true;
        }
        continue;
      }
      blocks.push(block);
    }
    page.blocks = blocks;
  }
}

// ---------------------------------------------------------------------------
// Title headings

function comparable(text: string): string {
  return text
    .normalize("NFKC")
    .replace(/[\p{Extended_Pictographic}️‍]/gu, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .toLocaleLowerCase();
}

/** The page shows its title already; a first heading saying the same is noise. */
function stripTitleHeading(page: Page) {
  const first = page.blocks[0];
  if (first?.type !== "heading") return;
  const title = comparable(page.title);
  if (title && comparable(first.text) === title) page.blocks = page.blocks.slice(1);
}

// ---------------------------------------------------------------------------
// Natural dates in prose

const ISO_IN_TEXT = /(?<![\w/.-])(20\d{2})-(\d{2})-(\d{2})(?![\w/-])/g;

function naturalDate(iso: string, locale: string, today: string): string {
  const date = new Date(`${iso}T12:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return iso;
  const sameYear = iso.slice(0, 4) === today.slice(0, 4);
  try {
    return date.toLocaleDateString(locale, {
      month: "long",
      day: "numeric",
      ...(sameYear ? {} : { year: "numeric" }),
      timeZone: "UTC",
    });
  } catch {
    return iso;
  }
}

export function naturalDatesInText(text: string, locale: string, today: string): string {
  if (!text.includes("-")) return text;
  return text.replace(ISO_IN_TEXT, (whole) => naturalDate(whole, locale, today));
}

function naturalDates(workspace: Workspace, locale: string, today: string) {
  const fix = (text: string) => naturalDatesInText(text, locale, today);
  for (const page of workspace.pages) {
    for (const block of page.blocks) {
      switch (block.type) {
        case "heading":
        case "paragraph":
        case "todo":
        case "bulleted_list_item":
        case "numbered_list_item":
        case "quote":
        case "callout":
          block.text = fix(block.text);
          break;
        case "flashcards":
          for (const card of block.cards) {
            card.front = fix(card.front);
            card.back = fix(card.back);
          }
          break;
        case "quiz":
          for (const question of block.questions) {
            question.prompt = fix(question.prompt);
            if (question.choices) question.choices = question.choices.map(fix);
            if (question.explanation) question.explanation = fix(question.explanation);
            if (question.answerText) question.answerText = fix(question.answerText);
          }
          break;
        default:
          break;
      }
    }
  }
  for (const db of workspace.databases) {
    if (db.description) db.description = fix(db.description);
    const textProps = db.properties.filter((p) => p.type === "text").map((p) => p.id);
    for (const row of db.rows) {
      for (const id of textProps) {
        const value = row.cells[id];
        if (typeof value === "string") row.cells[id] = fix(value);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Status

/** Rows the model left without a status start open, like a row the student adds. */
function openStatusDefaults(db: Database) {
  const completion = completionField(db);
  for (const prop of db.properties) {
    if (prop.type !== "status" || !prop.options?.length) continue;
    const open =
      completion?.property.id === prop.id && typeof completion.openValue === "string"
        ? completion.openValue
        : prop.options[0].id;
    const valid = new Set(prop.options.map((o) => o.id));
    for (const row of db.rows) {
      const value = row.cells[prop.id];
      if (typeof value === "string" && valid.has(value)) continue;
      // A label written where the option id belongs ("Done") still means that option.
      const byLabel =
        typeof value === "string" && value.trim()
          ? prop.options.find((o) => o.label.trim().toLocaleLowerCase() === value.trim().toLocaleLowerCase())
          : undefined;
      row.cells[prop.id] = byLabel?.id ?? open;
    }
  }
}

// ---------------------------------------------------------------------------
// "This week" on the dashboard

function isUpcomingView(view: DatabaseView): boolean {
  return (view.filters ?? []).some((f) => f.operator === "next_days");
}

function ensureThisWeek(workspace: Workspace, name: string) {
  const db = findDeadlineDatabase(workspace);
  const home = workspace.pages.find((p) => p.id === workspace.homePageId) ?? workspace.pages[0];
  if (!db || !home) return;
  let view = db.views.find(isUpcomingView);
  if (!view) {
    const settings = upcomingViewSettings(db);
    if (!settings) return;
    view = {
      id: uniqueId("v-this-week", new Set(db.views.map((v) => v.id))),
      name,
      type: "list",
      ...settings,
    };
    db.views.push(view);
  }
  const viewId = view.id;
  if (home.blocks.some((b) => b.type === "database_view" && b.databaseId === db.id && b.viewId === viewId)) {
    return;
  }
  const ids = allBlockIds(workspace);
  const heading: Block = { id: uniqueId("b-this-week-heading", ids), type: "heading", level: 2, text: `📅 ${name}` };
  ids.add(heading.id);
  const list: Block = { id: uniqueId("b-this-week", ids), type: "database_view", databaseId: db.id, viewId };
  // Right under the welcome callout(s): the first thing the student reads.
  let at = 0;
  while (at < home.blocks.length && (home.blocks[at].type === "callout" || home.blocks[at].type === "paragraph")) {
    at += 1;
  }
  home.blocks.splice(at, 0, heading, list);
}

// ---------------------------------------------------------------------------
// One section per heading on the dashboard

/** End (exclusive) of the section a heading at `start` opens. */
function sectionEnd(blocks: Block[], start: number): number {
  const level = (blocks[start] as Extract<Block, { type: "heading" }>).level;
  let end = start + 1;
  while (end < blocks.length) {
    const block = blocks[end];
    if (block.type === "heading" && block.level <= level) break;
    end += 1;
  }
  return end;
}

/**
 * Two dashboard sections under the same heading ("📅 This week" for deadlines
 * and "🗓️ This week" for the study plan) read as a mistake. Headings match
 * when their words do (emoji, punctuation and case aside) at the same level
 * under the same parent heading; the later section's content moves to the end
 * of the first one and its heading goes. A view shown twice in the merged
 * section is shown once. Only the home page: elsewhere a repeated heading
 * ("Key terms" in each week's notes) can be deliberate, and moving prose
 * would reorder it.
 */
function mergeDuplicateSections(workspace: Workspace) {
  const home = workspace.pages.find((p) => p.id === workspace.homePageId) ?? workspace.pages[0];
  if (!home) return;
  for (;;) {
    const blocks = home.blocks;
    const seen = new Map<string, number>();
    const parents: { level: number; id: string }[] = [];
    let duplicate: { first: number; later: number } | undefined;
    for (let i = 0; i < blocks.length && !duplicate; i += 1) {
      const block = blocks[i];
      if (block.type !== "heading") continue;
      while (parents.length && parents[parents.length - 1].level >= block.level) parents.pop();
      const words = comparable(block.text);
      if (words) {
        const key = `${parents[parents.length - 1]?.id ?? ""}|${block.level}|${words}`;
        const first = seen.get(key);
        if (first === undefined) seen.set(key, i);
        else duplicate = { first, later: i };
      }
      parents.push({ level: block.level, id: block.id });
    }
    if (!duplicate) return;
    const laterEnd = sectionEnd(blocks, duplicate.later);
    const firstEnd = sectionEnd(blocks, duplicate.first);
    const shown = new Set(
      blocks
        .slice(duplicate.first + 1, firstEnd)
        .flatMap((b) => (b.type === "database_view" ? [`${b.databaseId}/${b.viewId}`] : [])),
    );
    const moved = blocks
      .slice(duplicate.later + 1, laterEnd)
      .filter((b) => b.type !== "database_view" || !shown.has(`${b.databaseId}/${b.viewId}`));
    // The later section sits after the first one ends, so cutting it first keeps firstEnd valid.
    const rest = [...blocks.slice(0, duplicate.later), ...blocks.slice(laterEnd)];
    rest.splice(firstEnd, 0, ...moved);
    home.blocks = rest;
  }
}

// ---------------------------------------------------------------------------
// Facts the student never gave

/** What the student's own input (description, answers, material) contains. */
export interface InputEvidence {
  /** All of it, for looking up values such as course codes. */
  text: string;
  /** It names at least one date, or a relative one ("next Friday"). */
  hasDates: boolean;
  /** It states at least one grading weight ("25%"). */
  hasWeights: boolean;
}

const RELATIVE_DATE =
  /(?<![\p{L}])(today|tonight|tomorrow|next|this (?:mon|tues|wednes|thurs|fri|satur|sun)day|in \d+ (?:days?|weeks?)|(?:mon|tues|wednes|thurs|fri|satur|sun)day|morgen|übermorgen|nächste[nrs]?|mañana|próxim[oa]s?|pasado mañana|demain|prochaine?s?|domani|prossim[oa]|amanhã|nächsten|volgende|overmorgen|غدا|غدًا|القادم)(?![\p{L}])|明天|后天|下周|下星期|下个月|明日|明後日|来週|再来週|来月/iu;
const PERCENT_GIVEN = /\d\s*(?:%|percent\b|prozent\b|por ?ciento|pour ?cent|per ?cento|por ?cento|procent\b)/iu;

/** Evidence for {@link removeUnsupportedFacts}; `foundDates` from the syllabus date reader. */
export function inputEvidence(text: string, foundDates: number): InputEvidence {
  return {
    text,
    hasDates: foundDates > 0 || RELATIVE_DATE.test(text),
    hasWeights: PERCENT_GIVEN.test(text),
  };
}

/** Databases that plan the student's own time; their dates are suggestions, not facts. */
const PLANNING_DB =
  /plan|schedule|study (?:session|block)|session|routine|habit|lernplan|wochenplan|lernbl|zeitplan|gewohnheit|planific|sesion|sesión|horario|hábito|habito|planning|révision|revision|séance|seance|pianific|sessione|abitudin|planejamento|cronograma|gewoonte|studieplan|计划|安排|習慣|计划表|学習計画|週間|スケジュール|خطة|جدول|عادات/i;
const WEIGHT_COLUMN = /weight|%|gewicht|peso|poids|pond[ée]ration|ponderaci|ponderazione|pondera[cç]|weging|权重|比重|配点|割合|重み|وزن/i;
const CODE_COLUMN = /code|kürzel|kuerzel|código|codigo|codice|sigle|nummer|number|代码|编号|コード|番号|رمز/i;
const COURSE_CODE_VALUE = /^[A-Za-z]{2,6}[ -]?\d{2,4}[A-Za-z]?$/;

function compactText(value: string): string {
  return value.toLowerCase().replace(/[\s\-_.]+/g, "");
}

/**
 * A model without the student's material invents what it does not know:
 * exam dates from "exams in February", grading weights, course codes. They
 * would show up as real deadlines in the calendar and the daily plan, and as
 * real weights in the grade calculator. When the student's input contains
 * no date at all, dates outside planning databases are cleared; when it
 * states no weight, weights are cleared; a course code that appears nowhere
 * in the input is cleared. The student fills these in; an empty cell is
 * honest, an invented one is not.
 */
export function removeUnsupportedFacts(workspace: Workspace, evidence: InputEvidence): Workspace {
  const next = structuredClone(workspace);
  unsupportedStatuses(next, evidence.text);
  unsupportedGrading(next, evidence);
  if (!evidence.hasDates) removeImpliedDates(next);
  const known = compactText(evidence.text);
  for (const db of next.databases) {
    const planning = PLANNING_DB.test(`${db.name} ${db.description ?? ""}`);
    const clear = new Set<string>();
    for (const prop of db.properties) {
      if (prop.type === "date" && !evidence.hasDates && !planning) clear.add(prop.id);
      if (prop.type === "number" && !evidence.hasWeights && WEIGHT_COLUMN.test(prop.name)) clear.add(prop.id);
    }
    const codes = db.properties.filter((p) => p.type === "text" && CODE_COLUMN.test(p.name)).map((p) => p.id);
    for (const row of db.rows) {
      for (const id of clear) if (row.cells[id] !== undefined) row.cells[id] = null;
      for (const id of codes) {
        const value = row.cells[id];
        if (typeof value === "string" && COURSE_CODE_VALUE.test(value.trim()) && !known.includes(compactText(value))) {
          row.cells[id] = null;
        }
      }
    }
  }
  return next;
}

// ---------------------------------------------------------------------------
// Statuses the student never gave

/** Words saying work has begun or is finished ("in progress", "handed in", "abgegeben", "提出済"). */
const STATUS_WORDS =
  /(?<![\p{L}])(in progress|started|starting|working on|halfway|half done|begun|drafting|drafted|done|finished|complete|completed|submitted|handed in|turned in|graded|returned|marked|already|angefangen|begonnen|in arbeit|fertig|erledigt|abgegeben|bewertet|korrigiert|schon|bereits|en curso|en progreso|empezad[oa]|comenzad[oa]|trabajando en|hech[oa]|terminad[oa]|entregad[oa]|calificad[oa]|ya|en cours|commencée?s?|fini[es]?|terminée?s?|rendue?s?|notée?s?|déjà|in corso|iniziat[oa]|fatt[oa]|finit[oa]|consegnat[oa]|valutat[oa]|già|em andamento|comecei|começad[oa]|feit[oa]|entregue|avaliad[oa]|já|bezig|klaar|ingeleverd|nagekeken)(?![\p{L}])|进行中|已开始|正在|完成|已交|已提交|已批改|進行中|着手|取り組み中|済|終わ|提出した|قيد التنفيذ|بدأت|انتهيت|أنهيت|سلمت|تم التسليم|تم تصحيح/iu;

/** Sentences of the student's input that say something has begun or is done. */
function statusSentences(text: string): string[] {
  return text
    .split(/\n|(?<=[.!?。！？;])\s*/u)
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && s.length <= 600 && STATUS_WORDS.test(s));
}

/** Does this sentence talk about this row ("PS 4 is done" about "Problem Set 4")? */
function mentions(sentence: string, title: string): boolean {
  const row = assessmentKey(title);
  const said = assessmentKey(sentence);
  if (row.numbers.length > 0 && !row.numbers.every((n) => said.numbers.includes(n))) return false;
  if ([...row.kinds].some((k) => said.kinds.has(k))) return true;
  const stems = new Set(nameStems(sentence));
  return nameStems(title).some((stem) => stem.length >= 3 && stems.has(stem));
}

/**
 * A model likes to make a workspace look lived in: one assignment "In
 * progress", a topic "Practising", a habit already ticked. Unless the
 * student's input says so about that row, every row starts where a row the
 * student adds starts: the first open status, not done.
 */
function unsupportedStatuses(workspace: Workspace, input: string) {
  const sentences = statusSentences(input);
  for (const db of workspace.databases) {
    const title = titleProperty(db);
    const completion = completionField(db);
    const fields: { id: string; open: CellValue }[] = [];
    if (completion && completion.openValue !== null) {
      fields.push({ id: completion.property.id, open: completion.openValue });
    }
    for (const prop of db.properties) {
      if (prop.type === "status" && prop.options?.length && !fields.some((f) => f.id === prop.id)) {
        fields.push({ id: prop.id, open: prop.options[0].id });
      }
    }
    if (fields.length === 0) continue;
    for (const row of db.rows) {
      const name = title ? row.cells[title.id] : undefined;
      const said = typeof name === "string" && name.trim() !== "" && sentences.some((s) => mentions(s, name));
      if (said) continue;
      for (const field of fields) {
        const value = row.cells[field.id];
        if (value !== undefined && value !== null && value !== field.open) row.cells[field.id] = field.open;
      }
    }
  }
}

/** The input says lowest scores are dropped ("lowest dropped", "best 8 of 10", "gestrichen"). */
const DROP_GIVEN =
  /(?<![\p{L}])(drop(?:s|ped|ping)?|lowest|worst|best \d+ of|gestrichen|streich|schlechteste|niedrigste|descart|elimina|m[aá]s baja|plus basse|moins bonne|retir|scart|peggior|pi[uù] bass|descartad|mais baixa|pior|laagste|valt af|vervalt)|最低|去掉|除外|أدنى/iu;

/**
 * Grading categories hold only what the student gave: none without stated
 * weights, no dropped scores unless the input says so, and an item count only
 * when the input names that number.
 */
function unsupportedGrading(workspace: Workspace, evidence: InputEvidence) {
  const dropGiven = DROP_GIVEN.test(evidence.text);
  for (const db of workspace.databases) {
    if (!db.grading) continue;
    if (!evidence.hasWeights) {
      delete db.grading;
      continue;
    }
    for (const category of db.grading.categories) {
      if (category.dropLowest && !dropGiven) delete category.dropLowest;
      if (category.expectedCount && !new RegExp(`(?<!\\d)${category.expectedCount}(?!\\d)`).test(evidence.text)) {
        delete category.expectedCount;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// No dates given: imply none

/** Full month names (no short forms: "mar", "may" and "set" are words too). */
const MONTH_WORDS = [
  "january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december",
  "enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "setiembre", "octubre", "noviembre", "diciembre",
  "januar", "jänner", "februar", "märz", "juni", "juli", "oktober", "dezember",
  "janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre",
  "gennaio", "febbraio", "aprile", "maggio", "giugno", "luglio", "settembre", "ottobre", "dicembre",
  "janeiro", "fevereiro", "março", "maio", "junho", "julho", "setembro", "outubro", "novembro", "dezembro",
  "januari", "februari", "maart", "mei", "augustus",
  "يناير", "فبراير", "مارس", "أبريل", "ابريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "اكتوبر", "نوفمبر", "ديسمبر",
];
const MONTH = `(?:${MONTH_WORDS.join("|")}|\\d{1,2}\\s*月(?!\\s*\\d))`;
const MONTH_QUALIFIER = String.raw`(?:early|mid|late|end of|beginning of|anfang|mitte|ende|principios de|mediados de|finales de|début|mi|fin|inizio|metà|fine|início|meados de|eind|begin|midden)?[\s-]*`;
const MONTH_IN_BRACKETS = new RegExp(String.raw`\s*[([（【][^)\]）】]{0,40}?${MONTH}[^)\]）】]{0,40}[)\]）】]`, "giu");
const MONTH_AT_END = new RegExp(
  String.raw`\s*(?:[-–—,:·|]|\b(?:in|im|en|au|a|em|op|di|del|de)\b)\s*${MONTH_QUALIFIER}${MONTH}(?:\s+\d{4})?\s*$`,
  "iu",
);
const MONTH_AT_START = new RegExp(String.raw`^${MONTH_QUALIFIER}${MONTH}(?:\s+\d{4})?\s*[-–—:]?\s+`, "iu");

/**
 * "Midterm Exam (February)" -> "Midterm Exam"; "February midterm" -> "Midterm".
 * Only names of graded work: "Mars" stays a planet in a topics list.
 */
export function withoutMonthNames(text: string): string {
  if (assessmentKey(text).kinds.size === 0) return text;
  const next = text.replace(MONTH_IN_BRACKETS, "").replace(MONTH_AT_END, "").replace(MONTH_AT_START, "").trim();
  if (!next || next === text) return next ? next : text;
  return next.charAt(0).toLocaleUpperCase() + next.slice(1);
}

/** Words that make a note urgent ("the midterm is near", "coming up", "bald", "即将"). */
const URGENT_LATIN =
  /(?<![\p{L}])(soon|coming up|upcoming|approaching|around the corner|is near|are near|nearly here|next week|this week|tomorrow|in a few days|looming|right around|bald|demnächst|steht bevor|stehen bevor|rückt näher|rücken näher|nächste woche|diese woche|pronto|se acerca|se acercan|próxima semana|esta semana|mañana|inminente|a la vuelta de la esquina|bientôt|approche|approchent|la semaine prochaine|cette semaine|demain|imminente?s?|presto|si avvicina|si avvicinano|prossima settimana|questa settimana|domani|em breve|se aproxima|se aproximam|está chegando|amanhã|binnenkort|komt eraan|komen eraan|nadert|naderen|volgende week|deze week)(?![\p{L}])/iu;
const URGENT_CJK_AR = /即将|快到|临近|下周|本周|明天|马上|まもなく|間もなく|近づ|来週|今週|明日|もうすぐ|قريبا|قريبًا|يقترب|تقترب|الأسبوع القادم|هذا الأسبوع|غدا|غدًا/u;

/** The text without its sentences that imply a date is close; "" when nothing is left. */
export function withoutUrgency(text: string): string {
  if (!URGENT_LATIN.test(text) && !URGENT_CJK_AR.test(text)) return text;
  const sentences = text.split(/(?<=[.!?。！？])\s*/u);
  return sentences
    .filter((s) => !URGENT_LATIN.test(s) && !URGENT_CJK_AR.test(s))
    .join(" ")
    .trim();
}

/**
 * With no date anywhere in the student's input, the workspace must not imply
 * one: a title like "Midterm Exam (February)" (in a fall term), or a welcome
 * note saying the midterm is near, reads as a fact the student never gave.
 * Month names leave row titles, page titles and headings; urgent sentences
 * leave notes, and a note with nothing left goes.
 */
function removeImpliedDates(workspace: Workspace) {
  for (const db of workspace.databases) {
    if (PLANNING_DB.test(`${db.name} ${db.description ?? ""}`)) continue;
    const title = titleProperty(db);
    if (!title || title.type !== "text") continue;
    for (const row of db.rows) {
      const value = row.cells[title.id];
      if (typeof value === "string") row.cells[title.id] = withoutMonthNames(value);
    }
  }
  for (const page of workspace.pages) {
    page.title = withoutMonthNames(page.title);
    page.blocks = page.blocks.filter((block) => {
      if (block.type === "heading") {
        block.text = withoutMonthNames(block.text);
        return true;
      }
      if (block.type === "callout" || block.type === "paragraph" || block.type === "quote") {
        const before = block.text;
        block.text = withoutUrgency(before);
        return block.text !== "" || before === "";
      }
      return true;
    });
  }
}

// ---------------------------------------------------------------------------
// Icons

function pageIcons(workspace: Workspace) {
  workspace.icon ||= "🎓";
  for (const page of workspace.pages) {
    if (page.icon?.trim()) continue;
    page.icon = page.id === workspace.homePageId ? "🏠" : "📄";
  }
}
