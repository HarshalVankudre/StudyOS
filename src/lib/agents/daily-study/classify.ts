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
import { titleProperty } from "@/lib/workspace/helpers";
import { isDayKey } from "@/lib/workspace/view-logic";
import { findRow } from "@/lib/workspace/row-lookup";

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

/** Words that never make a row an exam even when combined ("test plan", "final draft"). */
const NOT_EXAM_WORDS = ["draft", "entwurf", "borrador", "brouillon", "bozza", "rascunho", "concept"];

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

/** The row's due day: the first date column, preferring ones named like a deadline. */
export function rowDueDate(database: Database, row: DatabaseRow): string | null {
  const dates = sortPreferred(
    database.properties.filter((p) => p.type === "date"),
    DUE_PROPERTY_WORDS,
  );
  for (const property of dates) {
    const value = row.cells[property.id];
    if (typeof value !== "string") continue;
    // Tolerate a full ISO timestamp by taking its calendar day.
    const day = value.slice(0, 10);
    if (isDayKey(day)) return day;
  }
  return null;
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
  // A weight written as a fraction (0.25) means 25%.
  const percent = value <= 1 ? value * 100 : value;
  return Math.min(100, Math.round(percent * 10) / 10);
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

export interface ExamInfo {
  isExam: boolean;
  /** Finals, midterms and heavily weighted assessments get longer prep. */
  major: boolean;
}

export function classifyExam(
  database: Database,
  row: DatabaseRow,
  title: string,
  weight: number | null,
): ExamInfo {
  const labels = rowTypeLabels(database, row);
  const byType = labels.some((label) => hasWord(label, EXAM_WORDS));
  // A type the student (or the generator) set that names other work
  // ("Homework", "Essay", "Lab report") wins over the title and the weight:
  // a 25 % essay is a big essay, not an exam.
  const otherType = !byType && labels.some((label) => hasWord(label, NON_EXAM_TYPE_WORDS));
  const byTitle = !otherType && hasWord(title, EXAM_WORDS) && !hasWord(title, NOT_EXAM_WORDS);
  const byDatabase =
    labels.length === 0 && hasWord(database.name, EXAM_WORDS) && !hasWord(title, NOT_EXAM_WORDS);
  const heavy = weight !== null && weight >= MAJOR_WEIGHT;
  const isExam = byType || byTitle || byDatabase || (heavy && !otherType);
  const finalWords = ["final", "finals", "midterm", "midterms", "期末", "期中", "abschlussprüfung", "examen final"];
  return { isExam, major: isExam && (heavy || hasWord(title, finalWords)) };
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

/**
 * Estimated total minutes of work for a row: an estimate column when the
 * student keeps one, else a rough class by title (projects and essays take
 * longer than readings). Heavily weighted work gets more time.
 */
export function estimateEffortMinutes(
  database: Database,
  row: DatabaseRow,
  title: string,
  weight: number | null,
): number {
  const estimate = database.properties.find(
    (p) => p.type === "number" && hasWord(p.name, ESTIMATE_WORDS) && !hasWord(p.name, WEIGHT_WORDS),
  );
  if (estimate) {
    const value = row.cells[estimate.id];
    if (typeof value === "number" && Number.isFinite(value) && value > 0) {
      const hours = hasWord(estimate.name, HOUR_WORDS);
      return Math.min(6_000, Math.round(hours ? value * 60 : value));
    }
  }
  const text = [title, ...rowTypeLabels(database, row)].join(" ");
  const base = EFFORT_CLASSES.find((c) => hasWord(text, c.words))?.minutes ?? DEFAULT_EFFORT;
  return weight !== null && weight >= MAJOR_WEIGHT ? Math.round(base * 1.5) : base;
}

/** Total prep minutes for an exam, spread over the days before it. */
export function examPrepMinutes(major: boolean, weight: number | null): number {
  if (weight !== null && weight >= 35) return 480;
  return major ? 360 : 180;
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
