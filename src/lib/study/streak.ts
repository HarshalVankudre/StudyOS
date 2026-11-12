/**
 * Daily study streak with automatic streak freezes — the forgiving version.
 *
 * Rules (kept pure and day-string based so they are testable and time-zone
 * agnostic; callers pass days already in the student's local calendar):
 *  - A streak is the number of days studied in a row. Studying yesterday but
 *    not yet today keeps it alive: today is not over.
 *  - Every FREEZE_EVERY days studied within a streak earns a streak freeze;
 *    up to MAX_FREEZES can be banked.
 *  - A missed day is covered automatically by a banked freeze. The streak is
 *    kept (the frozen day itself does not add to the count). So once a streak
 *    reaches a week, one missed day can never wipe it.
 *  - With no freeze left, a missed day ends the streak. Before that happens the
 *    status reports `atRisk` so the UI can warn the student that day, and after
 *    it happens `ended` lets the UI welcome them back kindly.
 */
import { daysBetween, shiftDay } from "./days";

/** Study days in a streak that earn one freeze. */
export const FREEZE_EVERY = 7;
/** Most freezes a student can bank. */
export const MAX_FREEZES = 2;
/** How long after a streak ends the "welcome back" note is still shown. */
const ENDED_NOTICE_DAYS = 7;
/** Shortest streak whose ending is worth mentioning. */
const ENDED_MIN_LENGTH = 3;

export interface StreakStatus {
  /** Days studied in a row (frozen days bridge the gap but do not count). */
  current: number;
  /** Longest streak ever reached. */
  longest: number;
  studiedToday: boolean;
  /** Banked streak freezes. */
  freezes: number;
  /** Study days toward the next freeze (0 … FREEZE_EVERY-1). */
  towardFreeze: number;
  /** Missed days inside the current streak that a freeze covered. */
  frozenDays: string[];
  /** The streak ends tonight unless the student studies (no freeze left). */
  atRisk: boolean;
  /** A streak that ended recently: its length and the first missed day. */
  ended: { length: number; on: string } | null;
}

export const EMPTY_STREAK: StreakStatus = {
  current: 0,
  longest: 0,
  studiedToday: false,
  freezes: 0,
  towardFreeze: 0,
  frozenDays: [],
  atRisk: false,
  ended: null,
};

/**
 * Replay a student's study history day by day.
 * @param studyDays local YYYY-MM-DD days with at least one review (any order,
 *        duplicates allowed; days after `today` are ignored).
 * @param today the student's local day now.
 */
export function streakStatus(studyDays: string[], today: string): StreakStatus {
  const days = Array.from(new Set(studyDays.filter((d) => d <= today))).sort();
  if (days.length === 0) return { ...EMPTY_STREAK };
  const studied = new Set(days);

  let current = 0;
  let longest = 0;
  let freezes = 0;
  let toward = 0;
  let frozenDays: string[] = [];
  let ended: StreakStatus["ended"] = null;

  const total = daysBetween(days[0], today);
  for (let i = 0; i <= total; i++) {
    const day = shiftDay(days[0], i);
    if (studied.has(day)) {
      current += 1;
      toward += 1;
      if (toward >= FREEZE_EVERY) {
        toward = 0;
        freezes = Math.min(MAX_FREEZES, freezes + 1);
      }
      longest = Math.max(longest, current);
      continue;
    }
    if (day === today) break; // today is not over yet
    if (current === 0) continue;
    if (freezes > 0) {
      freezes -= 1;
      frozenDays.push(day);
      continue;
    }
    ended = { length: current, on: day };
    current = 0;
    toward = 0;
    frozenDays = [];
  }

  const studiedToday = studied.has(today);
  const showEnded =
    ended &&
    ended.length >= ENDED_MIN_LENGTH &&
    current < ended.length &&
    daysBetween(ended.on, today) <= ENDED_NOTICE_DAYS;
  return {
    current,
    longest,
    studiedToday,
    freezes,
    towardFreeze: toward,
    frozenDays,
    atRisk: !studiedToday && current > 0 && freezes === 0,
    ended: showEnded ? ended : null,
  };
}

/** Back-compat helper: just the streak length. */
export function computeStreak(reviewDays: string[], today: string): number {
  return streakStatus(reviewDays, today).current;
}
