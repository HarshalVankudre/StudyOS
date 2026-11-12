/**
 * Sample content for the landing page's product renderings. Dates are
 * relative to the day the page is rendered, so the samples never go stale,
 * and every sentence around the student's own titles comes from the same
 * dictionary strings and presenters the app uses (lib/agents/daily-study/
 * present, lib/grades). Pure, so it is tested directly.
 */
import type { DailyStudyPlanItem, ExamCountdown, Workload } from "@/lib/agents/daily-study/types";
import { computeCourseGrade, type CourseGrade } from "@/lib/grades/calc";
import type { Dictionary } from "@/lib/i18n/dictionaries/en";
import { shiftDay } from "@/lib/study/days";

type Samples = Dictionary["landing"]["samples"];

const target = (id: string) => ({ workspaceId: "sample", pageId: id });

/** Today's sample plan: two items carried over from a missed day. */
export function sampleTodayItems(S: Samples, today: string): DailyStudyPlanItem[] {
  const twoDaysAgo = shiftDay(today, -2);
  return [
    {
      id: "lab",
      kind: "deadline",
      mode: "session",
      title: S.items.labReport,
      workspaceName: S.workspace,
      section: S.assignments,
      target: target("assignments"),
      minutes: 45,
      reason: { code: "due_tomorrow", days: 1 },
      weight: 15,
      dueDate: shiftDay(today, 1),
      carry: { from: twoDaysAgo, count: 1 },
      startHere: true,
      completed: false,
    },
    {
      id: "deck",
      kind: "flashcards",
      mode: "study",
      title: S.items.deck,
      workspaceName: S.workspace,
      section: S.courses.bio,
      target: target("bio"),
      minutes: 15,
      reason: { code: "cards_due", count: 24 },
      dueCount: 24,
      completed: false,
    },
    {
      id: "midterm",
      kind: "exam",
      mode: "session",
      title: S.items.midterm,
      workspaceName: S.workspace,
      section: S.exams,
      target: target("exams"),
      minutes: 25,
      reason: { code: "exam_review", days: 9, examTitle: S.items.midterm },
      completed: false,
    },
    {
      id: "pset",
      kind: "deadline",
      mode: "session",
      title: S.items.problemSet,
      workspaceName: S.workspace,
      section: S.assignments,
      target: target("assignments"),
      minutes: 30,
      reason: { code: "due_soon", days: 4 },
      dueDate: shiftDay(today, 4),
      carry: { from: twoDaysAgo, count: 1 },
      completed: true,
    },
  ];
}

export function sampleExams(S: Samples, today: string): ExamCountdown[] {
  return [
    { id: "midterm", title: S.items.midterm, workspaceName: S.workspace, date: shiftDay(today, 9), days: 9, major: true, target: target("exams") },
    { id: "stats", title: S.items.statsExam, workspaceName: S.workspace, date: shiftDay(today, 16), days: 16, major: true, target: target("exams") },
  ];
}

/** A heads-up the planner would raise: more due soon than 2 h a day gives. */
export function sampleWorkload(S: Samples): Workload {
  return {
    overloaded: true,
    days: 5,
    neededMinutes: 720,
    availableMinutes: 600,
    startToday: [S.items.essay],
  };
}

export interface SampleGrade {
  rows: { name: string; weight: number; score: number | null }[];
  grade: CourseGrade;
  /** The target the outlook is computed for, in percent (a US B+). */
  target: number;
}

/** A course two-thirds through the term, computed with the real grade math. */
export function sampleGrade(S: Samples): SampleGrade {
  const rows = [
    { name: S.grades.problemSets, weight: 20, score: 92 },
    { name: S.grades.labs, weight: 15, score: 88 },
    { name: S.grades.midterm, weight: 25, score: 81 },
    { name: S.grades.final, weight: 40, score: null },
  ];
  const target = 87;
  const grade = computeCourseGrade(
    rows.map((r, i) => ({ id: String(i), name: r.name, weight: r.weight, score: r.score, maxScore: null })),
    { target },
  );
  return { rows, grade, target };
}

/** "Friday" in the visitor's language, `n` days from `today`. */
export function weekdayIn(today: string, n: number, locale: string): string {
  return new Date(`${shiftDay(today, n)}T12:00:00.000Z`).toLocaleDateString(locale, {
    weekday: "long",
    timeZone: "UTC",
  });
}

/** The local day the page is rendered for (UTC; samples only). */
export function renderDay(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}
