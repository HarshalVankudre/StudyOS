/**
 * Study insights: how a student's studying went over a period (the last 7,
 * 30 or 90 local days) and how that compares with the period before it.
 *
 * Pure (no Prisma, no browser APIs): the loader (./insights-store) reads small
 * per-day and per-course sums, and everything the page and the CSV show is
 * worked out here, so it can be tested without a database. Days are the
 * student's LOCAL calendar days as YYYY-MM-DD strings (see ./days), exactly
 * as they were stored: a StudyDay row counts for the day the browser answered
 * on, a focus session for the day it started on. Nothing is re-bucketed, so a
 * DST change or a trip to another zone never moves past study between days.
 *
 * Definitions used across the page:
 *  - Active day: a local day with at least one flashcard answer (a graded
 *    review or a practice answer), a quiz answer, or a saved focus session.
 *  - Streak: the study streak the study hub shows (lib/study/streak.ts,
 *    fed by studyDays() in app/app/study-actions.ts): a day counts when the
 *    student reviewed or practised flashcards or answered a quiz question
 *    (see isStudyDay). Focus-only days are active days but do not extend the
 *    streak, so the streak reads the same number wherever it appears, and its
 *    freezes and "best" work as they do there. Today never breaks it.
 *  - Cards reviewed: flashcard answers, graded reviews plus practice.
 *  - Recall rate: reviews of learned cards that were remembered
 *    (reviewPassed / reviewTotal, the study hub's "retention").
 *  - Quiz accuracy: quizCorrect / quizAnswers.
 * Rates are null, never NaN, when there is nothing to divide by.
 */
import { DAY_RE, dayRange, shiftDay } from "./days";
import { streakStatus, type StreakStatus } from "./streak";

export const INSIGHT_PERIODS = ["7d", "30d", "90d"] as const;
export type InsightPeriod = (typeof INSIGHT_PERIODS)[number];
export const DEFAULT_INSIGHT_PERIOD: InsightPeriod = "7d";
export const PERIOD_DAYS: Record<InsightPeriod, number> = { "7d": 7, "30d": 30, "90d": 90 };

/** Fewest focus sessions in the period before the page names a best time of day. */
export const BEST_TIME_MIN_SESSIONS = 5;
/** How far back the streak looks (the study hub's window). */
export const STREAK_HISTORY_DAYS = 400;
/** Most focus-session starts read for the time-of-day note (far beyond 90 days of real use). */
export const MAX_FOCUS_STARTS = 2_000;

/** The period named in a search param (or anything else), else the default. */
export function parsePeriod(value: unknown): InsightPeriod {
  const candidate = Array.isArray(value) ? value[0] : value;
  return (INSIGHT_PERIODS as readonly unknown[]).includes(candidate)
    ? (candidate as InsightPeriod)
    : DEFAULT_INSIGHT_PERIOD;
}

/** An inclusive range of local days. */
export interface DayWindow {
  from: string;
  to: string;
  days: number;
}

/**
 * The period ending today (today included, though it is not over yet) and
 * the period of the same length right before it.
 */
export function periodWindows(
  period: InsightPeriod,
  today: string,
): { current: DayWindow; previous: DayWindow } {
  const days = PERIOD_DAYS[period];
  const from = shiftDay(today, -(days - 1));
  return {
    current: { from, to: today, days },
    previous: { from: shiftDay(from, -days), to: shiftDay(from, -1), days },
  };
}

// ---- Inputs: what the loader reads --------------------------------------

/** Study counters for one local day, summed over every workspace. */
export interface StudyDayInput {
  localDate: string;
  reviews: number;
  practice: number;
  newCards: number;
  reviewTotal: number;
  reviewPassed: number;
  quizAnswers: number;
  quizCorrect: number;
}

/** Focus time for one local day. */
export interface FocusDayInput {
  localDate: string;
  seconds: number;
  sessions: number;
}

/** Study counters for one workspace over the current period. */
export interface CourseStudyInput {
  workspaceId: string;
  reviews: number;
  practice: number;
  quizAnswers: number;
  quizCorrect: number;
}

/** Focus time for one workspace (null: about nothing in particular) over the current period. */
export interface CourseFocusInput {
  workspaceId: string | null;
  seconds: number;
}

/** A workspace the student owns that is not in the trash. */
export interface CourseInfo {
  id: string;
  name: string;
  icon: string | null;
}

