/**
 * What one model call really cost, per model.
 *
 * Credits are pegged to real token spend (see lib/credits.ts), so the price
 * of a call depends on the model that served it. Each entry is USD per
 * 1,000,000 tokens, split by the four kinds of tokens a provider can report:
 * plain input, output (thinking included), cache reads and cache writes.
 *
 * Pure and dependency-free so the usage meter, the agent's budget and the
 * tests can all use it.
 */

export interface TokenRates {
  inputPerMTok: number;
  outputPerMTok: number;
  /** Prompt tokens served from the provider's prompt cache. */
  cacheReadPerMTok: number;
  /** Prompt tokens written to the prompt cache (5-minute entries). */
  cacheWritePerMTok: number;
}

export interface ModelPrice extends TokenRates {
  /**
   * Higher rates that apply to the whole call once its prompt (uncached +
   * cache reads + cache writes) is larger than `thresholdTokens`.
   */
  longContext?: TokenRates & { thresholdTokens: number };
}

/** The four token counts a call can report. */
export interface CallTokens {
  /** Uncached input tokens (billed at the full input rate). */
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

/**
 * Known models. Keys are the ids `modelForPlan` can return: a bare Claude id
 * (Anthropic API) or an OpenRouter slug. Anthropic cache reads bill at 0.1x
 * input and 5-minute cache writes at 1.25x.
 */
export const MODEL_PRICES: Readonly<Record<string, ModelPrice>> = {
  // GLM 5.2 list price on OpenRouter (the rate credits were first pegged to).
  // OpenRouter does not publish a separate cached rate for it, so cached
  // tokens are billed as ordinary input.
  "z-ai/glm-5.2": {
    inputPerMTok: 1.4,
    outputPerMTok: 4.4,
    cacheReadPerMTok: 1.4,
    cacheWritePerMTok: 1.4,
  },
  "claude-haiku-5-5": {
    inputPerMTok: 0.1,
    outputPerMTok: 0.5,
    cacheReadPerMTok: 0.01,
    cacheWritePerMTok: 0.125,
    longContext: {
      thresholdTokens: 100_000,
      inputPerMTok: 0.5,
      outputPerMTok: 2.5,
      cacheReadPerMTok: 0.05,
      cacheWritePerMTok: 0.625,
    },
  },
  "claude-sonnet-5-5": {
    inputPerMTok: 2,
    outputPerMTok: 10,
    cacheReadPerMTok: 0.1,
    cacheWritePerMTok: 2.5,
  },
  "claude-opus-5-5": {
    inputPerMTok: 4,
    outputPerMTok: 20,
    cacheReadPerMTok: 0.2,
    cacheWritePerMTok: 5,
  },
};

/**
 * Rates for a model that is not in the table. Deliberately as high as the
 * most expensive model StudyOS is configured for, so a newly configured
 * model can never quietly cost more than the credits it charges.
 */
export const DEFAULT_MODEL_PRICE: ModelPrice = MODEL_PRICES["claude-opus-5-5"];

/** The legacy single rate, for usage that does not say which model ran. */
export const LEGACY_MODEL_PRICE: ModelPrice = MODEL_PRICES["z-ai/glm-5.2"];

const warned = new Set<string>();

/** Price for `model`: exact id, then a dated/suffixed variant, else the safe default. */
export function priceForModel(model: string | undefined): ModelPrice {
  if (!model) return LEGACY_MODEL_PRICE;
  const exact = MODEL_PRICES[model];
  if (exact) return exact;
  // "claude-haiku-5-5-20261001" or an OpenRouter "anthropic/claude-…" slug.
  const bare = model.replace(/^anthropic\//, "");
  for (const [id, price] of Object.entries(MODEL_PRICES)) {
    if (bare === id || bare.startsWith(`${id}-`)) return price;
  }
  if (!warned.has(model)) {
    warned.add(model);
    console.warn(
      JSON.stringify({
        severity: "WARNING",
        message: `No price for model "${model}"; charging at the safe default rate. Add it to MODEL_PRICES.`,
      }),
    );
  }
  return DEFAULT_MODEL_PRICE;
}

/** The rates that apply to one call (long-context tier when its prompt is large). */
export function ratesForCall(price: ModelPrice, tokens: CallTokens): TokenRates {
  const prompt = tokens.input + tokens.cacheRead + tokens.cacheWrite;
  return price.longContext && prompt > price.longContext.thresholdTokens
    ? price.longContext
    : price;
}

/** USD cost of one call on `model`. */
export function callCostUsd(model: string | undefined, tokens: CallTokens): number {
  const rates = ratesForCall(priceForModel(model), tokens);
  return (
    (Math.max(0, tokens.input) * rates.inputPerMTok +
      Math.max(0, tokens.output) * rates.outputPerMTok +
      Math.max(0, tokens.cacheRead) * rates.cacheReadPerMTok +
      Math.max(0, tokens.cacheWrite) * rates.cacheWritePerMTok) /
    1_000_000
  );
}
