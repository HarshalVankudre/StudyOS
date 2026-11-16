/**
 * The agenda: what is dated in the student's workspaces over the next two
 * weeks, plus what is still open from the two weeks before, day by day.
 *
 * Pure and deterministic, no AI. Rows are read with the daily plan's own
 * reader (`datedRows` in lib/agents/daily-study/classify), so the agenda and
 * Today always agree on what is due when, what counts as an exam, what is
 * done and where its link goes. Undated work (to-dos, flashcard decks,
 * quizzes) has no day to sit on and is not part of it.
 */
import { cleanText, datedRows, rowCourse } from "@/lib/agents/daily-study/classify";
import { OVERDUE_WINDOW_DAYS, type WeightResolver } from "@/lib/agents/daily-study/planner";
import { workspaceHref } from "@/lib/workspace/deep-link";
import type { Workspace } from "@/lib/workspace/types";
import { addDays } from "@/lib/workspace/view-logic";

/** Days shown ahead, today included. */
export const AGENDA_DAYS = 14;
/** Open work due up to this many days ago shows as overdue: the plan's own window. */
export const OVERDUE_DAYS = OVERDUE_WINDOW_DAYS;

/** The daily plan's kinds of dated work (to-dos have no date). */
export type AgendaKind = "exam" | "deadline";

/** Within a day: exams first, then deadlines. */
const KIND_ORDER: Record<AgendaKind, number> = { exam: 0, deadline: 1 };

export interface AgendaItem {
  /**
   * The id Today uses for the same row (`deadline:<ws>:<db>:<row>`, or the
   * exam countdown's `exam:<ws>:<db>:<row>`): also the focus timer's item key.
   */
  id: string;
  kind: AgendaKind;
  /** An administrative deadline (registration, re-registration, fee): tagged "Frist". Only present when true. */
  formality?: true;
  /** The student's own words, never translated. */
  title: string;
  /** Local due day, YYYY-MM-DD. */
  date: string;
  /** "HH:MM" when the row gives a time. */
  time: string | null;
  done: boolean;
  workspaceId: string;
  workspaceName: string;
  workspaceIcon: string | null;
  /** The row's own course column, when it names one the title and workspace do not. */
  subject: string | null;
  /** The table the row sits in. */
  source: string;
  /** Deep link to the row, the same as Today's. */
  href: string;
}

/** A workspace, as a course to filter by. */
export interface AgendaCourse {
  id: string;
  name: string;
  icon: string | null;
}

function mentions(text: string, part: string): boolean {
  return text.toLocaleLowerCase().includes(part.toLocaleLowerCase());
}

/**
 * Every dated row of `workspaces` from OVERDUE_DAYS before `today` (the
 * student's local day) to the last day of the agenda. Done rows are kept
 * (the page can show them) except in the past, where only open deadlines
 * count: an exam that has passed is over, not overdue, as in the plan.
 */
export function collectAgendaItems(
  workspaces: Workspace[],
  today: string,
  options: { weightOf?: WeightResolver } = {},
): AgendaItem[] {
  const from = addDays(today, -OVERDUE_DAYS);
  const to = addDays(today, AGENDA_DAYS - 1);
  const items: AgendaItem[] = [];
  for (const workspace of workspaces) {
    const workspaceName = cleanText(workspace.name);
    for (const database of workspace.databases) {
      for (const dated of datedRows(workspace, database, { weightOf: options.weightOf, includeDone: true })) {
        if (dated.due < from || dated.due > to) continue;
        const kind: AgendaKind = dated.exam.isExam ? "exam" : "deadline";
        if (dated.due < today && (dated.done || kind === "exam")) continue;
        const course = rowCourse(workspace, database, dated.row);
        const subject =
          course && !mentions(dated.title, course) && !mentions(workspaceName, course) ? course : null;
        items.push({
          id: `${kind}:${dated.ledgerKey}`,
          kind,
          ...(dated.formality ? { formality: true as const } : {}),
          title: dated.title,
          date: dated.due,
          time: dated.time,
          done: dated.done,
          workspaceId: workspace.id,
          workspaceName,
          workspaceIcon: workspace.icon ?? null,
          subject,
          source: cleanText(database.name),
          href: workspaceHref(dated.target),
        });
      }
    }
  }
  return items;
}

