/**
 * Reading coursework rows the way a student wrote them, in any of the ten
 * supported languages: which date is the deadline, what the row is called,
 * whether it is an exam, how much it weighs, which course it belongs to and
 * roughly how long it takes. Pure and deterministic.
 */
import type {
  CellValue,
  Database,
  DatabaseProperty,
  DatabaseRow,
  Workspace,
} from "@/lib/workspace/types";
import { pageForDatabase } from "@/lib/workspace/deep-link";
import { titleProperty } from "@/lib/workspace/helpers";
import { completionField, isDayKey, isRowComplete } from "@/lib/workspace/view-logic";
import { findRow } from "@/lib/workspace/row-lookup";
import { matchCategory } from "@/lib/grades/categories";
import { isCreditsColumnName, rowCredits } from "@/lib/grades/workspace";
import type { PlanTarget } from "./types";

const MAX_TEXT = 180;

export function cleanText(value: string): string {
  return value.replace(/\s+/g, " ").trim().slice(0, MAX_TEXT);
}

function norm(value: string): string {
  return value.trim().toLocaleLowerCase();
}

/** Letter/number runs, lower-cased (accents kept). */
export function tokens(value: string): string[] {
  return norm(value).split(/[^\p{L}\p{N}]+/u).filter(Boolean);
}

/** Scripts written without spaces between words (match by substring). */
const NO_SPACE_SCRIPT = /[぀-ヿ㐀-鿿؀-ۿ]/;

/**
 * True when `text` contains one of `words`. Words in scripts without spaces,
 * and Latin words of six letters or more, match inside longer words too
 * ("Abschlussprüfung", "期末考试"); shorter Latin words must be whole words,
 * so "exam" does not match "example".
 */
export function hasWord(text: string, words: readonly string[]): boolean {
  const lower = norm(text);
  const toks = new Set(tokens(text));
  return words.some((word) =>
    NO_SPACE_SCRIPT.test(word) || word.length >= 6 ? lower.includes(word) : toks.has(word),
  );
}

// ---------------------------------------------------------------------------
// Vocabulary

const DUE_PROPERTY_WORDS = [
  "due", "deadline", "exam", "test", "quiz", "date", "when",
  "fecha", "entrega", "vencimiento",
  "frist", "fällig", "abgabe", "termin", "datum",
  "échéance", "echeance", "rendu", "remise",
  "scadenza", "consegna", "data",
  "prazo", "entrega",
  "deadline", "inleveren",
  "日期", "截止", "期限", "締切", "締め切り", "提出",
  "موعد", "تاريخ", "التسليم",
];

const TITLE_PROPERTY_WORDS = [
  "assignment", "task", "name", "title", "exam", "assessment", "item", "topic", "reading",
];

/** Words that mark an exam (title, or a type/category select value). */
const EXAM_WORDS = [
  // en
  "exam", "exams", "examination", "midterm", "midterms", "mid-term", "final", "finals", "test",
  // es
  "examen", "parcial", "prueba",
  // de
  "prüfung", "klausur", "klausuren",
  // fr
  "partiel", "contrôle", "épreuve",
  // it
  "esame", "verifica",
  // pt
  "exame", "prova", "avaliação",
  // nl
  "tentamen", "toets",
  // zh
  "考试", "期中", "期末", "测验", "測驗", "考試",
  // ja
  "試験", "テスト", "中間", "小テスト",
  // ar
  "امتحان", "اختبار", "الامتحان", "الاختبار",
];

/**
 * Words that never make a row an exam even when combined ("test plan", "final
 * draft"). A "Prüfungsvorleistung" is the coursework that admits a student to
 * the exam (problem sets, a lab), not the exam itself.
 */
const NOT_EXAM_WORDS = ["draft", "entwurf", "borrador", "brouillon", "bozza", "rascunho", "concept", "vorleistung"];

/**
 * Exams that decide (most of) a module, the German way: one Klausur or oral
 * exam at the end of the semester is the whole module grade. Practice and
 * mock exams are not ("Probeklausur").
 */
const MODULE_EXAM_WORDS = [
  "klausur", "modulprüfung", "modulabschlussprüfung", "staatsexamen", "abschlussprüfung",
  "mündliche prüfung",
];
const PRACTICE_EXAM_WORDS = ["probeklausur", "übungsklausur", "testklausur", "zwischenklausur"];

