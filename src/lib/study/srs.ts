/**
 * Spaced-repetition scheduling on FSRS (the Free Spaced Repetition Scheduler,
 * the algorithm Anki ships by default), via the maintained `ts-fsrs` package.
 *
 * Pure and framework-free so it is identical on client and server. The review
 * UI calls `reviewCard` when the student grades a card and writes the returned
 * scheduling fields back into the workspace JSON.
 *
 * Grades (what the learner reports after seeing the answer):
 *   again — didn't recall            → short relearning step, seen again soon
 *   hard  — recalled with difficulty → shorter interval
 *   good  — recalled correctly       → normal interval
 *   easy  — recalled instantly       → longer interval
 *
 * Model choice: FSRS-6 with its published default parameters (the version
 * Anki uses), target retention 90%, learning steps 1m/10m, relearning 10m,
 * and fuzz on so cards imported together do not all fall due on one day. The
 * fuzz is seeded by the card id, so the interval shown on a grade button is
 * exactly the interval that grade produces.
 *
 * Backward compatibility: a card has only `front`/`back` (new), or SM-2 fields
 * from before FSRS (`ease`, `intervalDays`, `reps`, `dueAt`), or FSRS fields.
 * SM-2 cards keep their due day; on their next review their memory state is
 * derived from ease and interval (`memoryFromSm2`), so nobody's progress resets.
 * `dueAt` stays a local YYYY-MM-DD day because the Daily Study Agent and the
 * deck counters read it directly.
 */
import {
  Rating,
  State,
  dateChrono,
  defineScheduler,
  schedulerDesiredRetentionMiddleware,
  schedulerFuzzingMiddleware,
  schedulerLearningStepsMiddleware,
  schedulerMaximumIntervalMiddleware,
  schedulerMonotonicIntervalMiddleware,
  schedulerScheduledDaysMiddleware,
  schedulerStatsMiddleware,
} from "ts-fsrs";
import {
  FSRS6Model,
  FSRS6_DEFAULT_WEIGHTS,
  migrateFSRS6Parameters,
} from "ts-fsrs/models/fsrs-6";
import type { Flashcard } from "@/lib/workspace/types";
import { daysBetween, isoDay, shiftDay, startOfLocalDay } from "./days";

export { isoDay } from "./days";

export type Grade = "again" | "hard" | "good" | "easy";
export const GRADES: Grade[] = ["again", "hard", "good", "easy"];

export type CardState = NonNullable<Flashcard["state"]>;

/** Target probability of recalling a card when it falls due. */
export const DESIRED_RETENTION = 0.9;
/** A review card with an interval at least this long counts as "mature". */
export const MATURE_DAYS = 21;

const LEARNING_STEPS = ["1m", "10m"] as const;
const RELEARNING_STEPS = ["10m"] as const;

const definition = defineScheduler({ model: FSRS6Model, chrono: dateChrono }).use(
  schedulerDesiredRetentionMiddleware,
  schedulerFuzzingMiddleware,
  schedulerStatsMiddleware,
  schedulerScheduledDaysMiddleware,
  schedulerLearningStepsMiddleware,
  schedulerMaximumIntervalMiddleware,
  schedulerMonotonicIntervalMiddleware,
);

const scheduler = definition.create({
  config: {
    fractionalDays: false,
    weights: migrateFSRS6Parameters(FSRS6_DEFAULT_WEIGHTS),
    enableShortTerm: true,
    numRelearningSteps: RELEARNING_STEPS.length,
    desiredRetention: DESIRED_RETENTION,
    learningSteps: [...LEARNING_STEPS],
    relearningSteps: [...RELEARNING_STEPS],
    allowModelOverride: false,
    enableFuzz: true,
    maximumInterval: 36_500,
  },
});

type SchedulerCard = Parameters<typeof scheduler.review>[0]["card"];
type ScheduledCard = ReturnType<typeof scheduler.review>["card"];

const RATING: Record<Grade, typeof Rating.Again | typeof Rating.Hard | typeof Rating.Good | typeof Rating.Easy> = {
  again: Rating.Again,
  hard: Rating.Hard,
  good: Rating.Good,
  easy: Rating.Easy,
};

const STATE_NUM: Record<CardState, State> = {
  new: State.New,
  learning: State.Learning,
  review: State.Review,
  relearning: State.Relearning,
};
const STATE_NAME: Record<number, CardState> = {
  [State.New]: "new",
  [State.Learning]: "learning",
  [State.Review]: "review",
  [State.Relearning]: "relearning",
};