/** Day order, then exams before deadlines, then timed ones by time (untimed last), then title. */
export function compareAgendaItems(a: AgendaItem, b: AgendaItem): number {
  if (a.date !== b.date) return a.date < b.date ? -1 : 1;
  const kind = KIND_ORDER[a.kind] - KIND_ORDER[b.kind];
  if (kind !== 0) return kind;
  if (a.time !== b.time) {
    if (a.time === null) return 1;
    if (b.time === null) return -1;
    return a.time < b.time ? -1 : 1;
  }
  return a.title.localeCompare(b.title) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

export interface AgendaParams {
  /** Workspace id to show alone, or null for every course. */
  course: string | null;
  showDone: boolean;
}

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** The page's URL parameters: `?course=<workspace id>&done=1`. */
export function parseAgendaParams(params: { course?: string | string[]; done?: string | string[] }): AgendaParams {
  const course = first(params.course)?.trim();
  return {
    course: course && course.length <= 200 ? course : null,
    showDone: first(params.done) === "1",
  };
}

/** The agenda page's URL for these parameters (a linkable view). */
export function agendaHref(params: AgendaParams): string {
  const query = new URLSearchParams();
  if (params.course) query.set("course", params.course);
  if (params.showDone) query.set("done", "1");
  const text = query.toString();
  return text ? `/app/agenda?${text}` : "/app/agenda";
}

export interface AgendaDay {
  date: string;
  items: AgendaItem[];
}

export interface Agenda {
  today: string;
  /** The course shown alone: one of the student's workspaces, else null. */
  course: AgendaCourse | null;
  showDone: boolean;
  /** Open work from before today, oldest first. */
  overdue: AgendaItem[];
  /** Today and the AGENDA_DAYS - 1 days after it, each with its items (possibly none). */
  days: AgendaDay[];
  /** Items shown, overdue included. */
  total: number;
  /** Courses to filter by: those with something to show, and the one chosen. By name. */
  courses: AgendaCourse[];
}

/**
 * Group the agenda for display: overdue first, then day by day, each day in
 * `compareAgendaItems` order, filtered to one course and to open work unless
 * `showDone`. A course that is not one of `courses` shows every course.
 */
export function buildAgenda(
  items: AgendaItem[],
  courses: AgendaCourse[],
  today: string,
  params: AgendaParams,
): Agenda {
  const course = courses.find((c) => c.id === params.course) ?? null;
  const inCourse = course ? items.filter((item) => item.workspaceId === course.id) : items;
  const shown = (params.showDone ? inCourse : inCourse.filter((item) => !item.done)).slice().sort(compareAgendaItems);

  const overdue = shown.filter((item) => item.date < today && !item.done);
  const days: AgendaDay[] = Array.from({ length: AGENDA_DAYS }, (_, i) => ({ date: addDays(today, i), items: [] }));
  const byDate = new Map(days.map((day) => [day.date, day]));
  for (const item of shown) byDate.get(item.date)?.items.push(item);

  const visible = new Set(
    items.filter((item) => params.showDone || !item.done).map((item) => item.workspaceId),
  );
  const pills = courses
    .filter((c) => visible.has(c.id) || c.id === course?.id)
    .sort((a, b) => a.name.localeCompare(b.name) || (a.id < b.id ? -1 : 1));

  return {
    today,
    course,
    showDone: params.showDone,
    overdue,
    days,
    total: overdue.length + days.reduce((sum, day) => sum + day.items.length, 0),
    courses: pills,
  };
}
