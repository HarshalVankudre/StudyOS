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
): Promise<string> {
  const res = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
      // Optional attribution headers OpenRouter uses for its dashboards.
      "HTTP-Referer": "https://studyos.app",
      "X-Title": "StudyOS",
    },
    body: JSON.stringify({ model, max_tokens: maxTokens, messages }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`OpenRouter request failed (${res.status}): ${detail}`);
  }

  const data = await res.json();
  recordUsage(data?.usage);
  const content: unknown = data?.choices?.[0]?.message?.content;
  if (typeof content !== "string") {
    throw new Error("OpenRouter returned no text content");
  }
  return content;
}
