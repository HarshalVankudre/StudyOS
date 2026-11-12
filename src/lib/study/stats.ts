/**
 * Study statistics: the per-day review record and the numbers shown in the
 * statistics view. Pure so the same code runs in the browser (recording,
 * forecasts from the open workspace) and on the server (aggregating stored
 * days, forecasts across every workspace).
 */
import type { Flashcard } from "@/lib/workspace/types";
import { dayRange, daysBetween, shiftDay } from "./days";
import { isNew, isStudyable, type CardState, type Grade } from "./srs";

/** Review counts for one student, one workspace, one local day. */
export interface DayCounts {
  /** Graded reviews that updated the schedule (practice excluded). */
  reviews: number;
  again: number;
  hard: number;
  good: number;
  easy: number;
  /** Reviews of cards seen for the first time. */
  newCards: number;
  /** Reviews of cards in the "review" state (the basis of retention)… */
  reviewTotal: number;
  /** …and how many of those were recalled (graded hard, good or easy). */
  reviewPassed: number;
  /** Practice (cram) answers, which never change the schedule. */
  practice: number;
  /** Quiz answers (practice and exam), and how many were right. */
  quizAnswers: number;
  quizCorrect: number;
}

export const COUNT_KEYS: (keyof DayCounts)[] = [
  "reviews",
  "again",
  "hard",
  "good",
  "easy",
  "newCards",
  "reviewTotal",
  "reviewPassed",
  "practice",
  "quizAnswers",
  "quizCorrect",
];

export function zeroCounts(): DayCounts {
  return {
    reviews: 0,
    again: 0,
    hard: 0,
    good: 0,
    easy: 0,
    newCards: 0,
    reviewTotal: 0,
    reviewPassed: 0,
    practice: 0,
    quizAnswers: 0,
    quizCorrect: 0,
  };
}

export function addCounts(a: DayCounts, b: DayCounts): DayCounts {
  const out = zeroCounts();
  for (const k of COUNT_KEYS) out[k] = a[k] + b[k];
  return out;
}

export interface ReviewEvent {
  grade: Grade;
  /** The card's state BEFORE this answer. */
  prevState: CardState;
  practice: boolean;
}

/** The counts one answer adds to its day. */
export function countsForEvent(e: ReviewEvent): DayCounts {
  const c = zeroCounts();
  if (e.practice) {
    c.practice = 1;
    return c;
  }
  c.reviews = 1;
  c[e.grade] = 1;
  if (e.prevState === "new") c.newCards = 1;
  if (e.prevState === "review") {
    c.reviewTotal = 1;
    if (e.grade !== "again") c.reviewPassed = 1;
  }
  return c;
}

export interface DayRow extends DayCounts {
  localDate: string;
}

export interface DayPoint {
  day: string;
  reviews: number;
  practice: number;
}

/** Reviews per day for the `days` days ending `today`, zero-filled. */
export function reviewsPerDay(rows: DayRow[], today: string, days = 28): DayPoint[] {
  const byDay = new Map<string, DayPoint>();
  for (const r of rows) {
    const p = byDay.get(r.localDate) ?? { day: r.localDate, reviews: 0, practice: 0 };
    p.reviews += r.reviews;
    p.practice += r.practice;
    byDay.set(r.localDate, p);
  }
  return dayRange(shiftDay(today, -(days - 1)), today).map(
    (day) => byDay.get(day) ?? { day, reviews: 0, practice: 0 },
  );
}

/**
 * Share of reviews of learned cards that were recalled over the last `days`
 * days (Anki's "true retention"), or null when there were none.
 */
export function retentionRate(rows: DayRow[], today: string, days = 30): number | null {
  const from = shiftDay(today, -(days - 1));
  let total = 0;
  let passed = 0;
  for (const r of rows) {
    if (r.localDate < from || r.localDate > today) continue;
    total += r.reviewTotal;
    passed += r.reviewPassed;
  }
  return total > 0 ? passed / total : null;
}

export interface ForecastPoint {
  day: string;
  count: number;
}

/**
 * Reviews falling due on each of the next `days` days (index 0 is today and
 * includes anything overdue). New cards are not forecast; they are counted in
 * `newWaiting`.
 */
export function dueForecast(
  cards: Flashcard[],
  today: string,
  days = 14,
): { points: ForecastPoint[]; newWaiting: number } {
  const counts = new Array<number>(days).fill(0);
  let newWaiting = 0;
  for (const card of cards) {
    if (!isStudyable(card)) continue;
    if (isNew(card) || !card.dueAt) {
      newWaiting += 1;
      continue;
    }
    const offset = Math.max(0, daysBetween(today, card.dueAt));
    if (offset < days) counts[offset] += 1;
  }
  return {
    points: counts.map((count, i) => ({ day: shiftDay(today, i), count })),
    newWaiting,
  };
}

/** Every card of every flashcard deck in a (possibly unvalidated) workspace. */
export function collectCards(workspace: unknown): Flashcard[] {
  const out: Flashcard[] = [];
  const pages = (workspace as { pages?: unknown })?.pages;
  if (!Array.isArray(pages)) return out;
  for (const page of pages) {
    const blocks = (page as { blocks?: unknown })?.blocks;
    if (!Array.isArray(blocks)) continue;
    for (const block of blocks) {
      const b = block as { type?: unknown; cards?: unknown };
      if (b?.type !== "flashcards" || !Array.isArray(b.cards)) continue;
      for (const c of b.cards) {
        const card = c as Flashcard;
        if (card && typeof card.front === "string" && typeof card.back === "string") out.push(card);
      }
    }
  }
  return out;
}

/** Totals over a set of day rows. */
export function totals(rows: DayRow[]): DayCounts {
  return rows.reduce<DayCounts>((acc, r) => addCounts(acc, r), zeroCounts());
}
