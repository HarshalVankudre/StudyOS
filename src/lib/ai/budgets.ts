import type { Plan } from "./plans";
import { callCostUsd, priceForModel, ratesForCall } from "./model-pricing";

/** Server-owned, plan-aware limits for one agent turn's tool-loop. */
export interface AgentBudget {
  /** Hard wall-clock ceiling for the whole turn. */
  wallTimeMs: number;
  /** Max model calls (planner + each loop step). Ceiling for any request. */
  maxModelTurns: number;
  /** Max successful + attempted tool dispatches. */
  maxToolCalls: number;
  /** Max times a failed validation/apply/truncation may be retried. */
  maxRepairs: number;
  /**
   * Hard USD ceiling for the turn's model spend (the student's balance and
   * the plan's per-turn cap, converted at the credit peg). Every model call
   * is sized so that even its worst case stays under it; when the next call
   * cannot fit, the loop stops and keeps what it already changed.
   */
  maxCostUsd?: number;
  /** Multiplier on the per-request step allowance (Pro gets more room). */
  stepScale?: number;
}

// Every tier gets the full 5-minute window. The wall budget is the model-loop
// ceiling; the loop reserves a small tail under it (see agent-loop) and is
// anchored at request start, so the work still finishes within the route's
// `maxDuration = 300`. These turn/tool counts are ceilings; the allowance a
// given request actually gets is proportional to it (`stepsForRequest`).
const BUDGETS: Record<Plan, AgentBudget> = {
  free: { wallTimeMs: 300_000, maxModelTurns: 12, maxToolCalls: 16, maxRepairs: 2, stepScale: 1 },
  pro: { wallTimeMs: 300_000, maxModelTurns: 18, maxToolCalls: 26, maxRepairs: 3, stepScale: 1.5 },
};

/**
 * The most credits one agent message may spend, per plan, however large the
 * request. Free: a fifth of the monthly refresh; Pro: a tenth of the allowance.
 * Sized so a multi-step edit still fits on the default OpenRouter model.
 */
export const TURN_CREDIT_CAP: Record<Plan, number> = { free: 30, pro: 100 };

export function budgetForPlan(plan: Plan): AgentBudget {
  return BUDGETS[plan];
}

/**
 * Loop steps (model calls after planning) a request gets, by the kind of
 * work the planner chose and how many areas it touches. A one-row edit needs
 * one or two; a cross-workspace study plan needs more.
 */
const SKILL_STEPS: Record<string, number> = {
  "precise-edit": 4,
  "study-planner": 7,
  "flashcard-maker": 4,
  "quiz-maker": 4,
  "interactive-builder": 6,
  "render-visual": 6,
};

export function stepsForRequest(
  skillId: string,
  affectedAreaCount: number,
  budget: Pick<AgentBudget, "stepScale">,
): number {
  const base = SKILL_STEPS[skillId] ?? 4;
  const breadth = Math.min(3, Math.max(0, affectedAreaCount - 1));
  return Math.max(1, Math.round((base + breadth) * (budget.stepScale ?? 1)));
}

// ---------------------------------------------------------------------------
// Cost estimates (before the model runs)

/** Conservative characters-per-token for prompts (JSON-heavy, newer tokenizers). */
export const CHARS_PER_TOKEN = 3;

/** Typical output of one agent call, thinking included. */
export const TYPICAL_CALL_OUTPUT_TOKENS = 1_500;

export function estimateTokens(chars: number): number {
  return Math.ceil(Math.max(0, chars) / CHARS_PER_TOKEN);
}

/**
 * Worst-case USD of one call: every prompt token at the higher of the plain
 * input and cache-write rates, plus `outputTokens` of output.
 */
export function worstCaseCallUsd(model: string, promptTokens: number, outputTokens: number): number {
  const rates = ratesForCall(priceForModel(model), {
    input: promptTokens,
    output: outputTokens,
    cacheRead: 0,
    cacheWrite: 0,
  });
  const inputRate = Math.max(rates.inputPerMTok, rates.cacheWritePerMTok);
  return (promptTokens * inputRate + outputTokens * rates.outputPerMTok) / 1_000_000;
}

/** The most output tokens a call with this prompt can produce within `remainingUsd`. */
export function affordableOutputTokens(
  model: string,
  promptTokens: number,
  remainingUsd: number,
): number {
  const inputCost = worstCaseCallUsd(model, promptTokens, 0);
  const rates = ratesForCall(priceForModel(model), {
    input: promptTokens,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
  });
  const left = remainingUsd - inputCost;
  if (!(left > 0)) return 0;
  return Math.floor((left * 1_000_000) / rates.outputPerMTok);
}

/**
 * Expected USD of the smallest real edit: a planning call plus one step that
 * applies the change, each with a typical output. When the provider caches
 * (`cached`), the plan call writes the shared prefix and the step reads it.
 */
export function estimateSimpleTurnUsd(
  model: string,
  prefixTokens: number,
  cached: boolean,
): number {
  const stepExtra = 1_500; // execute instructions + focus areas + the plan itself
  const plan = callCostUsd(model, {
    input: cached ? 0 : prefixTokens,
    cacheWrite: cached ? prefixTokens : 0,
    cacheRead: 0,
    output: TYPICAL_CALL_OUTPUT_TOKENS,
  });
  const step = callCostUsd(model, {
    input: cached ? stepExtra : prefixTokens + stepExtra,
    cacheRead: cached ? prefixTokens : 0,
    cacheWrite: 0,
    output: TYPICAL_CALL_OUTPUT_TOKENS * 2,
  });
  return plan + step;
}
