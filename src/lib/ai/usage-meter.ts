/**
 * Token-usage meter.
 *
 * The AI functions deep in lib/ai don't know about users or billing — they just
 * call the model. This lets a request boundary (an API route / server action)
 * wrap that work and read back exactly how many tokens it consumed and what
 * they cost, without changing any AI function signature.
 *
 * Mechanism: an AsyncLocalStorage accumulator. `withUsageMeter` opens a scope;
 * every model response inside that scope calls `recordUsage`, adding to the
 * scope's running total. Each request gets its own isolated scope, so it is
 * safe under concurrency.
 *
 * Every call is priced when it is recorded, with the rates of the model that
 * served it (./model-pricing), so a scope's `costUsd` is the real spend even
 * when cache reads, cache writes or a long-context tier are involved.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { callCostUsd, type CallTokens } from "./model-pricing";

export interface TokenUsage {
  /** Every prompt token sent: uncached + cache writes + cache reads. */
  promptTokens: number;
  /** Output tokens, thinking included. */
  completionTokens: number;
  /** Of `promptTokens`, the ones served from the prompt cache. */
  cacheReadTokens?: number;
  /** Of `promptTokens`, the ones written to the prompt cache. */
  cacheWriteTokens?: number;
  /** Real USD cost of the recorded calls, priced per model. */
  costUsd?: number;
}

interface Accumulator {
  prompt: number;
  completion: number;
  cacheRead: number;
  cacheWrite: number;
  costUsd: number;
}

const store = new AsyncLocalStorage<Accumulator>();

const fresh = (): Accumulator => ({ prompt: 0, completion: 0, cacheRead: 0, cacheWrite: 0, costUsd: 0 });

function snapshot(acc: Accumulator): TokenUsage {
  return {
    promptTokens: acc.prompt,
    completionTokens: acc.completion,
    cacheReadTokens: acc.cacheRead,
    cacheWriteTokens: acc.cacheWrite,
    costUsd: acc.costUsd,
  };
}

/** Run `fn` while accumulating token usage; returns its result + totals. */
export async function withUsageMeter<T>(
  fn: () => Promise<T>,
): Promise<{ result: T; usage: TokenUsage }> {
  const acc = fresh();
  const result = await store.run(acc, fn);
  return { result, usage: snapshot(acc) };
}

/**
 * Like {@link withUsageMeter}, but keeps the usage when `fn` throws, so a
 * cancelled or budget-stopped run can be billed for exactly what it consumed.
 */
export async function withUsageMeterSettled<T>(
  fn: () => Promise<T>,
): Promise<{ result?: T; error?: unknown; failed: boolean; usage: TokenUsage }> {
  const acc = fresh();
  try {
    const result = await store.run(acc, fn);
    return { result, failed: false, usage: snapshot(acc) };
  } catch (error) {
    return { error, failed: true, usage: snapshot(acc) };
  }
}

/** The running totals of the current scope (null outside a meter). */
export function currentUsage(): TokenUsage | null {
  const acc = store.getStore();
  return acc ? snapshot(acc) : null;
}

/** Normalize a provider's usage payload into the four token kinds. */
export function callTokensFromUsage(usage: unknown): CallTokens | null {
  if (!usage || typeof usage !== "object") return null;
  const u = usage as Record<string, unknown>;
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  if (typeof u.prompt_tokens === "number" || typeof u.completion_tokens === "number") {
    // OpenRouter / OpenAI shape: prompt_tokens INCLUDES cached tokens, which
    // some providers break out under prompt_tokens_details.
    const details = (u.prompt_tokens_details ?? {}) as Record<string, unknown>;
    const cacheRead = num(details.cached_tokens);
    const cacheWrite = num(details.cache_write_tokens);
    return {
      input: Math.max(0, num(u.prompt_tokens) - cacheRead - cacheWrite),
      output: num(u.completion_tokens),
      cacheRead,
      cacheWrite,
    };
  }
  // Anthropic: `input_tokens` excludes cached input, which is reported
  // separately (cache writes and cache reads). `output_tokens` already
  // includes thinking tokens.
  return {
    input: num(u.input_tokens),
    output: num(u.output_tokens),
    cacheRead: num(u.cache_read_input_tokens),
    cacheWrite: num(u.cache_creation_input_tokens),
  };
}

/**
 * Called by the model callers after each response to add its usage. Accepts
 * OpenRouter's shape (`prompt_tokens` / `completion_tokens`) or Anthropic's
 * (`input_tokens` / `output_tokens` plus cache fields). `model` prices the
 * call; without it the legacy single rate applies.
 */
export function recordUsage(usage: unknown, model?: string): void {
  const acc = store.getStore();
  if (!acc) return;
  const tokens = callTokensFromUsage(usage);
  if (!tokens) return;
  // All of it was sent to the model, so prompt = uncached + writes + reads.
  acc.prompt += tokens.input + tokens.cacheWrite + tokens.cacheRead;
  acc.completion += tokens.output;
  acc.cacheRead += tokens.cacheRead;
  acc.cacheWrite += tokens.cacheWrite;
  acc.costUsd += callCostUsd(model, tokens);
}

/**
 * Add an already-metered total (e.g. a nested meter's usage) to the current
 * scope, keeping its priced cost. Unpriced totals fall back to `model`'s rates.
 */
export function forwardUsage(usage: TokenUsage, model?: string): void {
  const acc = store.getStore();
  if (!acc) return;
  const cacheRead = usage.cacheReadTokens ?? 0;
  const cacheWrite = usage.cacheWriteTokens ?? 0;
  acc.prompt += usage.promptTokens;
  acc.completion += usage.completionTokens;
  acc.cacheRead += cacheRead;
  acc.cacheWrite += cacheWrite;
  acc.costUsd +=
    typeof usage.costUsd === "number"
      ? usage.costUsd
      : callCostUsd(model, {
          input: Math.max(0, usage.promptTokens - cacheRead - cacheWrite),
          output: usage.completionTokens,
          cacheRead,
          cacheWrite,
        });
}

/** Sum several usage totals (e.g. a multi-call agent turn). */
export function addUsage(...parts: TokenUsage[]): TokenUsage {
  const total = parts.reduce<Required<TokenUsage>>(
    (sum, part) => ({
      promptTokens: sum.promptTokens + part.promptTokens,
      completionTokens: sum.completionTokens + part.completionTokens,
      cacheReadTokens: sum.cacheReadTokens + (part.cacheReadTokens ?? 0),
      cacheWriteTokens: sum.cacheWriteTokens + (part.cacheWriteTokens ?? 0),
      costUsd: sum.costUsd + (part.costUsd ?? 0),
    }),
    { promptTokens: 0, completionTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: 0 },
  );
  // A part without a recorded cost (built by hand) makes the sum unpriced, so
  // credits fall back to pricing the token counts instead of under-billing.
  // An empty part (no tokens) is priced at zero.
  const unpriced = (part: TokenUsage) =>
    typeof part.costUsd !== "number" && (part.promptTokens > 0 || part.completionTokens > 0);
  if (parts.some(unpriced)) {
    const { costUsd: _unpriced, ...rest } = total;
    void _unpriced;
    return rest;
  }
  return total;
}
