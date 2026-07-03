/**
 * Spaced-repetition scheduling (SM-2, the algorithm behind Anki/SuperMemo).
 *
 * Pure and framework-free so it's trivially testable and identical on client
 * and server. The review UI calls `reviewCard` when the user grades a card and
 * writes the returned scheduling fields back into the workspace JSON.
 *
 * Grades (what the learner reports after seeing the answer):
 *   again — didn't recall / wrong        → reset, see again today
 *   hard  — recalled with difficulty      → short interval, ease down
 *   good  — recalled correctly            → normal interval
 *   easy  — recalled instantly            → long interval, ease up
 */
import type { Flashcard } from "@/lib/workspace/types";

export type Grade = "again" | "hard" | "good" | "easy";

export const GRADES: Grade[] = ["again", "hard", "good", "easy"];

const DEFAULT_EASE = 2.5;
const MIN_EASE = 1.3;

/** Local calendar day as YYYY-MM-DD (SRS scheduling is day-granular). */
export function isoDay(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function addDays(day: string, n: number): string {
  const [y, m, d] = day.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + Math.round(n));
  return isoDay(dt);
}

/** A card is "new" until it has been graded at least once. */
export function isNew(card: Flashcard): boolean {
  return card.reps === undefined || card.dueAt === undefined;
}

/** Is the card due for review on or before `now`? New cards are always due. */
export function isDue(card: Flashcard, now: Date): boolean {
  if (isNew(card)) return true;
  return card.dueAt! <= isoDay(now);
}

/**
 * Apply a grade to a card and return the NEXT scheduling state. Never mutates
 * its input. The interval math is classic SM-2 with an "again" that resets the
 * streak and re-queues the card for the same day.
 */
export function reviewCard(card: Flashcard, grade: Grade, now: Date): Flashcard {
  const today = isoDay(now);
  const prevEase = card.ease ?? DEFAULT_EASE;
  const prevReps = card.reps ?? 0;
  const prevInterval = card.intervalDays ?? 0;

  let ease = prevEase;
  let reps: number;
  let intervalDays: number;

  if (grade === "again") {
    reps = 0;
    intervalDays = 0; // same-day re-review
    ease = Math.max(MIN_EASE, prevEase - 0.2);
  } else {
    reps = prevReps + 1;
    if (grade === "hard") {
      ease = Math.max(MIN_EASE, prevEase - 0.15);
      intervalDays = prevInterval > 0 ? Math.max(1, prevInterval * 1.2) : 1;
    } else if (grade === "easy") {
      ease = prevEase + 0.15;
      if (reps === 1) intervalDays = 4;
      else if (reps === 2) intervalDays = 7;
      else intervalDays = Math.max(1, prevInterval * ease * 1.3);
    } else {
      // good
      if (reps === 1) intervalDays = 1;
      else if (reps === 2) intervalDays = 3;
      else intervalDays = Math.max(1, prevInterval * ease);
    }
  }

  intervalDays = Math.round(intervalDays);
  return {
    ...card,
    ease: Number(ease.toFixed(2)),
    reps,
    intervalDays,
    dueAt: addDays(today, intervalDays),
    lastReviewedAt: now.toISOString(),
  };
}

export interface DeckStats {
  total: number;
  due: number;
  new: number;
  learning: number; // seen but interval < 21d (not yet "mature")
  mature: number; // interval ≥ 21d
}

/** Summary counts for a deck at a given moment. */
export function deckStats(cards: Flashcard[], now: Date): DeckStats {
  const stats: DeckStats = { total: cards.length, due: 0, new: 0, learning: 0, mature: 0 };
  for (const card of cards) {
    if (isDue(card, now)) stats.due += 1;
    if (isNew(card)) stats.new += 1;
    else if ((card.intervalDays ?? 0) >= 21) stats.mature += 1;
    else stats.learning += 1;
  }
  return stats;
}

/**
 * The cards to study now, new cards last so review of already-learned material
 * comes first (the higher-value work). Stable within each group.
 */
export function dueQueue(cards: Flashcard[], now: Date): Flashcard[] {
  const due = cards.filter((c) => isDue(c, now));
  return [
    ...due.filter((c) => !isNew(c)),
    ...due.filter((c) => isNew(c)),
  ];
}