/** When one focus session started, and how long it ran. */
export interface FocusStart {
  startedAt: Date;
  seconds: number;
}

export interface InsightsInput {
  period: InsightPeriod;
  /** The student's local day now. */
  today: string;
  /** The IANA zone `today` and the time-of-day note are read in. */
  timeZone: string;
  /** Per-day study counters; rows outside the two periods are ignored. */
  studyDays: StudyDayInput[];
  /** Per-day focus time; rows outside the two periods are ignored. */
  focusDays: FocusDayInput[];
  /** Per-workspace study counters, current period. */
  courseStudy: CourseStudyInput[];
  /** Per-workspace focus time, current period. */
  courseFocus: CourseFocusInput[];
  /** The student's live workspaces among those above; any other id is "Other". */
  courses: CourseInfo[];
  /** Focus session starts, current period. */
  focusStarts: FocusStart[];
  /** Local days that count toward the streak (see isStudyDay), any order. */
  streakDays: string[];
}

// ---- Outputs -------------------------------------------------------------

export interface DayInsight {
  date: string;
  focusSeconds: number;
  focusMinutes: number;
  focusSessions: number;
  /** Flashcard answers: graded reviews plus practice. */
  cards: number;
  newCards: number;
  reviewTotal: number;
  reviewPassed: number;
  quizAnswers: number;
  quizCorrect: number;
  active: boolean;
}

export interface PeriodTotals {
  focusMinutes: number;
  focusSessions: number;
  activeDays: number;
  cards: number;
  newCards: number;
  reviewTotal: number;
  reviewPassed: number;
  recallRate: number | null;
  quizAnswers: number;
  quizCorrect: number;
  quizAccuracy: number | null;
}

/** A count now, then, and the difference (now minus then). */
export interface CountChange {
  current: number;
  previous: number;
  change: number;
}

/** A rate now, then, and the difference in points (null when either side has no data). */
export interface RateChange {
  current: number | null;
  previous: number | null;
  change: number | null;
}

export interface Comparison {
  /** False when the period before had no activity at all: nothing to compare with. */
  hasPrevious: boolean;
  focusMinutes: CountChange;
  activeDays: CountChange;
  cards: CountChange;
  recallRate: RateChange;
  quizAccuracy: RateChange;
}

export interface CourseInsight {
  /** The workspace, or null for "Other": focus about no course, and courses in the trash or gone. */
  id: string | null;
  name: string | null;
  icon: string | null;
  focusMinutes: number;
  /** Share of the period's focus time, 0…1. */
  focusShare: number;
  cards: number;
  quizAnswers: number;
  quizCorrect: number;
  quizAccuracy: number | null;
}

export type TimeOfDay = "morning" | "afternoon" | "evening" | "night";
export const TIMES_OF_DAY: readonly TimeOfDay[] = ["morning", "afternoon", "evening", "night"];

export interface FocusRhythm {
  /** Focus sessions the note is based on. */
  sessions: number;
  /** Focus minutes by the local hour each session started in (index 0…23). */
  hours: number[];
  /** Focus minutes by part of the day. */
  parts: Record<TimeOfDay, number>;
  /** The part of the day with the most focus time, once there are enough sessions and one clearly leads. */
  best: TimeOfDay | null;
}

export interface Insights {
  period: InsightPeriod;
  today: string;
  timeZone: string;
  current: DayWindow;
  previous: DayWindow;
  /** Every day of the current period, oldest first, ending today. */
  perDay: DayInsight[];
  totals: PeriodTotals;
  previousTotals: PeriodTotals;
  comparison: Comparison;
  /** Courses with activity this period, most focus time first; "Other" last. */
  courses: CourseInsight[];
  rhythm: FocusRhythm;
  streak: StreakStatus;
  /** Any study on record (this period, the one before, or the streak's history). */
  everStudied: boolean;
}

// ---- Helpers ---------------------------------------------------------------

/** A stored counter as a safe non-negative number. */
function count(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
}

function toMinutes(seconds: number): number {
  return Math.round(Math.max(0, seconds) / 60);
}

function ratio(part: number, whole: number): number | null {
  return whole > 0 ? Math.min(1, part / whole) : null;
}

/**
 * Whether a day's counters count toward the streak: the rule of studyDays()
 * in app/app/study-actions.ts (a flashcard review, a practice answer or a
 * quiz answer).
 */
