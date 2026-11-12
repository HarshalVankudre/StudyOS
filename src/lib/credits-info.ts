/**
 * Pure, dependency-free credit facts safe to import from CLIENT and server
 * (unlike lib/credits.ts, which pulls in Prisma). Holds the credit peg, the
 * low-balance threshold and the "what does a credit buy" translation into
 * human units — the transparency the research flags as essential to a credit
 * model people trust (never expose the raw token peg; always show what
 * credits mean).
 *
 * Typical costs are derived from the configured model's token rates (one
 * token profile per kind of work, priced with lib/ai/model-pricing.ts), so
 * they stay true when the owner changes STUDYOS_FREE_MODEL / STUDYOS_PRO_MODEL.
 * The constants below are those figures for the configured models; on the
 * server they follow the environment, in a client bundle (which cannot read
 * it) they are the default model's.
 */
import { callCostUsd, type CallTokens } from "@/lib/ai/model-pricing";
import { modelForPlan } from "@/lib/ai/plans";

/** The peg: 1000 credits buys $3.00 of token spend. */
export const USD_PER_1000_CREDITS = 3;
const USD_PER_CREDIT = USD_PER_1000_CREDITS / 1000; // $0.003

/** Credits for a dollar amount, rounded up (never below 1 when anything ran). */
export function usdToCredits(usd: number): number {
  if (!(usd > 0)) return 0;
  return Math.max(1, Math.ceil(usd / USD_PER_CREDIT - 1e-9));
}

/** The dollar value of `credits` at the peg. */
export function creditsToUsd(credits: number): number {
  return Math.max(0, credits) * USD_PER_CREDIT;
}

/** Flat credit price of one sandbox render run (covers Daytona compute). */
export const SANDBOX_RUN_CREDITS = 2;

/** Warn the user at or below this balance. */
export const LOW_CREDIT_THRESHOLD = 50;

/**
 * Token profiles. TYPICAL_* are what an ordinary run uses (measured on the
 * default model: a build is ~22k tokens in and ~20k out across the plan and
 * build calls, an agent edit ~5k in and ~3k out). MAX_BUILD_TOKENS is a
 * build at its limits: the plan call and the build call each writing up to
 * their output budget (thinking included) over a full 40,000-character
 * source document (lib/ai/generate.ts, lib/import/syllabus.ts).
 */
export const TYPICAL_BUILD_TOKENS: CallTokens = { input: 22_000, output: 20_000, cacheRead: 0, cacheWrite: 0 };
export const MAX_BUILD_TOKENS: CallTokens = { input: 60_000, output: 40_000, cacheRead: 0, cacheWrite: 0 };
export const TYPICAL_EDIT_TOKENS: CallTokens = { input: 5_000, output: 3_000, cacheRead: 0, cacheWrite: 0 };

const creditsFor = (model: string, tokens: CallTokens) => usdToCredits(callCostUsd(model, tokens));

/**
 * What a workspace build costs on `model`: typically, and at most. A build
 * starts only with the typical cost available, and reserves up to the most
 * it can cost (lib/credits.ts reserveCredits), so parallel builds cannot
 * share one balance and a larger build is covered whenever the balance is.
 */
export function buildCreditCost(model: string): { typical: number; max: number } {
  const typical = creditsFor(model, TYPICAL_BUILD_TOKENS);
  return { typical, max: Math.max(typical, creditsFor(model, MAX_BUILD_TOKENS)) };
}

/** What one ordinary agent edit / chat turn costs on `model`. */
export function editCreditCost(model: string): number {
  return creditsFor(model, TYPICAL_EDIT_TOKENS);
}

/** The more expensive of the two plans' models (what the pricing page quotes). */
function quotedCost(cost: (model: string) => number): number {
  return Math.max(cost(modelForPlan("free")), cost(modelForPlan("pro")));
}

/**
 * Rough averages for translating a credit balance into everyday actions on
 * the pricing/credits pages: typical costs, not guarantees — a request's
 * real cost scales with how much the AI does.
 */
export const CREDITS_PER_GENERATION = quotedCost((m) => buildCreditCost(m).typical); // a full workspace build
export const CREDITS_PER_EDIT = quotedCost(editCreditCost); // one agent edit / chat turn

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
