/**
 * Deterministic finishing touches on a freshly generated workspace, for the
 * things a model gets wrong often enough that the prompt alone is not a
 * guarantee:
 *
 *   - a separate "Grade Tracker" table competing with the grades block is
 *     removed (when it holds no deadlines) and replaced by a grades block;
 *   - a page's first heading that only repeats the page title is dropped;
 *   - ISO dates in prose ("2026-12-03" in a callout or card) are written as
 *     natural dates in the student's language;
 *   - rows with an empty status start in the open state ("Not started");
 *   - the dashboard gets a "This week" list (due in the next 7 days, not
 *     done) over the deadlines database;
 *   - pages without an icon get one.
 *
 * Date cells, ids and structure are never changed. Pure: returns a new
 * workspace.
 */
import type {
  Block,
  Database,
  DatabaseView,
  GradesBlock,
  Page,
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
  };
}

export function polishGeneratedWorkspace(workspace: Workspace, options: PolishOptions): Workspace {
  const next = structuredClone(workspace);
  dropCompetingGradeTables(next, options.labels.gradesTitle);
  for (const page of next.pages) stripTitleHeading(page);
  naturalDates(next, options.locale, options.today);
  for (const db of next.databases) openStatusDefaults(db);
  ensureThisWeek(next, options.labels.thisWeek);
  pageIcons(next);
  return next;
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
// Icons

function pageIcons(workspace: Workspace) {
  workspace.icon ||= "🎓";
  for (const page of workspace.pages) {
    if (page.icon?.trim()) continue;
    page.icon = page.id === workspace.homePageId ? "🏠" : "📄";
  }
}