export function isStudyDay(counts: { reviews?: number; practice?: number; quizAnswers?: number }): boolean {
  return count(counts.reviews) > 0 || count(counts.practice) > 0 || count(counts.quizAnswers) > 0;
}

const hourFormats = new Map<string, Intl.DateTimeFormat>();

function hourFormat(timeZone: string): Intl.DateTimeFormat {
  let format = hourFormats.get(timeZone);
  if (format) return format;
  try {
    format = new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", hourCycle: "h23" });
  } catch {
    format = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", hour: "numeric", hourCycle: "h23" });
  }
  if (hourFormats.size > 64) hourFormats.clear();
  hourFormats.set(timeZone, format);
  return format;
}

/**
 * The wall-clock hour (0…23) of `date` in `timeZone`, with that instant's own
 * offset (so DST is handled), or null for an invalid date. An invalid zone
 * reads as UTC.
 */
export function hourInZone(date: Date, timeZone: string): number | null {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return null;
  const hour = Number(hourFormat(timeZone).formatToParts(date).find((p) => p.type === "hour")?.value);
  return Number.isFinite(hour) ? hour % 24 : null;
}

/** Morning 5–12, afternoon 12–17, evening 17–22, night 22–5. */
export function timeOfDay(hour: number): TimeOfDay {
  if (hour >= 5 && hour < 12) return "morning";
  if (hour >= 12 && hour < 17) return "afternoon";
  if (hour >= 17 && hour < 22) return "evening";
  return "night";
}

/** When the student focuses, from the local hour each session started in. */
export function focusRhythm(starts: readonly FocusStart[], timeZone: string): FocusRhythm {
  const hourSeconds = new Array<number>(24).fill(0);
  const partSeconds: Record<TimeOfDay, number> = { morning: 0, afternoon: 0, evening: 0, night: 0 };
  let sessions = 0;
  for (const start of starts) {
    const seconds = count(start.seconds);
    const hour = hourInZone(start.startedAt, timeZone);
    if (hour === null || seconds <= 0) continue;
    sessions += 1;
    hourSeconds[hour] += seconds;
    partSeconds[timeOfDay(hour)] += seconds;
  }
  let best: TimeOfDay | null = null;
  if (sessions >= BEST_TIME_MIN_SESSIONS) {
    const ranked = [...TIMES_OF_DAY].sort((a, b) => partSeconds[b] - partSeconds[a]);
    // Named only when one part clearly leads: a tie says nothing.
    if (partSeconds[ranked[0]] > 0 && partSeconds[ranked[0]] > partSeconds[ranked[1]]) best = ranked[0];
  }
  return {
    sessions,
    hours: hourSeconds.map(toMinutes),
    parts: {
      morning: toMinutes(partSeconds.morning),
      afternoon: toMinutes(partSeconds.afternoon),
      evening: toMinutes(partSeconds.evening),
      night: toMinutes(partSeconds.night),
    },
    best,
  };
}

function totalsFor(days: readonly DayInsight[]): PeriodTotals {
  let focusSeconds = 0;
  const t = {
    focusSessions: 0,
    activeDays: 0,
    cards: 0,
    newCards: 0,
    reviewTotal: 0,
    reviewPassed: 0,
    quizAnswers: 0,
    quizCorrect: 0,
  };
  for (const d of days) {
    focusSeconds += d.focusSeconds;
    t.focusSessions += d.focusSessions;
    t.activeDays += d.active ? 1 : 0;
    t.cards += d.cards;
    t.newCards += d.newCards;
    t.reviewTotal += d.reviewTotal;
    t.reviewPassed += d.reviewPassed;
    t.quizAnswers += d.quizAnswers;
    t.quizCorrect += d.quizCorrect;
  }
  return {
    ...t,
    focusMinutes: toMinutes(focusSeconds),
    recallRate: ratio(t.reviewPassed, t.reviewTotal),
    quizAccuracy: ratio(t.quizCorrect, t.quizAnswers),
  };
}

function countChange(current: number, previous: number): CountChange {
  return { current, previous, change: current - previous };
}

function rateChange(current: number | null, previous: number | null): RateChange {
  return { current, previous, change: current === null || previous === null ? null : current - previous };
}

