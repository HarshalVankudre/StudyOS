/**
 * Anthropic Messages API backend for {@link chatCompletion} and
 * {@link streamChatCompletion} (see ./openrouter). Used when the selected model
 * is a bare Claude id — see `providerForModel` in ./provider.
 *
 * Differences from the OpenRouter path that callers never see:
 * - `system` messages are lifted into the top-level `system` parameter.
 * - `temperature` is never sent (Claude Haiku 5.5 rejects non-default values).
 * - Thinking is adaptive and on by default; its text is only returned when we
 *   ask for `display: "summarized"`, which we do when the caller streams
 *   reasoning (`onReasoning`). `max_tokens` covers thinking plus output.
 * - Assistant prefill is unsupported, so a trailing assistant turn is rejected.
 */
import Anthropic, { APIUserAbortError } from "@anthropic-ai/sdk";
import { getAnthropicClient } from "./anthropic-client";
import { recordUsage } from "./usage-meter";
import type { ChatMessage } from "./openrouter";

/** The model declined the request (`stop_reason: "refusal"`). */
export class AiRefusalError extends Error {
  readonly category: string | null;
  constructor(category: string | null, explanation: string | null) {
    const detail = [category && `category: ${category}`, explanation].filter(Boolean).join(" — ");
    super(`Anthropic refused the request${detail ? ` (${detail})` : ""}`);
    this.name = "AiRefusalError";
    this.category = category;
  }
}

export interface AnthropicCallOptions {
  signal?: AbortSignal;
  /** Called with thinking text as it streams; also turns on summarized thinking. */
  onReasoning?: (text: string) => void;
  /** Called with visible answer text as it streams. */
  onContent?: (text: string) => void;
}

/** Placeholder first turn when trimmed history starts with an assistant reply. */
const LEADING_USER_TURN = "(Earlier conversation omitted.)";

/** Split OpenAI-style messages into Anthropic's top-level `system` + turns. */
export function toAnthropicMessages(messages: ChatMessage[]): {
  system: string | undefined;
  messages: Anthropic.MessageParam[];
} {
  const systemParts: string[] = [];
  const turns: Anthropic.MessageParam[] = [];
  for (const message of messages) {
    if (message.role === "system") {
      if (message.content.trim()) systemParts.push(message.content);
      continue;
    }
    // The API rejects empty text blocks; an empty turn carries nothing anyway.
    if (!message.content.trim()) continue;
    turns.push({ role: message.role, content: message.content });
  }
  if (turns.length === 0) {
    throw new Error("Anthropic request has no user message to answer");
  }
  // The first turn must come from the user (a history slice can begin mid-chat).
  if (turns[0].role === "assistant") {
    turns.unshift({ role: "user", content: LEADING_USER_TURN });
  }
  if (turns[turns.length - 1].role === "assistant") {
    throw new Error("Anthropic models do not support assistant prefill; end with a user message");
  }
  return {
    system: systemParts.length ? systemParts.join("\n\n") : undefined,
    messages: turns,
  };
}

/**
 * Run one Messages API call through the SDK's streaming helper (streaming
 * keeps long generations clear of HTTP timeouts) and return the visible text.
 * Usage is recorded even when the call is aborted or fails mid-stream, so a
 * cut-off turn still bills for the tokens Anthropic reported.
 */
export async function anthropicCompletion(
  model: string,
  messages: ChatMessage[],
  maxTokens: number,
  options: AnthropicCallOptions = {},
): Promise<string> {
  const { system, messages: turns } = toAnthropicMessages(messages);
  const params: Anthropic.MessageStreamParams = {
    model,
    max_tokens: maxTokens,
    messages: turns,
  };
  if (system) params.system = system;
  if (options.onReasoning) params.thinking = { type: "adaptive", display: "summarized" };

  const stream = getAnthropicClient().messages.stream(params, { signal: options.signal });
  const { onReasoning, onContent } = options;
  if (onReasoning) {
    stream.on("thinking", (delta) => {
      if (delta) onReasoning(delta);
    });
  }
  if (onContent) {
    stream.on("text", (delta) => {
      if (delta) onContent(delta);
    });
  }

  let message: Anthropic.Message | undefined;
  try {
    message = await stream.finalMessage();
  } catch (error) {
    // Mirror fetch: an aborted request rejects with the signal's reason, so
    // callers that classify aborts see the same error on either provider.
    if (error instanceof APIUserAbortError && options.signal?.aborted) {
      throw options.signal.reason ?? error;
    }
    throw error;
  } finally {
    recordUsage((message ?? stream.currentMessage)?.usage);
  }

  if (message.stop_reason === "refusal") {
    throw new AiRefusalError(
      message.stop_details?.category ?? null,
      message.stop_details?.explanation ?? null,
    );
  }

  const text = message.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("");
  const truncated =
    message.stop_reason === "max_tokens" ||
    message.stop_reason === "model_context_window_exceeded";

  // Same distinct errors as the OpenRouter path: a truncation (raise
  // max_tokens — thinking counts against it) is not a transport failure.
  if (text.length === 0) {
    if (truncated) {
      throw new Error(
        `Anthropic response was truncated before any text (max_tokens=${maxTokens} too low)`,
      );
    }
    throw new Error("Anthropic returned no text content");
  }
  if (truncated) {
    throw new Error(
      `Anthropic response was truncated mid-output (max_tokens=${maxTokens} too low); the JSON is incomplete`,
    );
  }
  return text;
}