/**
 * Administrative deadlines (German "Fristen"): exam registration and
 * deregistration, re-registration and the semester fee, enrolment,
 * applications, BAföG. Minutes of work that cannot be made up afterwards
 * (a missed registration window costs a semester), so the plan treats them as
 * one short thing to finish, never as coursework or exam prep.
 *
 * Stems match inside a word ("Prüfungsanmeldung", "Abmeldefrist",
 * "Klausuranmeldung"); `FORMALITY_WORDS` must be the whole word. Generic
 * words ("Frist", "deadline") are not here: "Abgabefrist Hausarbeit" is
 * coursework. A "Prüfungsvorleistung" is coursework too.
 */
const FORMALITY_STEMS = [
  // de
  "anmeld", "abmeld", "rückmeld", "rueckmeld", "semesterbeitrag", "semesterbeiträg", "einschreib",
  "immatrikul", "exmatrikul", "bewerbung", "kursbelegung", "modulbelegung", "belegungsfrist", "belegfrist",
  "bafög", "bafoeg", "zulassungsantr", "zulassungsfrist",
  // en
  "registration", "enrolment", "enrollment",
  // es, fr, it, pt, nl: exam registration and enrolment
  "inscripción", "matrícula", "inscription", "iscrizion", "inscrição", "inschrijv",
];
const FORMALITY_WORDS = ["register", "deregister", "enrol", "enroll", "tuition", "zulassung", "belegung"];
/** Two-word formalities ("semester fee", "application deadline"). */
const FORMALITY_PAIRS: [string, string[]][] = [
  ["semester", ["fee", "fees", "contribution"]],
  ["application", ["deadline", "deadlines"]],
];
/** Words that contain a stem but are coursework ("Bewerbungsschreiben analysieren"). */
const NOT_FORMALITY_WORDS = ["bewerbungsschreiben", "bewerbungsgespräch", "zulassungsarbeit"];
/** Type/category labels that file a row as a formality ("Fristen", "Organisatorisches"). */
const FORMALITY_TYPE_WORDS = [
  "frist", "fristen", "organisatorisches", "organisatorisch", "formalität", "formalitäten", "formalitaet",
  "formalitaeten", "verwaltung", "admin", "administrative", "administration", "formality", "formalities",
  "paperwork",
];

const TYPE_PROPERTY_WORDS = [
  "type", "kind", "category", "tipo", "typ", "art", "catégorie", "categoria", "soort",
  "类型", "類型", "種類", "タイプ", "النوع",
];

const COURSE_PROPERTY_WORDS = [
  "course", "class", "subject", "module", "unit",
  "curso", "materia", "asignatura",
  "kurs", "fach", "modul",
  "cours", "matière", "matiere",
  "corso", "materia",
  "disciplina", "cadeira",
  "vak",
  "课程", "科目", "課程", "コース", "授業",
  "مادة", "المادة", "مقرر",
];

const WEIGHT_WORDS = [
  "weight", "grade", "percent", "%", "worth",
  "gewicht", "gewichtung", "peso", "poids", "ponderazione", "pondération", "weging",
  "权重", "比重", "重み", "配点", "الوزن",
];

const ESTIMATE_WORDS = [
  "estimate", "effort", "hours", "hrs", "minutes", "mins", "time", "duration",
  "estimación", "horas", "minutos", "aufwand", "stunden", "minuten", "dauer",
  "estimation", "heures", "durée", "stima", "ore", "minuti", "estimativa",
  "uren", "tijd", "预计", "时长", "小时", "所要", "時間", "見積", "الوقت", "ساعات", "دقائق",
];
const HOUR_WORDS = ["hour", "hours", "hrs", "h", "horas", "stunden", "heures", "ore", "uren", "小时", "時間", "ساعات"];

