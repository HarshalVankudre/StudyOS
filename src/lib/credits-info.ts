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
