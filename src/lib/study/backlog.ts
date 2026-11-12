/**
 * Welcome-back catch-up plan. When a student returns to a pile of overdue
 * reviews, presenting 300 due cards makes people quit. Instead we keep a
 * manageable load for today — the cards most at risk of being forgotten — and
 * spread the rest over the following days.
 *
 * Only due DAYS move; the cards' memory state is untouched. FSRS measures the
 * real time since the last review when a card is finally answered, so a
 * postponed card is scheduled correctly afterwards. New cards never pile up
 * (they wait until the student starts them) and are left alone.
 */
import type { Flashcard } from "@/lib/workspace/types";
import { startOfLocalDay, shiftDay } from "./days";
import { isDue, isNew, isShortTerm, isStudyable, isoDay, retrievability } from "./srs";

/** Reviews per day that feel doable for a student in a busy week. */
export const DAILY_REVIEW_LOAD = 50;

export interface KeyedCard {
  /** Stable key that locates the card (page, deck and card id). */
  key: string;
  card: Flashcard;
}

/** Reviews (not new cards) due today or earlier. */
export function dueReviews<T extends KeyedCard>(items: T[], now: Date): T[] {
  return items.filter(
    ({ card }) => isStudyable(card) && !isNew(card) && isDue(card, now),
  );
}

/** Should the student be offered a catch-up plan? */
export function needsCatchUp(items: KeyedCard[], now: Date, load = DAILY_REVIEW_LOAD): boolean {
  const today = isoDay(now);
  const due = dueReviews(items, now);
  return due.length > load && due.some(({ card }) => card.dueAt! < today);
}

export interface CatchUpPlan {
  /** Reviews left for today. */
  today: number;
  /** Reviews moved to later days. */
  moved: number;
  /** Number of later days the moved reviews are spread over. */
  days: number;
  moves: { key: string; dueAt: string }[];
}

/**
 * Keep `load` reviews today (lowest recall probability first) and spread the
 * rest over the next days, never letting a day exceed `load` reviews counting
 * what is already scheduled there (at least one slot per day so the plan
 * always ends).
 */
export function planCatchUp(items: KeyedCard[], now: Date, load = DAILY_REVIEW_LOAD): CatchUpPlan {
  const today = isoDay(now);
  // Learning-step cards stay today: they are mid-lesson.
  const due = dueReviews(items, now)
    .filter(({ card }) => !isShortTerm(card))
    .map((item) => ({ item, r: retrievability(item.card, now) ?? 0 }))
    .sort((a, b) => a.r - b.r);
  const stayingShortTerm = dueReviews(items, now).length - due.length;

  const keepToday = Math.max(0, load - stayingShortTerm);
  const later = due.slice(keepToday);
  const alreadyScheduled = new Map<string, number>();
  for (const { card } of items) {
    if (isStudyable(card) && !isNew(card) && card.dueAt && card.dueAt > today) {
      alreadyScheduled.set(card.dueAt, (alreadyScheduled.get(card.dueAt) ?? 0) + 1);
    }
  }

  const moves: CatchUpPlan["moves"] = [];
  let offset = 1;
  let i = 0;
  while (i < later.length) {
    const day = shiftDay(today, offset);
    const room = Math.max(1, load - (alreadyScheduled.get(day) ?? 0));
    for (let n = 0; n < room && i < later.length; n++, i++) {
      moves.push({ key: later[i].item.key, dueAt: day });
    }
    offset++;
  }
  return {
    today: due.length - later.length + stayingShortTerm,
    moved: moves.length,
    days: moves.length ? offset - 1 : 0,
    moves,
  };
}

/** Apply one move to a card in place (only its due day changes). */
export function postponeCard(card: Flashcard, dueAt: string): void {
  // Pin the last-review time first: for cards from before FSRS it is inferred
  // from the due day, which is about to change.
  if (!card.lastReviewedAt && card.dueAt) {
    card.lastReviewedAt = startOfLocalDay(
      shiftDay(card.dueAt, -Math.round(card.intervalDays ?? 0)),
    ).toISOString();
  }
  card.dueAt = dueAt;
  card.dueTime = startOfLocalDay(dueAt).toISOString();
}