/** A card can be studied only when both sides have content. */
export function isStudyable(card: Flashcard): boolean {
  return card.front.trim() !== "" && card.back.trim() !== "";
}

/** A card is "new" until it has been graded at least once. */
export function isNew(card: Flashcard): boolean {
  if (card.state) return card.state === "new";
  return card.reps === undefined || card.dueAt === undefined;
}

/** Is the card due on the local day of `now`? New cards are always due. */
export function isDue(card: Flashcard, now: Date): boolean {
  if (isNew(card)) return true;
  return card.dueAt! <= isoDay(now);
}

/** The card's state, deriving one for cards last reviewed under SM-2. */
export function cardState(card: Flashcard): CardState {
  if (card.state) return card.state;
  if (isNew(card)) return "new";
  return (card.intervalDays ?? 0) >= 1 ? "review" : "relearning";
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * FSRS memory state equivalent to an SM-2 card (same derivation Anki uses when
 * switching a collection to FSRS without review history). SM-2 schedules a
 * card at roughly 90% recall, which is FSRS's definition of stability, so
 * stability = interval. Difficulty inverts FSRS's stability-increase formula
 * for a successful review at that retention, so SM-2's growth factor (ease)
 * maps to the difficulty that would grow the interval the same way.
 */
export function memoryFromSm2(
  ease: number,
  intervalDays: number,
): { stability: number; difficulty: number } {
  const w = FSRS6_DEFAULT_WEIGHTS;
  const stability = Math.max(intervalDays, 0.1);
  const growth = Math.exp(w[8]) * Math.pow(stability, -w[9]) * Math.expm1((1 - DESIRED_RETENTION) * w[10]);
  const difficulty = clamp(11 - (Math.max(ease, 1.3) - 1) / growth, 1, 10);
  return { stability: round(stability), difficulty: round(difficulty) };
}

function round(n: number): number {
  return Math.round(n * 10_000) / 10_000;
}

/** When the card falls due, as an instant on this device. */
function dueInstant(card: Flashcard, now: Date): Date {
  if (card.dueTime) {
    const t = new Date(card.dueTime);
    if (!Number.isNaN(t.getTime())) return t;
  }
  return card.dueAt ? startOfLocalDay(card.dueAt) : now;
}

/** Convert a stored card into the scheduler's card, migrating SM-2 state. */
export function toSchedulerCard(card: Flashcard, now: Date): SchedulerCard {
  const state = cardState(card);
  if (state === "new") {
    return scheduler.newCard({ now, cardId: card.id }) as SchedulerCard;
  }
  const due = dueInstant(card, now);
  const interval = Math.max(0, card.intervalDays ?? 0);
  let memory: { stability: number; difficulty: number };
  if (card.state && card.stability && card.difficulty) {
    memory = { stability: card.stability, difficulty: card.difficulty };
  } else {
    // SM-2 card: a lapsed card (interval 0) gets a one-day memory.
    memory = memoryFromSm2(card.ease ?? 2.5, Math.max(interval, 1));
  }
  let lastReview = card.lastReviewedAt ? new Date(card.lastReviewedAt) : null;
  if (!lastReview || Number.isNaN(lastReview.getTime())) {
    lastReview = new Date(due.getTime() - interval * 86_400_000);
  }
  if (lastReview > now) lastReview = now;
  return {
    ...memory,
    state: STATE_NUM[state],
    scheduleStatus: state === "review" ? "review" : "learning",
    dueAt: due,
    lastReviewAt: lastReview,
    cardId: card.id,
    reps: card.reps ?? 0,
    lapses: card.lapses ?? 0,
    scheduledDays: interval,
    learningStep: card.learningStep ?? 0,
  } as SchedulerCard;
}

function fromScheduled(card: Flashcard, next: ScheduledCard, now: Date): Flashcard {
  return {
    ...card,
    stability: round(next.stability),
    difficulty: round(next.difficulty),
    state: STATE_NAME[next.state] ?? "review",
    lapses: next.lapses,
    learningStep: next.learningStep,
    reps: next.reps,
    intervalDays: next.scheduledDays,
    dueAt: isoDay(next.dueAt),
    dueTime: next.dueAt.toISOString(),
    lastReviewedAt: now.toISOString(),
  };
}

/**
 * Apply a grade to a card and return its NEXT scheduling state. Never mutates
 * its input. Content fields are carried over unchanged.
 */
export function reviewCard(card: Flashcard, grade: Grade, now: Date): Flashcard {
  const result = scheduler.review({ card: toSchedulerCard(card, now), grade: RATING[grade], now });
  return fromScheduled(card, result.card, now);
}

/** The card that each of the four grades would produce right now. */
export function previewCard(card: Flashcard, now: Date): Record<Grade, Flashcard> {
  const out = {} as Record<Grade, Flashcard>;
  for (const g of GRADES) out[g] = reviewCard(card, g, now);
  return out;
}

/** Milliseconds from `now` until a reviewed card is due again. */
export function msUntilDue(card: Flashcard, now: Date): number {
  return Math.max(0, dueInstant(card, now).getTime() - now.getTime());
}

/** Is the card in a (re)learning step that comes back within the session? */
export function isShortTerm(card: Flashcard): boolean {
  const s = cardState(card);
  return (s === "learning" || s === "relearning") && (card.intervalDays ?? 0) === 0;
}

/**
 * Estimated probability (0–1) the student recalls the card at `now`, or null
 * for a card never studied.
 */
export function retrievability(card: Flashcard, now: Date): number | null {
  if (cardState(card) === "new") return null;
  const sc = toSchedulerCard(card, now);
  const elapsed = Math.max(0, (now.getTime() - sc.lastReviewAt!.getTime()) / 86_400_000);
  return scheduler.model.forgettingCurve(sc, elapsed);
}

/** Copy only the scheduling fields of `from` onto `target` (in place). */
export function assignSchedule(target: Flashcard, from: Flashcard): void {
  target.ease = from.ease;
  target.intervalDays = from.intervalDays;
  target.reps = from.reps;
  target.dueAt = from.dueAt;
  target.lastReviewedAt = from.lastReviewedAt;
  target.stability = from.stability;
  target.difficulty = from.difficulty;
  target.state = from.state;
  target.lapses = from.lapses;
  target.learningStep = from.learningStep;
  target.dueTime = from.dueTime;
  for (const key of Object.keys(target) as (keyof Flashcard)[]) {
    if (target[key] === undefined) delete target[key];
  }
}

export interface DeckStats {
  total: number;
  due: number;
  new: number;
  learning: number; // seen but interval < 21d (not yet "mature")
  mature: number; // interval ≥ 21d
}

/** Summary counts for a deck at a given moment (blank cards are skipped). */
export function deckStats(cards: Flashcard[], now: Date): DeckStats {
  const stats: DeckStats = { total: cards.length, due: 0, new: 0, learning: 0, mature: 0 };
  for (const card of cards) {
    if (!isStudyable(card)) continue;
    if (isDue(card, now)) stats.due += 1;
    if (isNew(card)) stats.new += 1;
    else if ((card.intervalDays ?? 0) >= MATURE_DAYS) stats.mature += 1;
    else stats.learning += 1;
  }
  return stats;
}

/**
 * The cards to study now: cards in a learning step first, then reviews (most
 * overdue first), then new cards. Blank cards are never queued.
 */
export function dueQueue(cards: Flashcard[], now: Date): Flashcard[] {
  const due = cards.filter((c) => isStudyable(c) && isDue(c, now));
  const learning = due.filter((c) => !isNew(c) && isShortTerm(c));
  const reviews = due
    .filter((c) => !isNew(c) && !isShortTerm(c))
    .sort((a, b) => (a.dueAt! < b.dueAt! ? -1 : a.dueAt! > b.dueAt! ? 1 : 0));
  return [...learning, ...reviews, ...due.filter(isNew)];
}

/**
 * Every studyable card for practice ("cram") mode, weakest first: lowest
 * estimated recall, then cards never studied. Practice never changes the
 * schedule, so this is safe to run any time.
 */
export function practiceQueue(cards: Flashcard[], now: Date): Flashcard[] {
  const seen: { card: Flashcard; r: number }[] = [];
  const unseen: Flashcard[] = [];
  for (const card of cards) {
    if (!isStudyable(card)) continue;
    const r = retrievability(card, now);
    if (r === null) unseen.push(card);
    else seen.push({ card, r });
  }
  seen.sort((a, b) => a.r - b.r);
  return [...seen.map((s) => s.card), ...unseen];
}

/** Days from the local day of `now` until the card is due (≤0 = due). */
export function daysUntilDue(card: Flashcard, now: Date): number {
  if (isNew(card) || !card.dueAt) return 0;
  return daysBetween(isoDay(now), card.dueAt);
}

/** The day `n` days after the local day of `now`. */
export function dayFromNow(now: Date, n: number): string {
  return shiftDay(isoDay(now), n);
}
