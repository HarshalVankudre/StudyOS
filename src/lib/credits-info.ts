/**
 * Pure, dependency-free credit facts safe to import from CLIENT and server
 * (unlike lib/credits.ts, which pulls in Prisma). Holds the low-balance
 * threshold and the "what does a credit buy" translation into human units —
 * the transparency the research flags as essential to a credit model people
 * trust (never expose the raw token peg; always show what credits mean).
 */

/** Warn the user at or below this balance. */
export const LOW_CREDIT_THRESHOLD = 50;

/**
 * Rough, deliberately conservative averages for translating a credit balance
 * into everyday actions on the pricing/credits pages. These are typical costs,
 * not guarantees — a request's real cost scales with how much the AI does.
 */
export const CREDITS_PER_GENERATION = 40; // a full workspace build
export const CREDITS_PER_EDIT = 7; // one agent edit / chat turn

/**
 * Balance needed to START a workspace build: about one typical build. A run
 * is charged at most the remaining balance, so without this a 1-credit
 * account would get a full build for 1 credit.
 */
export const MIN_GENERATION_BALANCE = CREDITS_PER_GENERATION;

/**
 * A study kit made from the student's material costs per section read (one
 * model call over ~12,000 characters, see lib/materials/limits). Typical: ~6k
 * tokens in and ~4k out at the GLM peg is about 9 credits. The cap is a
 * promise, not an estimate: the server never charges a run more than
 * STUDY_KIT_MAX_CREDITS_PER_SECTION per section, whatever the model used.
 */
export const STUDY_KIT_CREDITS_PER_SECTION = 9;
export const STUDY_KIT_MAX_CREDITS_PER_SECTION = 20;

/**
 * What a study-kit run of `sections` sections costs: typical, at most, and
 * the balance needed to start it. A run is charged at most the balance, so a
 * run starts only with its typical cost AND at least one section's full cap
 * (otherwise an account with a few credits would get a section almost free).
 */
export function studyKitCost(sections: number): { estimate: number; max: number; minBalance: number } {
  const n = Math.max(0, Math.floor(sections));
  const estimate = n * STUDY_KIT_CREDITS_PER_SECTION;
  const max = n * STUDY_KIT_MAX_CREDITS_PER_SECTION;
  return {
    estimate,
    max,
    minBalance: n > 0 ? Math.max(estimate, STUDY_KIT_MAX_CREDITS_PER_SECTION) : 0,
  };
}

export function isLowBalance(credits: number): boolean {
  return credits <= LOW_CREDIT_THRESHOLD;
}

/** ~how many workspace builds a balance affords (floored, non-negative). */
export function estimatedGenerations(credits: number): number {
  return Math.max(0, Math.floor(credits / CREDITS_PER_GENERATION));
}

/** ~how many agent edits a balance affords (floored, non-negative). */
export function estimatedEdits(credits: number): number {
  return Math.max(0, Math.floor(credits / CREDITS_PER_EDIT));
}
