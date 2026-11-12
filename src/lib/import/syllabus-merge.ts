/**
 * Make sure the grading weights and exam dates found in a student's syllabus
 * survive generation: after the model builds the workspace, every extracted
 * assessment is matched against the assignment data and anything the model
 * dropped is filled in (weight → the weight % number column, date → the due
 * date column). Existing values the model wrote are never overwritten.
 *
 * The merge exists to restore what the model dropped, so it must never create
 * a second row for something the model already has under a slightly different
 * title. Each extracted item therefore gets one of three treatments
 * (see ./assessment-match):
 *   - exactly one row is confidently the same item → fill that row's empty
 *     weight / date cells;
 *   - some row might be the same item (or two rows tie) → do nothing;
 *   - no row resembles it at all → add it as a new row.
 *
 * Pure: takes a workspace, returns a new one.
 */
import type {
  CellValue,
  Database,
  DatabaseProperty,
  DatabaseRow,
  Workspace,
} from "@/lib/workspace/types";
import { completionField } from "@/lib/workspace/view-logic";
import { matchAssessments } from "./assessment-match";
import type { SyllabusAssessment, SyllabusFacts } from "./syllabus-facts";

/** Localized names used only when a new assessments database must be created. */
export interface AssessmentLabels {
  database: string;
  description: string;
  name: string;
  course: string;
  weight: string;
  /** Number column for the score received (empty until graded); see src/lib/grades. */
  score?: string;
  due: string;
  table: string;
  calendar: string;
}

const WEIGHT_NAME =
  /weight|%|gewicht|peso|poids|ponder|weging|权重|比重|配点|割合|重み|وزن/i;
const COURSE_NAME =
  /course|class|module|subject|kurs|fach|curso|asignatura|cours|mati[eè]re|corso|materia|vak|cursus|课程|科目|授業|講義|مقرر|مادة/i;
const ASSIGNMENT_DB =
  /assign|assess|deadline|course ?work|homework|exam|task|due|aufgab|prüfung|tarea|entrega|examen|devoir|évaluation|compit|esame|scadenz|tarefa|prova|opdracht|toets|作业|考试|课题|課題|試験|締切|واجب|اختبار|مهام/i;

export function applySyllabusFacts(
  workspace: Workspace,
  facts: SyllabusFacts,
  labels: AssessmentLabels,
): Workspace {
  const items = facts.assessments.filter(
    (item) => item.weight !== undefined || item.date !== undefined,
  );
  if (items.length === 0) return workspace;

  const next = structuredClone(workspace);
  const target = pickAssessmentDatabase(next.databases);
  if (!target) {
    addAssessmentsDatabase(next, items, labels);
    return next;
  }

  const db = target;
  const titleProp = pickTitleProperty(db);
  const dateProp = db.properties.find((p) => p.type === "date");
  let weightProp = db.properties.find((p) => p.type === "number" && WEIGHT_NAME.test(p.name));
  if (!weightProp && items.some((item) => item.weight !== undefined)) {
    weightProp = {
      id: uniqueId("a-weight", new Set(db.properties.map((p) => p.id))),
      name: labels.weight,
      type: "number",
    };
    db.properties.push(weightProp);
  }
  const courseProp = db.properties.find(
    (p) =>
      (p.type === "select" || p.type === "text") && COURSE_NAME.test(p.name) && p !== titleProp,
  );
  const completion = completionField(db);
  const statusProp = db.properties.find((p) => p.type === "status");
  const rowIds = new Set(db.rows.map((row) => row.id));
  // Without a title column nothing can be matched, so nothing is added either.
  if (!titleProp) return next;

  for (const item of items) {
    const courseValue = courseProp ? resolveCourse(courseProp, item.course) : undefined;
    const decision = matchRow(db.rows, item, titleProp, dateProp, courseProp, courseValue);
    if (decision.kind === "unsure") continue;
    if (decision.kind === "match") {
      const existing = decision.row;
      if (item.weight !== undefined && weightProp && isEmpty(existing.cells[weightProp.id])) {
        existing.cells[weightProp.id] = item.weight;
      }
      if (item.date && dateProp && isEmpty(existing.cells[dateProp.id])) {
        existing.cells[dateProp.id] = item.date;
      }
      continue;
    }
    const cells: Record<string, CellValue> = { [titleProp.id]: item.name };
    if (item.weight !== undefined && weightProp) cells[weightProp.id] = item.weight;
    if (item.date && dateProp) cells[dateProp.id] = item.date;
    if (courseProp && courseValue) cells[courseProp.id] = courseValue;
    // A row starts open ("Not started"), or done when the syllabus says it
    // was already handed in or graded.
    if (completion && item.done) cells[completion.property.id] = completion.doneValue;
    else if (completion?.openValue !== null && completion?.openValue !== undefined) {
      cells[completion.property.id] = completion.openValue;
    } else if (statusProp?.options?.[0]) cells[statusProp.id] = statusProp.options[0].id;
    const id = uniqueId("syllabus-item", rowIds);
    rowIds.add(id);
    db.rows.push({ id, cells });
  }
  return next;
}

type RowDecision = { kind: "match"; row: DatabaseRow } | { kind: "unsure" } | { kind: "none" };

/**
 * The row this item is, if exactly one row is confidently it; "unsure" when
 * a row might be it (or several tie); "none" when nothing resembles it.
 */
