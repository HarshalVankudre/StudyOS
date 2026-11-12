/**
 * Typed model-call failures shared by both providers (./openrouter and
 * ./anthropic), so callers can recover from a truncation without matching
 * on error text.
 */

/**
 * The reply hit `max_tokens` (or the context window) before it was complete.
 * On Claude models thinking counts against `max_tokens`, so this can happen
 * with little or no visible text. `partial` is whatever text did arrive.
 */
export class AiTruncatedError extends Error {
  readonly maxTokens: number;
  readonly partial: string;
  constructor(message: string, maxTokens: number, partial = "") {
    super(message);
    this.name = "AiTruncatedError";
    this.maxTokens = maxTokens;
    this.partial = partial;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