/** Rough effort classes (minutes of total work) by title words. */
const EFFORT_CLASSES: { minutes: number; words: string[] }[] = [
  {
    minutes: 240,
    words: [
      "project", "essay", "paper", "report", "thesis", "presentation", "portfolio",
      "proyecto", "ensayo", "informe", "presentación",
      "projekt", "aufsatz", "hausarbeit", "referat", "bericht", "präsentation",
      "projet", "dissertation", "rapport", "exposé", "mémoire",
      "progetto", "saggio", "relazione", "tesina", "presentazione",
      "projeto", "ensaio", "relatório", "apresentação", "trabalho",
      "verslag", "scriptie", "werkstuk", "presentatie",
      "项目", "论文", "报告", "プロジェクト", "レポート", "論文", "発表", "مشروع", "بحث", "تقرير",
    ],
  },
  {
    minutes: 120,
    words: [
      "assignment", "homework", "problem", "pset", "lab", "worksheet", "exercise", "exercises",
      "tarea", "práctica", "ejercicios", "laboratorio",
      "hausaufgabe", "übung", "übungsblatt", "aufgabe", "labor",
      "devoir", "devoirs", "exercice", "tp", "td",
      "compito", "esercizi", "esercitazione",
      "tarefa", "lista", "exercícios",
      "opdracht", "huiswerk", "practicum",
      "作业", "习题", "実験", "課題", "宿題", "واجب", "تمرين",
    ],
  },
  {
    minutes: 60,
    words: [
      "reading", "read", "chapter", "quiz", "review", "lectura", "capítulo", "lesen", "kapitel",
      "lecture", "chapitre", "lettura", "capitolo", "leitura", "lezen", "hoofdstuk",
      "阅读", "章", "読書", "読む", "قراءة", "فصل",
    ],
  },
];
const DEFAULT_EFFORT = 90;

// ---------------------------------------------------------------------------
// Properties

function sortPreferred(properties: DatabaseProperty[], words: readonly string[]): DatabaseProperty[] {
  return [...properties].sort(
    (a, b) => Number(hasWord(b.name, words)) - Number(hasWord(a.name, words)),
  );
}

function optionLabel(property: DatabaseProperty, value: CellValue | undefined): string[] {
  const ids = Array.isArray(value) ? value : typeof value === "string" ? [value] : [];
  return ids.map((id) => property.options?.find((o) => o.id === id)?.label ?? id);
}

/** A date cell with a wall-clock time and no zone ("2026-11-14T09:30", "2026-11-14 09:30:00"). */
const FLOATING_TIME = /^\d{4}-\d{2}-\d{2}[T ]([01]\d|2[0-3]):([0-5]\d)(?::[0-5]\d(?:\.\d+)?)?$/;

export interface RowDue {
  /** Calendar day, YYYY-MM-DD. */
  day: string;
  /**
   * The time written with the date ("09:30"), when the cell holds one without
   * a zone (the student's own clock, as written). A time with a zone is not
   * read: its day is already taken as written, like everywhere else. Midnight
   * reads as no time, the way date pickers store a plain day.
   */
  time: string | null;
}

/** The row's due day (and time, if written): the first date column, preferring ones named like a deadline. */
export function rowDue(database: Database, row: DatabaseRow): RowDue | null {
  const dates = sortPreferred(
    database.properties.filter((p) => p.type === "date"),
    DUE_PROPERTY_WORDS,
  );
  for (const property of dates) {
    const value = row.cells[property.id];
    if (typeof value !== "string") continue;
    // Tolerate a full ISO timestamp by taking its calendar day.
    const day = value.slice(0, 10);
    if (!isDayKey(day)) continue;
    const clock = FLOATING_TIME.exec(value);
    const time = clock ? `${clock[1]}:${clock[2]}` : null;
    return { day, time: time === "00:00" ? null : time };
  }
  return null;
}

/** The row's due day: the first date column, preferring ones named like a deadline. */
export function rowDueDate(database: Database, row: DatabaseRow): string | null {
  return rowDue(database, row)?.day ?? null;
}

/** The row's name: its title column, else the first text column with a value. */
export function rowTitle(database: Database, row: DatabaseRow): string | null {
  const title = titleProperty(database) as DatabaseProperty | undefined;
  const ordered = [
    ...(title ? [title] : []),
    ...sortPreferred(
      database.properties.filter((p) => p.type === "text" && p.id !== title?.id),
      TITLE_PROPERTY_WORDS,
    ),
  ];
  for (const property of ordered) {
    const value = row.cells[property.id];
    if (typeof value === "string" && cleanText(value)) return cleanText(value);
  }
  return null;
}

