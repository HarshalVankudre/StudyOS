/**
 * Pure, dependency-free credit facts safe to import from CLIENT and server
 * (unlike lib/credits.ts, which pulls in Prisma): the credit peg (what a
 * credit is worth in model spend), the low-balance threshold, and the token
 * profiles that say what each kind of AI work really costs on a model.
 *
 * What an action COSTS THE STUDENT is not set here: every AI action has a
 * fixed, published credit price in lib/price-list.ts. The figures below are
 * only used there to find out whether the configured model's real cost can
 * exceed that price (then the action is charged its real cost, and the page
 * shows that before the student starts).
 */
import { callCostUsd, type CallTokens } from "@/lib/ai/model-pricing";

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

/** Warn the user at or below this balance. */
export const LOW_CREDIT_THRESHOLD = 50;

export function isLowBalance(credits: number): boolean {
  return credits <= LOW_CREDIT_THRESHOLD;
}

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

/** One study-kit section: ~3k tokens of material plus the prompt in, the kit out. */
export const TYPICAL_KIT_SECTION_TOKENS: CallTokens = { input: 6_000, output: 4_000, cacheRead: 0, cacheWrite: 0 };
/**
 * One study-kit section at its limits: two attempts (one retry, see
 * lib/materials/pipeline.ts), each over a full ~12,000-character section and
 * writing up to the section call's output budget (lib/materials/model.ts).
 */
export const MAX_KIT_SECTION_TOKENS: CallTokens = { input: 12_000, output: 28_000, cacheRead: 0, cacheWrite: 0 };
/** The setup questions before a build: one small call (lib/ai/generate.ts planQuestions). */
export const TYPICAL_QUESTIONS_TOKENS: CallTokens = { input: 2_500, output: 1_500, cacheRead: 0, cacheWrite: 0 };

export type WorkKind = "build" | "edit" | "kitSection" | "questions";
const DEFAULT_PROFILES: Record<WorkKind, CallTokens> = {
  build: TYPICAL_BUILD_TOKENS,
  edit: TYPICAL_EDIT_TOKENS,
  kitSection: TYPICAL_KIT_SECTION_TOKENS,
  questions: TYPICAL_QUESTIONS_TOKENS,
};

/**
 * Typical token use measured on a specific model, where it differs from the
 * default model's. Claude Haiku 5.5 reads the same prompts but writes far
 * less than GLM (whose reasoning is billed as output): on the local QA run of
 * 12 Nov 2026 its builds cost 1 to 2 credits of model spend, its edits 1 and
 * its study-kit runs 1 to 3 (CreditHold.charged), which this profile
 * reproduces.
 */
const MODEL_PROFILES: Readonly<Record<string, Partial<Record<WorkKind, CallTokens>>>> = {
  "claude-haiku-5-5": { build: { input: 22_000, output: 6_000, cacheRead: 0, cacheWrite: 0 } },
};

/** The typical tokens of one `kind` of work on `model`. */
export function typicalTokens(model: string, kind: WorkKind): CallTokens {
  return MODEL_PROFILES[model]?.[kind] ?? DEFAULT_PROFILES[kind];
}

/** The sum of two token profiles (a build and its setup questions). */
export function addTokens(a: CallTokens, b: CallTokens): CallTokens {
  return {
    input: a.input + b.input,
    output: a.output + b.output,
    cacheRead: a.cacheRead + b.cacheRead,
    cacheWrite: a.cacheWrite + b.cacheWrite,
  };
}

/** USD of `tokens` on `model`. */
export function tokensUsd(model: string, tokens: CallTokens): number {
  return callCostUsd(model, tokens);
}

/** Credits of model spend `tokens` cost on `model` (at the peg, rounded up). */
export function tokensCredits(model: string, tokens: CallTokens): number {
  return usdToCredits(callCostUsd(model, tokens));
}