/** Every day of `window` with its numbers (zero-filled). */
function daysOf(
  window: DayWindow,
  study: Map<string, StudyDayInput>,
  focus: Map<string, FocusDayInput>,
): DayInsight[] {
  return dayRange(window.from, window.to).map((date) => {
    const s = study.get(date);
    const f = focus.get(date);
    const focusSeconds = count(f?.seconds);
    const reviews = count(s?.reviews);
    const practice = count(s?.practice);
    const quizAnswers = count(s?.quizAnswers);
    const focusSessions = focusSeconds > 0 ? Math.max(1, count(f?.sessions)) : 0;
    return {
      date,
      focusSeconds,
      focusMinutes: toMinutes(focusSeconds),
      focusSessions,
      cards: reviews + practice,
      newCards: count(s?.newCards),
      reviewTotal: count(s?.reviewTotal),
      reviewPassed: Math.min(count(s?.reviewPassed), count(s?.reviewTotal)),
      quizAnswers,
      quizCorrect: Math.min(count(s?.quizCorrect), quizAnswers),
      active: focusSeconds > 0 || reviews > 0 || practice > 0 || quizAnswers > 0,
    };
  });
}

/** Sum rows per day (the loader sends one per day, but nothing breaks if it does not). */
function byDay<T extends { localDate: string }>(rows: readonly T[], add: (into: T, row: T) => void): Map<string, T> {
  const out = new Map<string, T>();
  for (const row of rows) {
    if (!DAY_RE.test(row.localDate)) continue;
    const existing = out.get(row.localDate);
    if (existing) add(existing, row);
    else out.set(row.localDate, { ...row });
  }
  return out;
}

function courseInsights(input: InsightsInput, totalFocusSeconds: number): CourseInsight[] {
  const live = new Map(input.courses.map((c) => [c.id, c]));
  const OTHER = "\u0000other";
  const acc = new Map<string, { seconds: number; cards: number; quizAnswers: number; quizCorrect: number }>();
  const slot = (workspaceId: string | null) => {
    const key = workspaceId && live.has(workspaceId) ? workspaceId : OTHER;
    let entry = acc.get(key);
    if (!entry) {
      entry = { seconds: 0, cards: 0, quizAnswers: 0, quizCorrect: 0 };
      acc.set(key, entry);
    }
    return entry;
  };
  for (const row of input.courseStudy) {
    const entry = slot(row.workspaceId);
    entry.cards += count(row.reviews) + count(row.practice);
    const answers = count(row.quizAnswers);
    entry.quizAnswers += answers;
    entry.quizCorrect += Math.min(count(row.quizCorrect), answers);
  }
  for (const row of input.courseFocus) slot(row.workspaceId).seconds += count(row.seconds);

  const entries = [...acc]
    .filter(([, e]) => e.seconds > 0 || e.cards > 0 || e.quizAnswers > 0)
    .map(([key, e]) => ({ info: key === OTHER ? null : live.get(key)!, ...e }));
  // Most focus time first ("sorted by time"), then most study; "Other" last.
  entries.sort((a, b) => {
    if ((a.info === null) !== (b.info === null)) return a.info === null ? 1 : -1;
    return (
      b.seconds - a.seconds ||
      b.cards - a.cards ||
      b.quizAnswers - a.quizAnswers ||
      (a.info?.name ?? "").localeCompare(b.info?.name ?? "")
    );
  });
  return entries.map((e) => ({
    id: e.info?.id ?? null,
    name: e.info?.name ?? null,
    icon: e.info?.icon ?? null,
    focusMinutes: toMinutes(e.seconds),
    focusShare: totalFocusSeconds > 0 ? Math.min(1, e.seconds / totalFocusSeconds) : 0,
    cards: e.cards,
    quizAnswers: e.quizAnswers,
    quizCorrect: e.quizCorrect,
    quizAccuracy: ratio(e.quizCorrect, e.quizAnswers),
  }));
}