/** Grade weight in percent from a number column named like "Weight" / "%". */
export function rowWeight(database: Database, row: DatabaseRow): number | null {
  const property = database.properties.find(
    (p) => p.type === "number" && hasWord(p.name, WEIGHT_WORDS),
  );
  if (!property) return null;
  const value = row.cells[property.id];
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return null;
  // Weights are percent everywhere in the app (the grade calculator, the
  // syllabus import, the generator): 1 is a 1 % item, never 100 %.
  return Math.min(100, Math.round(value * 10) / 10);
}

/** Labels of the row's type/category selects (e.g. "Exam", "Homework"). */
function rowTypeLabels(database: Database, row: DatabaseRow): string[] {
  return database.properties
    .filter(
      (p) =>
        (p.type === "select" || p.type === "multi_select" || p.type === "status") &&
        hasWord(p.name, TYPE_PROPERTY_WORDS),
    )
    .flatMap((p) => optionLabel(p, row.cells[p.id]));
}

/** Type labels that name graded work other than an exam (an explicit type wins over the weight). */
const NON_EXAM_TYPE_WORDS = [
  ...EFFORT_CLASSES[0].words,
  ...EFFORT_CLASSES[1].words,
  "reading", "lectura", "lektüre", "lecture", "lettura", "leitura", "participation", "participación",
  "mitarbeit", "participazione", "participação", "deelname", "参与", "参加", "مشاركة",
  "problem set", "pset", "worksheet", "lab report", "portfolio",
];

/** A weight at or above this (percent) marks a row as a major assessment. */
export const MAJOR_WEIGHT = 20;
/** A weight at or above this (percent) marks the exam that decides a module. */
export const MODULE_WEIGHT = 50;

export interface ExamInfo {
  isExam: boolean;
  /** Finals, midterms and heavily weighted assessments get longer prep. */
  major: boolean;
  /**
   * The exam that decides (most of) a module (see `MODULE_EXAM_WORDS`):
   * prepared over weeks, sized by `examPrepTotalMinutes`. Only present when
   * true. A module exam is always major too.
   */
  module?: true;
}

/** True when a token holds one of the exam words (the `hasWord` rule, per token). */
function isExamToken(token: string): boolean {
  return EXAM_WORDS.some((word) =>
    NO_SPACE_SCRIPT.test(word) || word.length >= 6 ? token.includes(word) : token === word,
  );
}

/** What follows "Rückmeldung" when it means feedback ("Rückmeldung zum Entwurf", "Rückmeldung geben"). */
const FEEDBACK_AFTER = ["zu", "zum", "zur", "von", "vom", "auf", "an", "geben", "einholen", "bekommen", "erhalten"];
/** Words that make "Rückmeldung" the re-enrolment whatever follows it. */
const SEMESTER_WORDS = ["semester", "sose", "wise", "beitrag", "hochschule", "universität", "uni"];

/**
 * German "Rückmeldung" is the re-enrolment for the next semester, and also
 * plain feedback. It is read as feedback (coursework, not a formality) when
 * a word that only fits feedback follows it and nothing in the title speaks
 * of a semester: "Rückmeldung zum Entwurf", but not "Rückmeldung zum
 * Sommersemester".
 */
function isFeedbackRueckmeldung(toks: string[], i: number): boolean {
  if (!/r(ü|ue)ckmeld/.test(toks[i])) return false;
  const next = toks[i + 1];
  if (next === undefined || !FEEDBACK_AFTER.includes(next)) return false;
  return !toks.some((token) => SEMESTER_WORDS.some((word) => token.includes(word)));
}

/** True when the token at `i` names a formality (alone or with the next token). */
function isFormalityToken(toks: string[], i: number): boolean {
  const token = toks[i];
  if (NOT_FORMALITY_WORDS.some((word) => token.startsWith(word))) return false;
  if (FORMALITY_WORDS.includes(token)) return true;
  if (isFeedbackRueckmeldung(toks, i)) return false;
  if (FORMALITY_STEMS.some((stem) => token.includes(stem))) return true;
  const next = toks[i + 1];
  return next !== undefined && FORMALITY_PAIRS.some(([first, seconds]) => token === first && seconds.includes(next));
}

