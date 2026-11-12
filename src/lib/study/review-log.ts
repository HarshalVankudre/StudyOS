/**
 * Recording a flashcard review so that the order in which devices sync does
 * not matter.
 *
 * A card's schedule (stability, difficulty, lapses, due date...) is computed
 * from one review to the next, so it depends on the order of the reviews. Two
 * devices can review the same card and save in the other order: failed on an
 * offline phone in the morning, passed on the laptop in the evening, the
 * laptop saving first. Applying "whatever arrives" would either drop the
 * morning's lapse or compute it on top of the evening's review.
 *
 * So a card carries its recent reviews (`reviews`, each keyed by the moment
 * of the answer) and the schedule it had before the oldest of them
 * (`reviewBase`). Recording a review is then:
 *   - nothing, if a review at that moment is already in the log (the same
 *     edit run again: a save whose reply was lost, a recovered draft);
 *   - otherwise: add it, sort by time, and rebuild the schedule from
 *     `reviewBase` through every logged review in time order.
 * The result is the same whichever device saves first, and running it again
 * changes nothing. The log is bounded: beyond REVIEW_LOG_SIZE the oldest
 * review is folded into `reviewBase`. A review older than everything the log
 * still holds is replayed first, on `reviewBase` (it can no longer be placed
 * exactly, but it is counted, never dropped).
 */
import type { Flashcard } from "@/lib/workspace/types";
import { assignSchedule, reviewCard, type Grade } from "./srs";

/** How many recent reviews a card remembers. */
export const REVIEW_LOG_SIZE = 8;

const SCHEDULE_KEYS = [
  "ease",
  "intervalDays",
  "reps",
  "dueAt",
  "lastReviewedAt",
  "stability",
  "difficulty",
  "state",
  "lapses",
  "learningStep",
  "dueTime",
] as const;

export type CardSchedule = Pick<Flashcard, (typeof SCHEDULE_KEYS)[number]>;

/** The scheduling fields of `card` (without undefined ones). */
export function scheduleOf(card: Flashcard): CardSchedule {
  const out: Record<string, unknown> = {};
  for (const key of SCHEDULE_KEYS) if (card[key] !== undefined) out[key] = card[key];
  return out as CardSchedule;
}

function withSchedule(card: Flashcard, schedule: CardSchedule): Flashcard {
  const next: Flashcard = { id: card.id, front: card.front, back: card.back };
  return Object.assign(next, schedule);
}

/** The moment of a logged review (its id is the answer's ISO time). */
function momentOf(id: string): Date | null {
  const at = new Date(id);
  return Number.isNaN(at.getTime()) ? null : at;
}

/**
 * Record a review of `card` (in place): `grade`, answered at `at`. Idempotent
 * and independent of the order reviews are recorded in (see above).
 */
export function recordReview(card: Flashcard, grade: Grade, at: Date): void {
  const id = at.toISOString();
  const log = Array.isArray(card.reviews) ? card.reviews.filter((r) => momentOf(r.id) !== null) : [];
  if (log.some((r) => r.id === id)) return;
  // A card reviewed before reviews were logged: its last review is known only as a time.
  if (log.length === 0 && card.lastReviewedAt === id) return;

  // With no log yet, the schedule the card has now is "before the oldest logged review".
  let base: CardSchedule = log.length > 0 ? (card.reviewBase ?? {}) : scheduleOf(card);
  const entries = [...log, { id, grade }].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  while (entries.length > REVIEW_LOG_SIZE) {
    const oldest = entries.shift()!;
    base = scheduleOf(reviewCard(withSchedule(card, base), oldest.grade, momentOf(oldest.id)!));
  }
  let state = withSchedule(card, base);
  for (const entry of entries) state = reviewCard(state, entry.grade, momentOf(entry.id)!);

  assignSchedule(card, state);
  card.reviews = entries;
  if (Object.keys(base).length > 0) card.reviewBase = base;
  else delete card.reviewBase;
}