/** Everything the insights page shows, from the loader's rows. */
export function buildInsights(input: InsightsInput): Insights {
  const { current, previous } = periodWindows(input.period, input.today);
  const study = byDay(input.studyDays, (into, row) => {
    into.reviews = count(into.reviews) + count(row.reviews);
    into.practice = count(into.practice) + count(row.practice);
    into.newCards = count(into.newCards) + count(row.newCards);
    into.reviewTotal = count(into.reviewTotal) + count(row.reviewTotal);
    into.reviewPassed = count(into.reviewPassed) + count(row.reviewPassed);
    into.quizAnswers = count(into.quizAnswers) + count(row.quizAnswers);
    into.quizCorrect = count(into.quizCorrect) + count(row.quizCorrect);
  });
  const focus = byDay(input.focusDays, (into, row) => {
    into.seconds = count(into.seconds) + count(row.seconds);
    into.sessions = count(into.sessions) + count(row.sessions);
  });

  const perDay = daysOf(current, study, focus);
  const before = daysOf(previous, study, focus);
  const totals = totalsFor(perDay);
  const previousTotals = totalsFor(before);
  const focusSeconds = perDay.reduce((n, d) => n + d.focusSeconds, 0);

  const streak = streakStatus(
    input.streakDays.filter((d) => DAY_RE.test(d)),
    input.today,
  );

  return {
    period: input.period,
    today: input.today,
    timeZone: input.timeZone,
    current,
    previous,
    perDay,
    totals,
    previousTotals,
    comparison: {
      hasPrevious: previousTotals.activeDays > 0,
      focusMinutes: countChange(totals.focusMinutes, previousTotals.focusMinutes),
      activeDays: countChange(totals.activeDays, previousTotals.activeDays),
      cards: countChange(totals.cards, previousTotals.cards),
      recallRate: rateChange(totals.recallRate, previousTotals.recallRate),
      quizAccuracy: rateChange(totals.quizAccuracy, previousTotals.quizAccuracy),
    },
    courses: courseInsights(input, focusSeconds),
    rhythm: focusRhythm(input.focusStarts, input.timeZone),
    streak,
    everStudied: totals.activeDays > 0 || previousTotals.activeDays > 0 || streak.longest > 0,
  };
}

// ---- Chart -----------------------------------------------------------------

/** One column of the activity chart: a day, or a week for the 90-day view. */
export interface ActivityBucket {
  from: string;
  to: string;
  focusMinutes: number;
  cards: number;
}

/**
 * Chart columns: one per day for 7 and 30 days; one per week for 90, counted
 * back from today so the last column always ends today (the first may be
 * shorter). Readable at phone width either way.
 */
export function activityBuckets(perDay: readonly DayInsight[], period: InsightPeriod): ActivityBucket[] {
  const size = period === "90d" ? 7 : 1;
  const out: ActivityBucket[] = [];
  for (let end = perDay.length; end > 0; end -= size) {
    const slice = perDay.slice(Math.max(0, end - size), end);
    out.unshift({
      from: slice[0].date,
      to: slice[slice.length - 1].date,
      focusMinutes: toMinutes(slice.reduce((n, d) => n + d.focusSeconds, 0)),
      cards: slice.reduce((n, d) => n + d.cards, 0),
    });
  }
  return out;
}

// ---- CSV -------------------------------------------------------------------

export interface InsightsCsvLabels {
  date: string;
  focusMinutes: string;
  focusSessions: string;
  cards: string;
  newCards: string;
  recallRate: string;
  quizAnswers: string;
  quizCorrect: string;
}

function csvCell(value: string | number): string {
  const text = String(value);
  return /[",\r\n;]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/**
 * The period's per-day numbers as CSV (RFC 4180: comma separated, CRLF line
 * ends, a UTF-8 byte-order mark so spreadsheet apps read non-Latin headers
 * right). Numbers are plain (no locale formatting) so any spreadsheet reads
 * them; the recall rate is a percentage with one decimal, empty on a day
 * with no reviews of learned cards.
 */
export function insightsCsv(perDay: readonly DayInsight[], labels: InsightsCsvLabels): string {
  const header = [
    labels.date,
    labels.focusMinutes,
    labels.focusSessions,
    labels.cards,
    labels.newCards,
    labels.recallRate,
    labels.quizAnswers,
    labels.quizCorrect,
  ];
  const rows = perDay.map((d) => {
    const recall = ratio(d.reviewPassed, d.reviewTotal);
    return [
      d.date,
      d.focusMinutes,
      d.focusSessions,
      d.cards,
      d.newCards,
      recall === null ? "" : Math.round(recall * 1000) / 10,
      d.quizAnswers,
      d.quizCorrect,
    ];
  });
  return `﻿${[header, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n")}\r\n`;
}

/** The download's file name, e.g. studyos-insights-30d-2026-11-13.csv. */
export function insightsCsvFilename(period: InsightPeriod, today: string): string {
  return `studyos-insights-${period}-${DAY_RE.test(today) ? today : "export"}.csv`;
}
