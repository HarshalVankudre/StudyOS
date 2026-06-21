/**
 * Low-level OpenRouter chat-completions call shared by the AI features.
 * Sends an OpenAI-style messages array and returns the assistant's text.
 * All StudyOS AI runs through here on the model chosen by `modelForPlan`.
 */
import { recordUsage } from "./usage-meter";

export const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export async function chatCompletion(
  model: string,
  messages: ChatMessage[],
  maxTokens = 7000,
  options?: { temperature?: number },
): Promise<string> {
  const body: Record<string, unknown> = { model, max_tokens: maxTokens, messages };
  if (typeof options?.temperature === "number") body.temperature = options.temperature;
  const res = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
      // Optional attribution headers OpenRouter uses for its dashboards.
      "HTTP-Referer": "https://studyos.app",
      "X-Title": "StudyOS",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`OpenRouter request failed (${res.status}): ${detail}`);
  }

  const data = await res.json();
  recordUsage(data?.usage);
  const choice = data?.choices?.[0];
  const content: unknown = choice?.message?.content;
  // GLM is a reasoning model and its reasoning tokens count against
  // `max_tokens`. When the budget runs out, OpenRouter returns finish_reason
  // "length" with content that is either empty or cut off mid-JSON. Surface
  // that as its own error so logs separate a truncation (raise max_tokens)
  // from a transport failure or a genuinely empty reply.
  if (typeof content !== "string" || content.length === 0) {
    if (choice?.finish_reason === "length") {
      throw new Error(
        `OpenRouter response was truncated before any text (max_tokens=${maxTokens} too low)`,
      );
    }
    throw new Error("OpenRouter returned no text content");
  }
  if (choice.finish_reason === "length") {
    throw new Error(
      `OpenRouter response was truncated mid-output (max_tokens=${maxTokens} too low); the JSON is incomplete`,
    );
  }
  return content;
}

/** Options for {@link streamChatCompletion}. */
export interface StreamChatOptions {
  temperature?: number;
  /** Aborts the upstream request (e.g. a wall-clock deadline). */
  signal?: AbortSignal;
  /**
   * Reasoning config sent to OpenRouter. Defaults to `{ enabled: true }` so a
   * reasoning model (GLM) surfaces its thinking in the stream without changing
   * the token economics (no forced effort/max_tokens). Pass `false` to omit.
   */
  reasoning?: Record<string, unknown> | false;
  /** Called with coalesced reasoning ("thinking") text as it streams. */
  onReasoning?: (text: string) => void;
  /** Called with visible answer text as it streams. */
  onContent?: (text: string) => void;
}

/** Flush reasoning to `onReasoning` once this many buffered chars accumulate. */
const REASONING_FLUSH_CHARS = 18;

/**
 * Streaming sibling of {@link chatCompletion}. Reads OpenRouter's SSE stream,
 * forwarding reasoning deltas to `onReasoning` and answer deltas to `onContent`,
 * and returns the fully accumulated visible answer text — so every existing
 * JSON-parsing caller keeps working unchanged. Usage is recorded from the final
 * chunk; truncation is surfaced with the same errors as the non-streaming path.
 */
export async function streamChatCompletion(
  model: string,
  messages: ChatMessage[],
  maxTokens = 7000,
  options?: StreamChatOptions,
): Promise<string> {
  const body: Record<string, unknown> = {
    model,
    max_tokens: maxTokens,
    messages,
    stream: true,
    // Ask OpenRouter to include token usage in the final SSE chunk.
    usage: { include: true },
  };
  if (typeof options?.temperature === "number") body.temperature = options.temperature;
  if (options?.reasoning !== false) body.reasoning = options?.reasoning ?? { enabled: true };

  const res = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
      Accept: "text/event-stream",
      // Optional attribution headers OpenRouter uses for its dashboards.
      "HTTP-Referer": "https://studyos.app",
      "X-Title": "StudyOS",
    },
    body: JSON.stringify(body),
    signal: options?.signal,
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`OpenRouter request failed (${res.status}): ${detail}`);
  }
  if (!res.body) {
    throw new Error("OpenRouter returned no response body to stream");
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let content = "";
  let finishReason: string | null = null;
  // Recorded once after the stream ends (last-wins) — recordUsage is additive,
  // so recording per-chunk would over-count if usage ever arrives cumulatively.
  let usagePayload: unknown = null;

  // Coalesce reasoning so we emit readable chunks rather than per-character noise.
  let reasoningPending = "";
  const flushReasoning = (force: boolean) => {
    if (!reasoningPending) return;
    if (!force && reasoningPending.length < REASONING_FLUSH_CHARS) return;
    options?.onReasoning?.(reasoningPending);
    reasoningPending = "";
  };

  const handleData = (data: string) => {
    if (data === "[DONE]") return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(data);
    } catch {
      return; // ignore partial/non-JSON keepalive payloads
    }
    const obj = parsed as {
      usage?: unknown;
      choices?: Array<{
        finish_reason?: string | null;
        delta?: {
          content?: unknown;
          reasoning?: unknown;
          reasoning_details?: Array<{ type?: string; text?: unknown }>;
        };
      }>;
    };
    if (obj.usage) usagePayload = obj.usage;
    const choice = obj.choices?.[0];
    if (!choice) return;
    if (typeof choice.finish_reason === "string") finishReason = choice.finish_reason;

    const delta = choice.delta;
    if (!delta) return;

    const reasoning = extractReasoning(delta);
    if (reasoning) {
      reasoningPending += reasoning;
      flushReasoning(reasoning.includes("\n"));
    }
    if (typeof delta.content === "string" && delta.content.length > 0) {
      content += delta.content;
      options?.onContent?.(delta.content);
    }
  };

  try {
    while (true) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      // SSE frames are newline-delimited; keep the trailing partial line buffered.
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const raw of lines) {
        const line = raw.trim();
        if (!line || line.startsWith(":")) continue; // blank or keepalive comment
        if (line.startsWith("data:")) handleData(line.slice(5).trim());
      }
      if (done) break;
    }
    // Drain any trailing buffered frame.
    const tail = buffer.trim();
    if (tail.startsWith("data:")) handleData(tail.slice(5).trim());
  } finally {
    // Even on abort/error: deliver buffered reasoning and record whatever usage
    // arrived, so the live "Thinking…" tail isn't lost and a cut-off turn still
    // bills for the tokens it reported.
    flushReasoning(true);
    if (usagePayload) recordUsage(usagePayload);
  }

  if (content.length === 0) {
    if (finishReason === "length") {
      throw new Error(
        `OpenRouter response was truncated before any text (max_tokens=${maxTokens} too low)`,
      );
    }
    throw new Error("OpenRouter returned no text content");
  }
  if (finishReason === "length") {
    throw new Error(
      `OpenRouter response was truncated mid-output (max_tokens=${maxTokens} too low); the JSON is incomplete`,
    );
  }
  return content;
}

/** Pull reasoning text from a streamed delta (normalized string or details array). */
function extractReasoning(delta: {
  reasoning?: unknown;
  reasoning_details?: Array<{ type?: string; text?: unknown }>;
}): string {
  if (typeof delta.reasoning === "string") return delta.reasoning;
  if (Array.isArray(delta.reasoning_details)) {
    return delta.reasoning_details
      .filter((d) => typeof d?.text === "string" && d.type?.startsWith("reasoning"))
      .map((d) => d.text as string)
      .join("");
  }
  return "";
}
