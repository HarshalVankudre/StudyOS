/**
 * Turning a structured plan into words, in the student's language, at display
 * time. Nothing here is stored, so switching language re-renders the whole
 * plan in the new language. The student's own titles are never translated.
 *
 * Pure: takes the active dictionary section, so server and client components
 * can both use it.
 */
import type { Dictionary } from "@/lib/i18n/dictionaries/en";
import { fmt } from "@/lib/i18n/interpolate";
import { workspaceHref } from "@/lib/workspace/deep-link";
import {
  RESTART_AFTER_CARRIES,
  type DailyStudyPlanItem,
  type ExamCountdown,
  type RunSummary,
  type Workload,
} from "./types";

export type TodayCopy = Dictionary["today"];

export function plural(count: number, one: string, other: string): string {
  return fmt(count === 1 ? one : other, { count });
}

/** "25 min", "1 h", "1 h 30 min". */
export function formatDuration(minutes: number, T: TodayCopy): string {
  const m = Math.max(0, Math.round(minutes));
  if (m < 60) return fmt(T.minutes, { count: m });
  const h = Math.floor(m / 60);
  const rest = m % 60;
  // Round to the nearest 5 minutes beyond an hour; nobody plans "1 h 2 min".
  const rounded = Math.round(rest / 5) * 5;
  if (rounded === 0) return fmt(T.hours, { count: h });
  if (rounded === 60) return fmt(T.hours, { count: h + 1 });
  return fmt(T.hoursMinutes, { h, m: rounded });
}

function dayDate(day: string): Date {
  return new Date(`${day}T12:00:00.000Z`);
}

/** "12 Nov" in the student's language. */
export function formatDay(day: string, locale: string): string {
  return dayDate(day).toLocaleDateString(locale, { month: "short", day: "numeric", timeZone: "UTC" });
}

/** "Thursday" in the student's language. */
export function formatWeekday(day: string, locale: string): string {
  return dayDate(day).toLocaleDateString(locale, { weekday: "long", timeZone: "UTC" });
}

/** "Thursday, 12 November" in the student's language. */
export function formatLongDay(day: string, locale: string): string {
  return dayDate(day).toLocaleDateString(locale, {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}

export function itemTitle(item: DailyStudyPlanItem, T: TodayCopy): string {
  switch (item.kind) {
    case "flashcards":
      return fmt(T.titleFlashcards, { title: item.title });
    case "quiz":
      return fmt(T.titleQuiz, { title: item.title });
    case "exam":
      return item.target.blockId
        ? fmt(T.titleFlashcards, { title: item.title })
        : fmt(T.titleExamNotes, { title: item.title });
    default:
      return item.title;
  }
}

export function kindLabel(item: DailyStudyPlanItem, T: TodayCopy): string {
  switch (item.kind) {
    case "deadline":
      return T.kindDeadline;
    case "exam":
      return T.kindExam;
    case "flashcards":
      return T.kindFlashcards;
    case "quiz":
      return T.kindQuiz;
    case "task":
      return T.kindTask;
  }
}

/** Why this item is on today's plan. */
export function itemReason(item: DailyStudyPlanItem, T: TodayCopy, locale: string): string {
  const { reason } = item;
  const days = reason.days ?? 0;
  const date = item.dueDate ? formatDay(item.dueDate, locale) : "";
  const exam = reason.examTitle ?? item.title;
  switch (reason.code) {
    case "overdue":
      return fmt(T.reasonOverdue, { date });
    case "due_today":
      return T.reasonDueToday;
    case "due_tomorrow":
      return T.reasonDueTomorrow;
    case "due_soon":
      return fmt(T.reasonDueSoon, { days });
    case "due_later":
      return fmt(T.reasonDueLater, { date });
    case "start_early":
      return fmt(T.reasonStartEarly, {
        time: formatDuration(reason.effortMinutes ?? item.minutes, T),
        date,
      });
    case "exam_today":
      return fmt(T.reasonExamToday, { exam });
    case "exam_tomorrow":
      return fmt(T.reasonExamTomorrow, { exam });
    case "exam_review":
      return fmt(T.reasonExamReview, { exam, days });
    case "cards_due":
      return plural(reason.count ?? item.dueCount ?? 0, T.reasonCardsDueOne, T.reasonCardsDueOther);
    case "new_cards":
      return plural(reason.count ?? item.dueCount ?? 0, T.reasonNewCardsOne, T.reasonNewCardsOther);
    case "open_task":
      return fmt(T.reasonOpenTask, { page: item.section || item.workspaceName });
  }
}

/** Extra gentle notes: grade weight, rolled forward, restart small. */
export function itemNotes(item: DailyStudyPlanItem, T: TodayCopy, locale: string): string[] {
  const notes: string[] = [];
  if (item.weight) notes.push(fmt(T.weight, { weight: formatNumber(item.weight, locale) }));
  if (item.carry && !item.completed) {
    notes.push(
      item.carry.count >= RESTART_AFTER_CARRIES && item.mode !== "study"
        ? fmt(T.restartSmall, { time: formatDuration(item.minutes, T) })
        : fmt(T.movedFrom, { day: formatWeekday(item.carry.from, locale) }),
    );
  }
  return notes;
}

export function itemSource(item: DailyStudyPlanItem): string {
  return [item.workspaceName, item.section].filter(Boolean).join(" · ");
}

export function itemHref(item: Pick<DailyStudyPlanItem, "target">): string {
  return workspaceHref(item.target);
}

export function examCountdownLabel(exam: ExamCountdown, T: TodayCopy): string {
  if (exam.days <= 0) return T.examToday;
  if (exam.days === 1) return T.examTomorrow;
  return fmt(T.examIn, { count: exam.days });
}

export function workloadText(
  workload: Workload,
  T: TodayCopy,
): { title: string; body: string; start: string | null } {
  const titles = workload.startToday.map((title) => fmt(T.quoted, { title }));
  return {
    title: fmt(T.overloadTitle, { days: workload.days }),
    body: fmt(T.overloadBody, {
      needed: formatDuration(workload.neededMinutes, T),
      available: formatDuration(workload.availableMinutes, T),
    }),
    start: titles.length > 0 ? fmt(T.overloadStart, { titles: titles.join(T.listSeparator) }) : null,
  };
}

export function runSummaryText(summary: RunSummary, T: TodayCopy): string {
  if (summary.items === 0) return T.runSummaryEmpty;
  const base = fmt(summary.items === 1 ? T.runSummaryOne : T.runSummaryOther, {
    count: summary.items,
    time: formatDuration(summary.minutes, T),
  });
  return summary.overloaded ? `${base} · ${T.runSummaryOverload}` : base;
}

export interface PlanTotals {
  total: number;
  done: number;
  minutes: number;
  minutesLeft: number;
}

export function planTotals(items: DailyStudyPlanItem[]): PlanTotals {
  let done = 0;
  let minutes = 0;
  let minutesLeft = 0;
  for (const item of items) {
    minutes += item.minutes;
    if (item.completed) done += 1;
    else minutesLeft += item.minutes;
  }
  return { total: items.length, done, minutes, minutesLeft };
}

function formatNumber(value: number, locale: string): string {
  return value.toLocaleString(locale, { maximumFractionDigits: 1 });
}
