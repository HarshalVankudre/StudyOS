/**
 * Focus time: what the server accepts and what the student sees back.
 *
 * Pure (no Prisma, no browser APIs), so the server action, the Today view and
 * the tests share one set of rules. Days are the student's LOCAL calendar
 * days as YYYY-MM-DD strings (see ./days); a session belongs to the day it
 * started on.
 */
import { DAY_RE, shiftDay } from "./days";

/** Sessions shorter than this are not stored (a mis-click, not study time). */
export const FOCUS_MIN_SECONDS = 60;
/** Longest session stored; anything longer is cut to this. */
export const FOCUS_MAX_SECONDS = 3 * 60 * 60;
/** Longest label stored, in characters. */
export const FOCUS_LABEL_MAX = 200;
/** Oldest session start the server accepts (a retried save, a reopened tab). */
export const FOCUS_MAX_AGE_MS = 24 * 60 * 60 * 1000;
/** How far the browser's clock may run ahead of the server's. */
export const FOCUS_CLOCK_SKEW_MS = 5 * 60 * 1000;
/** Days shown in the Today view's bar row. */
export const FOCUS_WEEK_DAYS = 7;
/** How far back the focus streak looks. */
export const FOCUS_HISTORY_DAYS = 400;

/** Matches the browser's random id for one focus block. */
export const FOCUS_CLIENT_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;

/**
 * Whether a session that started at `startedAt` (epoch ms, the browser's
 * clock) is believable at server time `now`: within the last day, and not in
 * the future beyond a small clock skew.
 */
export function plausibleStart(startedAt: number, now: number): boolean {
  if (!Number.isFinite(startedAt) || !Number.isFinite(now)) return false;
  return startedAt <= now + FOCUS_CLOCK_SKEW_MS && startedAt >= now - FOCUS_MAX_AGE_MS;
}

/**
 * The seconds to store for a session, or null when it is too short to keep.
 * Cut to FOCUS_MAX_SECONDS, and to the real time that passed since the
 * session started (plus the clock skew): a block cannot hold more focus than
 * the time that went by.
 */
export function storableSeconds(seconds: number, startedAt: number, now: number): number | null {
  if (!Number.isFinite(seconds)) return null;
  const wall = Math.floor((now - startedAt + FOCUS_CLOCK_SKEW_MS) / 1000);
  const kept = Math.min(Math.floor(seconds), FOCUS_MAX_SECONDS, wall);
  return kept >= FOCUS_MIN_SECONDS ? kept : null;
}

/**
 * A label as stored: control characters become spaces, runs of whitespace
 * collapse, and it is cut to FOCUS_LABEL_MAX characters (never inside a
 * character). Empty becomes null.
 */
export function cleanFocusLabel(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const flat = value
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!flat) return null;
  const cut = Array.from(flat).slice(0, FOCUS_LABEL_MAX).join("").trim();
  // A lone surrogate cannot be stored in a Postgres text column.
  return typeof cut.toWellFormed === "function" ? cut.toWellFormed() : cut;
}

/** One day of the bar row. */
export interface FocusDay {
  /** Local day, YYYY-MM-DD. */
  date: string;
  minutes: number;
}

/** What the Today view shows about focus time. */
export interface FocusSummary {
  /** The student's local day the summary was made for. */
  today: string;
  todayMinutes: number;
  /** The last FOCUS_WEEK_DAYS local days, oldest first, ending today. */
  week: FocusDay[];
  weekMinutes: number;
  /** Days in a row with at least one focus session (today not over yet). */
  streak: number;
}

export function emptyFocusSummary(today: string): FocusSummary {
  return summarizeFocus([], today);
}

/** Whole minutes for a number of seconds (1 min 30 s reads as 2 min). */
function toMinutes(seconds: number): number {
  return Math.round(Math.max(0, seconds) / 60);
}

/**
 * Days in a row with focus time, counted back from today. Like the study
 * streak, a day not yet focused today does not break it: today is not over,
 * so the count runs back from yesterday instead.
 */
export function focusStreak(days: Iterable<string>, today: string): number {
  const studied = new Set(days);
  let day = studied.has(today) ? today : shiftDay(today, -1);
  let count = 0;
  while (studied.has(day)) {
    count += 1;
    day = shiftDay(day, -1);
  }
  return count;
}

/**
 * The summary from per-day (or per-session) rows: seconds are added up per
 * local day. Rows after `today` or with a malformed day are ignored.
 */
export function summarizeFocus(
  rows: readonly { localDate: string; seconds: number }[],
  today: string,
): FocusSummary {
  const perDay = new Map<string, number>();
  for (const row of rows) {
    if (!DAY_RE.test(row.localDate) || row.localDate > today) continue;
    const seconds = Number.isFinite(row.seconds) ? Math.max(0, row.seconds) : 0;
    if (seconds <= 0) continue;
    perDay.set(row.localDate, (perDay.get(row.localDate) ?? 0) + seconds);
  }
  const week: FocusDay[] = [];
  let weekSeconds = 0;
  for (let i = FOCUS_WEEK_DAYS - 1; i >= 0; i--) {
    const date = shiftDay(today, -i);
    const seconds = perDay.get(date) ?? 0;
    weekSeconds += seconds;
    week.push({ date, minutes: toMinutes(seconds) });
  }
  return {
    today,
    todayMinutes: toMinutes(perDay.get(today) ?? 0),
    week,
    weekMinutes: toMinutes(weekSeconds),
    streak: focusStreak(perDay.keys(), today),
  };
}

/**
 * Saved focus blocks per student in any 24 hours, beyond which saves are
 * dropped: a day holds at most 24 hours of focus, so far more blocks than
 * this is a script, not a student.
 */
export const MAX_SESSIONS_PER_DAY = 200;