/**
 * Whether a title names an administrative deadline rather than the exam or
 * work it mentions. A title is about its first noun, and a compound about its
 * last part: German "Prüfungsanmeldung" and "Klausuranmeldung" are
 * registrations, "Anmeldung Klausur Analysis" too, but "Klausur Mathe
 * (Anmeldung bis 15.1.)" is the exam. English writes the compound as separate
 * words ("Exam registration closes"). So: take the first run of consecutive
 * words that name an exam or a formality, within the first part of the
 * title that names one (parts end at a comma, colon, bracket, slash or a
 * spaced dash); the title is a formality when any word of that run names
 * one. "Register for final exam" (run: "register"), "Final exam
 * registration" and "Klausur-Anmeldung" (run: both) are formalities; "Final
 * exam, register by Friday" (run: "final exam") is the exam.
 */
export function titleIsFormality(title: string): boolean {
  for (const part of title.split(/[,;:()[\]{}/|]|\s[-–—]\s/)) {
    const toks = tokens(part);
    const marks = toks.map((token, i) => (isFormalityToken(toks, i) ? 2 : isExamToken(token) ? 1 : 0));
    const start = marks.findIndex((mark) => mark > 0);
    if (start < 0) continue;
    for (let i = start; i < marks.length && marks[i] > 0; i += 1) {
      if (marks[i] === 2) return true;
    }
    return false;
  }
  return false;
}

/**
 * Whether a row is an administrative deadline (see `FORMALITY_STEMS`): its
 * type/category says so ("Fristen", "Organisatorisches", "Anmeldung"), or its
 * title does (`titleIsFormality`). A type naming a formality wins over the
 * title; a title naming one wins over a type naming other work, since the
 * student wrote exactly what it is ("Prüfungsanmeldung", filed under "Klausur").
 */
export function isFormality(database: Database, row: DatabaseRow, title: string): boolean {
  const labels = rowTypeLabels(database, row);
  const byType = labels.some((label) => {
    const toks = tokens(label);
    return toks.some((token, i) => FORMALITY_TYPE_WORDS.includes(token) || isFormalityToken(toks, i));
  });
  return byType || titleIsFormality(title);
}

/**
 * The grading category the row counts in, when the database has a grading
 * scheme: placed there by hand, or matched by its title and type labels.
 */
function schemeCategoryName(database: Database, row: DatabaseRow, title: string): string | null {
  const categories = database.grading?.categories ?? [];
  if (categories.length === 0) return null;
  const hand = database.grading?.assign?.[row.id];
  if (hand === "") return null;
  const placed = hand ? categories.find((c) => c.id === hand) : undefined;
  if (placed) return placed.name;
  const labels = database.properties
    .filter((p) => p.type === "select" || p.type === "multi_select")
    .flatMap((p) => optionLabel(p, row.cells[p.id]));
  const matched = matchCategory(title, labels, categories);
  return categories.find((c) => c.id === matched)?.name ?? null;
}

/**
 * Whether a row is an exam, judged by the row itself: its type, its title,
 * the grading category it counts in ("Midterms 40%"), or a heavy weight.
 * Never by the name of the list it sits in: a "Finals Planner" holds study
 * sessions, not finals.
 */
export function classifyExam(
  database: Database,
  row: DatabaseRow,
  title: string,
  weight: number | null,
): ExamInfo {
  // An exam registration is a deadline about an exam, never the exam.
  if (isFormality(database, row, title)) return { isExam: false, major: false };
  const labels = rowTypeLabels(database, row);
  const byType = labels.some((label) => hasWord(label, EXAM_WORDS));
  // A type the student (or the generator) set that names other work
  // ("Homework", "Essay", "Lab report") wins over the title and the weight:
  // a 25 % essay is a big essay, not an exam.
  const otherType = !byType && labels.some((label) => hasWord(label, NON_EXAM_TYPE_WORDS));
  const notExam = hasWord(title, NOT_EXAM_WORDS);
  const byTitle = !otherType && hasWord(title, EXAM_WORDS) && !notExam;
  const category = otherType || notExam ? null : schemeCategoryName(database, row, title);
  const byScheme = category !== null && hasWord(category, EXAM_WORDS);
  const heavy = weight !== null && weight >= MAJOR_WEIGHT;
  const isExam = byType || byTitle || byScheme || (heavy && !otherType);
  const finalWords = ["final", "finals", "midterm", "midterms", "期末", "期中", "abschlussprüfung", "examen final"];
  // The exam that decides a module: half the grade or more, German module
  // wording, or a preparation time the student wrote down themselves.
  const decidesModule =
    isExam &&
    ((weight !== null && weight >= MODULE_WEIGHT) ||
      (hasWord([title, ...labels].join(" "), MODULE_EXAM_WORDS) && !hasWord(title, PRACTICE_EXAM_WORDS)) ||
      rowEstimateMinutes(database, row) !== null);
  return {
    isExam,
    major: isExam && (decidesModule || heavy || hasWord(title, finalWords)),
    ...(decidesModule ? { module: true as const } : {}),
  };
}