function matchRow(
  rows: DatabaseRow[],
  item: SyllabusAssessment,
  titleProp: DatabaseProperty,
  dateProp: DatabaseProperty | undefined,
  courseProp: DatabaseProperty | undefined,
  courseValue: string | undefined,
): RowDecision {
  let best: { row: DatabaseRow; score: number } | undefined;
  let tie = false;
  let maybe = false;
  for (const row of rows) {
    const title = row.cells[titleProp.id];
    if (typeof title !== "string" || !title.trim()) continue;
    if (courseProp && courseValue) {
      const rowCourse = row.cells[courseProp.id];
      if (!isEmpty(rowCourse) && rowCourse !== courseValue) continue;
    }
    const rowDate = dateProp ? row.cells[dateProp.id] : undefined;
    const result = matchAssessments(item.name, title, {
      dateA: item.date,
      dateB: typeof rowDate === "string" ? rowDate.slice(0, 10) : undefined,
    });
    if (result.strength === "maybe") maybe = true;
    if (result.strength !== "same") continue;
    if (!best || result.score > best.score) {
      best = { row, score: result.score };
      tie = false;
    } else if (result.score === best.score) {
      tie = true;
    }
  }
  if (best && !tie) return { kind: "match", row: best.row };
  if (best || maybe) return { kind: "unsure" };
  return { kind: "none" };
}

/** The database that holds assignments: has a date column, prefers a weight column. */
function pickAssessmentDatabase(databases: Database[]): Database | undefined {
  let best: { db: Database; score: number } | undefined;
  for (const db of databases) {
    if (!db.properties.some((p) => p.type === "date")) continue;
    if (!db.properties.some((p) => p.type === "text")) continue;
    const hasWeight = db.properties.some((p) => p.type === "number" && WEIGHT_NAME.test(p.name));
    const looksLikeAssignments = ASSIGNMENT_DB.test(`${db.name} ${db.description ?? ""}`);
    if (!hasWeight && !looksLikeAssignments) continue;
    const score = (hasWeight ? 2 : 0) + (looksLikeAssignments ? 1 : 0);
    if (!best || score > best.score) best = { db, score };
  }
  return best?.db;
}

function pickTitleProperty(db: Database): DatabaseProperty | undefined {
  const texts = db.properties.filter((p) => p.type === "text");
  return (
    texts.find((p) => /name|title|assignment|item|assessment|task/i.test(p.name)) ?? texts[0]
  );
}

/** Map a syllabus course header onto the course column (option id, or text). */
function resolveCourse(prop: DatabaseProperty, course: string | undefined): string | undefined {
  if (!course) return undefined;
  if (prop.type === "text") return course;
  const wanted = compact(course);
  const code = course.match(/[A-Za-z]{2,5}[ -]?\d{2,4}[A-Za-z]?/)?.[0];
  const wantedCode = code ? compact(code) : "";
  const option = prop.options?.find((candidate) => {
    const label = compact(candidate.label);
    if (!label) return false;
    return (
      label === wanted ||
      (wantedCode && label.includes(wantedCode)) ||
      (label.length >= 4 && wanted.includes(label))
    );
  });
  return option?.id;
}

function compact(value: string): string {
  return value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
}

function isEmpty(value: CellValue | undefined): boolean {
  return value === undefined || value === null || value === "";
}

function uniqueId(prefix: string, taken: Set<string>): string {
  if (!taken.has(prefix)) return prefix;
  let n = 2;
  while (taken.has(`${prefix}-${n}`)) n += 1;
  return `${prefix}-${n}`;
}

/** No assignment-like database at all: create one and show it on the home page. */
function addAssessmentsDatabase(
  workspace: Workspace,
  items: SyllabusAssessment[],
  labels: AssessmentLabels,
) {
  const dbId = uniqueId("db-syllabus-assessments", new Set(workspace.databases.map((d) => d.id)));
  const rows: DatabaseRow[] = items.map((item, index) => ({
    id: `syllabus-item-${index + 1}`,
    cells: {
      "sa-name": item.name,
      "sa-course": item.course ?? null,
      "sa-weight": item.weight ?? null,
      ...(labels.score ? { "sa-score": null } : {}),
      "sa-due": item.date ?? null,
    },
  }));
  workspace.databases.push({
    id: dbId,
    name: labels.database,
    icon: "🎯",
    description: labels.description,
    properties: [
      { id: "sa-name", name: labels.name, type: "text" },
      { id: "sa-course", name: labels.course, type: "text" },
      { id: "sa-weight", name: labels.weight, type: "number" },
      ...(labels.score ? [{ id: "sa-score", name: labels.score, type: "number" as const }] : []),
      { id: "sa-due", name: labels.due, type: "date" },
    ],
    rows,
    views: [
      { id: "v-sa-table", name: labels.table, type: "table" },
      { id: "v-sa-calendar", name: labels.calendar, type: "calendar", datePropertyId: "sa-due" },
    ],
  });
  const home =
    workspace.pages.find((page) => page.id === workspace.homePageId) ?? workspace.pages[0];
  if (home) {
    const blockIds = new Set(home.blocks.map((block) => block.id));
    home.blocks.push(
      {
        id: uniqueId("b-syllabus-heading", blockIds),
        type: "heading",
        level: 2,
        text: `🎯 ${labels.database}`,
      },
      {
        id: uniqueId("b-syllabus-assessments", blockIds),
        type: "database_view",
        databaseId: dbId,
        viewId: "v-sa-table",
      },
    );
  }
}
