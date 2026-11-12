/**
 * Which columns of a database receive an imported deadline's fields, and how
 * a feed's course name finds (or becomes) one of the student's courses.
 * Pure: shared by the import dialog, the re-sync and the tests.
 */
import { titleProperty } from "@/lib/workspace/helpers";
import { completionField } from "@/lib/workspace/view-logic";
import type { Database, DatabaseProperty, PropertyType, Workspace } from "@/lib/workspace/types";

export type MappedField = "title" | "due" | "course" | "link" | "status";

/** "new" = create a suitable column on import. */
export type ColumnChoice = string | "new" | null;

export interface FeedMapping {
  title: string | null;
  due: ColumnChoice;
  course: ColumnChoice;
  link: ColumnChoice;
  status: string | null;
}

/** Property types each field may be written to. */
export const FIELD_TYPES: Record<MappedField, PropertyType[]> = {
  title: ["text"],
  due: ["date"],
  course: ["select", "multi_select", "relation", "text"],
  link: ["url", "text"],
  status: ["status", "select", "checkbox"],
};

const DUE_WORDS = [
  "due", "deadline", "date", "fällig", "abgabe", "frist", "termin", "entrega", "vencimiento", "fecha",
  "échéance", "rendu", "date limite", "scadenza", "consegna", "prazo", "data", "inleverdatum", "deadline",
  "截止", "期限", "日期", "締切", "締め切り", "提出日", "موعد", "تاريخ",
];
const COURSE_WORDS = [
  "course", "class", "subject", "module", "unit", "kurs", "fach", "modul", "lehrveranstaltung", "curso",
  "asignatura", "materia", "cours", "matière", "corso", "insegnamento", "disciplina", "cadeira", "vak",
  "cursus", "课程", "科目", "コース", "授業", "مقرر", "مادة", "مساق",
];
const LINK_WORDS = ["link", "url", "website", "enlace", "lien", "collegamento", "ligação", "链接", "リンク", "رابط"];

function nameMatches(prop: DatabaseProperty, words: string[]): boolean {
  const name = prop.name.trim().toLocaleLowerCase();
  return words.some((w) => name === w || name.includes(w));
}

function firstOf(db: Database, types: PropertyType[], words: string[], excluded: Set<string>): DatabaseProperty | undefined {
  const candidates = db.properties.filter((p) => types.includes(p.type) && !excluded.has(p.id));
  for (const type of types) {
    const named = candidates.find((p) => p.type === type && nameMatches(p, words));
    if (named) return named;
  }
  return undefined;
}

/** A best guess at the mapping for this database; the student can change it. */
export function detectMapping(db: Database): FeedMapping {
  const title = titleProperty(db);
  const titleId = title && title.type === "text" ? title.id : null;
  const used = new Set<string>(titleId ? [titleId] : []);

  const dates = db.properties.filter((p) => p.type === "date");
  const due = dates.find((p) => nameMatches(p, DUE_WORDS)) ?? dates[0];
  if (due) used.add(due.id);

  const course = firstOf(db, ["select", "relation", "multi_select", "text"], COURSE_WORDS, used);
  if (course) used.add(course.id);

  const link =
    db.properties.find((p) => p.type === "url" && !used.has(p.id)) ??
    firstOf(db, ["text"], LINK_WORDS, used);
  if (link) used.add(link.id);

  const completion = completionField(db);
  const status =
    (completion && !used.has(completion.property.id) ? completion.property : undefined) ??
    db.properties.find((p) => p.type === "status" && !used.has(p.id));

  return {
    title: titleId,
    due: due?.id ?? "new",
    course: course?.id ?? null,
    link: link?.id ?? null,
    status: status?.id ?? null,
  };
}

/** True when `choice` still names a column of the right type in `db`. */
export function isValidChoice(db: Database, field: MappedField, choice: ColumnChoice): boolean {
  if (choice === null) return field !== "title";
  if (choice === "new") return field === "due" || field === "course" || field === "link";
  const prop = db.properties.find((p) => p.id === choice);
  return Boolean(prop && FIELD_TYPES[field].includes(prop.type));
}

/** Keep the valid parts of a saved mapping and fill the rest from detection. */
export function reconcileMapping(db: Database, saved: Partial<FeedMapping> | undefined): FeedMapping {
  const detected = detectMapping(db);
  const out = { ...detected };
  if (!saved) return out;
  for (const field of ["title", "due", "course", "link", "status"] as MappedField[]) {
    const choice = saved[field];
    if (choice !== undefined && isValidChoice(db, field, choice)) {
      (out as Record<MappedField, ColumnChoice>)[field] = choice;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Courses

/** "CS101-001-FA26" / "cs 101" / "MATH-2410H: Calculus" → "CS 101" / "MATH 2410H". */
export function courseCode(text: string): string | null {
  const m = /(?:^|[^A-Za-z])([A-Za-z]{2,6})[\s_.-]?(\d{2,4}[A-Za-z]?)(?![0-9])/.exec(text);
  if (!m) return null;
  return `${m[1].toUpperCase()} ${m[2].toUpperCase()}`;
}

export function normalizeLabel(text: string): string {
  return text
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[\s_\-–—:.,()[\]]+/g, " ")
    .trim();
}

/** Shorter label for a new course option: the code when there is one, else the name. */
export function courseLabel(feedCourse: string): string {
  return courseCode(feedCourse) ?? feedCourse.trim().slice(0, 80);
}

/**
 * The existing label that names the same course as `feedCourse`, matching by
 * course code ("CS101-001-FA26" ↔ "CS 101") or by name, ignoring case and
 * punctuation. Returns the index into `labels`, or -1.
 */
export function matchCourse(feedCourse: string, labels: string[]): number {
  const wanted = normalizeLabel(feedCourse);
  if (!wanted) return -1;
  const exact = labels.findIndex((l) => normalizeLabel(l) === wanted);
  if (exact !== -1) return exact;
  const code = courseCode(feedCourse);
  if (code) {
    const byCode = labels.findIndex((l) => courseCode(l) === code);
    if (byCode !== -1) return byCode;
  }
  // "Introduction to Psychology (PSY 100)" vs an option "Introduction to Psychology".
  return labels.findIndex((l) => {
    const n = normalizeLabel(l);
    return n.length >= 6 && (wanted.startsWith(`${n} `) || wanted.endsWith(` ${n}`) || n.startsWith(`${wanted} `));
  });
}

/** Labels of the rows of a relation's target database (by its title column). */
export function relationLabels(workspace: Workspace, prop: DatabaseProperty): { db: Database; labels: string[] } | null {
  const target = workspace.databases.find((d) => d.id === prop.relationDatabaseId);
  if (!target) return null;
  const title = titleProperty(target);
  // A courses table often keeps the code in its own column ("Code").
  const code = target.properties.find((p) => p.type === "text" && p.id !== title?.id && /code|kürzel|código|codice|code|代码|コード|رمز/i.test(p.name));
  const labels = target.rows.map((row) => {
    const name = title ? row.cells[title.id] : null;
    const extra = code ? row.cells[code.id] : null;
    return [typeof name === "string" ? name : "", typeof extra === "string" ? extra : ""].filter(Boolean).join(" · ");
  });
  return { db: target, labels };
}
