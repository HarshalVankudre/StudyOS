/**
 * Token-usage meter.
 *
 * The AI functions deep in lib/ai don't know about users or billing — they just
 * call OpenRouter. This lets a request boundary (an API route / server action)
 * wrap that work and read back exactly how many GLM 5.2 tokens it consumed,
 * without changing any AI function signature.
 *
 * Mechanism: an AsyncLocalStorage accumulator. `withUsageMeter` opens a scope;
 * every OpenRouter response inside that scope calls `recordUsage`, adding to the
 * scope's running total. Each request gets its own isolated scope, so it is
 * safe under concurrency.
 */
import { AsyncLocalStorage } from "node:async_hooks";

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
}

const store = new AsyncLocalStorage<{ prompt: number; completion: number }>();

/** Run `fn` while accumulating OpenRouter token usage; returns its result + totals. */
export async function withUsageMeter<T>(
  fn: () => Promise<T>,
): Promise<{ result: T; usage: TokenUsage }> {
  const acc = { prompt: 0, completion: 0 };
  const result = await store.run(acc, fn);
  return {
    result,
    usage: { promptTokens: acc.prompt, completionTokens: acc.completion },
  };
}

/** Called by the OpenRouter callers after each response to add its usage. */
export function recordUsage(usage: unknown): void {
  const acc = store.getStore();
  if (!acc || !usage || typeof usage !== "object") return;
  const u = usage as Record<string, unknown>;
  if (typeof u.prompt_tokens === "number") acc.prompt += u.prompt_tokens;
  if (typeof u.completion_tokens === "number") acc.completion += u.completion_tokens;
}

/** Sum several usage totals (e.g. a multi-call agent turn). */
export function addUsage(...parts: TokenUsage[]): TokenUsage {
  return parts.reduce(
    (total, part) => ({
      promptTokens: total.promptTokens + part.promptTokens,
      completionTokens: total.completionTokens + part.completionTokens,
    }),
    { promptTokens: 0, completionTokens: 0 },
  );
}