/** The course a row belongs to: a course/subject select or relation, if any. */
export function rowCourse(workspace: Workspace, database: Database, row: DatabaseRow): string | null {
  for (const property of database.properties) {
    if (!hasWord(property.name, COURSE_PROPERTY_WORDS)) continue;
    const value = row.cells[property.id];
    if (property.type === "select" || property.type === "multi_select") {
      const label = optionLabel(property, value)[0];
      if (label && cleanText(label)) return cleanText(label);
    } else if (property.type === "relation" && Array.isArray(value) && value[0]) {
      const related = workspace.databases.find((d) => d.id === property.relationDatabaseId);
      const target = related ? findRow(related, value[0]) : undefined;
      const label = related && target ? rowTitle(related, target) : null;
      if (label) return label;
    } else if (property.type === "text" && typeof value === "string" && cleanText(value)) {
      return cleanText(value);
    }
  }
  return null;
}

/** Minutes an administrative deadline takes (a registration, a transfer). */
export const FORMALITY_MINUTES = 10;

/**
 * The student's own estimate for a row, in minutes, from a number column
 * named like an estimate ("Aufwand", "Lernaufwand", "Stunden", "Estimate
 * (hours)"; hours when the name says so), or null when there is none. Weight
 * and credit columns ("Credit hours", "ECTS") are not estimates.
 */
export function rowEstimateMinutes(database: Database, row: DatabaseRow): number | null {
  const estimate = database.properties.find(
    (p) =>
      p.type === "number" &&
      hasWord(p.name, ESTIMATE_WORDS) &&
      !hasWord(p.name, WEIGHT_WORDS) &&
      !isCreditsColumnName(p.name),
  );
  if (!estimate) return null;
  const value = row.cells[estimate.id];
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return null;
  const hours = hasWord(estimate.name, HOUR_WORDS);
  return Math.min(6_000, Math.max(1, Math.round(hours ? value * 60 : value)));
}

/**
 * Estimated total minutes of work for a row: a fixed few minutes for a
 * formality, an estimate column when the student keeps one, else a rough
 * class by title (projects and essays take longer than readings). Heavily
 * weighted work gets more time.
 */
export function estimateEffortMinutes(
  database: Database,
  row: DatabaseRow,
  title: string,
  weight: number | null,
): number {
  // A formality takes minutes, whatever else the row says.
  if (isFormality(database, row, title)) return FORMALITY_MINUTES;
  const estimate = rowEstimateMinutes(database, row);
  if (estimate !== null) return estimate;
  const text = [title, ...rowTypeLabels(database, row)].join(" ");
  const base = EFFORT_CLASSES.find((c) => hasWord(text, c.words))?.minutes ?? DEFAULT_EFFORT;
  return weight !== null && weight >= MAJOR_WEIGHT ? Math.round(base * 1.5) : base;
}

/** A row with a due date and a name, read the way the daily plan reads it. */
export interface DatedRow {
  row: DatabaseRow;
  /** Due day, YYYY-MM-DD. */
  due: string;
  /** Time written with the due date ("09:30"), when there is one (see `RowDue`). */
  time: string | null;
  title: string;
  /** Grade weight in percent, when known. */
  weight: number | null;
  exam: ExamInfo;
  /** An administrative deadline (`isFormality`): never an exam, a few minutes to finish. */
  formality: boolean;
  /** The row is marked done (only ever true with `includeDone`). */
  done: boolean;
  /** The exact row, for a deep link (workspaceHref). */
  target: PlanTarget;
  /** `workspace:database:row`. */
  ledgerKey: string;
}

/**
 * Every row of `database` that has a due date and a name, with its title,
 * weight and exam reading: the one reading of dated coursework that the
 * daily plan and the agenda share, so the two always agree on what is due
 * when and what is an exam. Rows marked done are left out unless
 * `includeDone`. `weightOf` (the grades module) overrides the row's own
 * weight column when it returns a number.
 */
