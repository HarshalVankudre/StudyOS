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