export function datedRows(
  workspace: Workspace,
  database: Database,
  options: {
    weightOf?: (workspace: Workspace, database: Database, row: DatabaseRow) => number | null | undefined;
    includeDone?: boolean;
  } = {},
): DatedRow[] {
  if (!database.properties.some((p) => p.type === "date")) return [];
  const field = completionField(database);
  const pageId = pageForDatabase(workspace, database.id);
  const out: DatedRow[] = [];
  for (const row of database.rows) {
    const done = isRowComplete(database, row, field);
    if (done && !options.includeDone) continue;
    const due = rowDue(database, row);
    if (!due) continue;
    const title = rowTitle(database, row) ?? cleanText(database.name);
    if (!title) continue;
    const weight = options.weightOf?.(workspace, database, row) ?? rowWeight(database, row);
    out.push({
      row,
      due: due.day,
      time: due.time,
      title,
      weight,
      exam: classifyExam(database, row, title, weight),
      formality: isFormality(database, row, title),
      done,
      target: {
        workspaceId: workspace.id,
        ...(pageId ? { pageId } : {}),
        databaseId: database.id,
        rowId: row.id,
      },
      ledgerKey: `${workspace.id}:${database.id}:${row.id}`,
    });
  }
  return out;
}

/** Total prep minutes for a quiz, midterm or final, spread over the days before it. */
export function examPrepMinutes(major: boolean, weight: number | null): number {
  if (weight !== null && weight >= 35) return 480;
  return major ? 360 : 180;
}

/**
 * Module exam preparation. German module handbooks budget about 30 hours of
 * exam preparation ("Prüfungsvorbereitung 30 h") for a 5 ECTS module, i.e.
 * 6 hours per credit point, within a module's 25-30 hours of work per credit.
 * Clamped so a 1-credit module still gets real preparation and a 20-credit
 * one does not swallow the semester break.
 */
export const MODULE_PREP_MINUTES_PER_CREDIT = 6 * 60;
export const MODULE_PREP_MIN_MINUTES = 10 * 60;
export const MODULE_PREP_MAX_MINUTES = 60 * 60;
/** Without credits or an estimate: the handbook's 30 hours for a 5 ECTS module. */
export const MODULE_PREP_DEFAULT_MINUTES = 30 * 60;

/**
 * Total preparation for an exam. A module exam: the student's own estimate
 * column when the row has one, else 6 hours per ECTS credit of its course
 * (clamped to 10-60 hours), else 30 hours. Any other exam: `examPrepMinutes`.
 */
export function examPrepTotalMinutes(
  workspace: Workspace,
  database: Database,
  row: DatabaseRow,
  exam: ExamInfo,
  weight: number | null,
): number {
  if (!exam.module) return examPrepMinutes(exam.major, weight);
  const estimate = rowEstimateMinutes(database, row);
  if (estimate !== null) return estimate;
  const credits = rowCredits(workspace, database, row);
  if (credits !== null) {
    return Math.min(
      MODULE_PREP_MAX_MINUTES,
      Math.max(MODULE_PREP_MIN_MINUTES, Math.round(credits * MODULE_PREP_MINUTES_PER_CREDIT)),
    );
  }
  return MODULE_PREP_DEFAULT_MINUTES;
}

const COURSE_STOP_WORDS = new Set([
  ...EXAM_WORDS,
  "the", "and", "for", "of", "on", "in", "to", "a", "an", "on",
  "de", "del", "la", "le", "les", "el", "der", "die", "das", "und", "di", "da", "do", "het", "een", "van",
  "unit", "chapter", "week", "part", "review",
]);

/** Significant words of a course or exam title, for matching decks and quizzes. */
export function courseKeywords(text: string): string[] {
  const out = new Set<string>();
  for (const token of tokens(text)) {
    if (/^\d+$/.test(token)) continue;
    if (COURSE_STOP_WORDS.has(token)) continue;
    if (NO_SPACE_SCRIPT.test(token) ? token.length >= 2 : token.length >= 3) out.add(token);
  }
  return [...out];
}

/** True when `text` mentions any of the keywords. */
export function mentions(text: string, keywords: string[]): boolean {
  if (keywords.length === 0) return false;
  const lower = norm(text);
  const toks = new Set(tokens(text));
  return keywords.some((k) => toks.has(k) || (NO_SPACE_SCRIPT.test(k) && lower.includes(k)));
}
