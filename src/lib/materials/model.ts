/**
 * The model behind a study-kit run (server-only): the student's plan model
 * through the shared chat-completions path, with no tools, time-boxed and
 * cancellable. Plus a keyless stand-in for local development.
 */
import "server-only";
import { streamChatCompletion } from "@/lib/ai/openrouter";
import type { KitComplete } from "./pipeline";

/**
 * Output budget for one section. On Claude models thinking counts against
 * max_tokens, and a section's JSON (up to ~18 cards and 12 questions with
 * quotes) is ~5k tokens, so leave generous room rather than truncate.
 */
const SECTION_MAX_TOKENS = 14_000;

export function modelComplete(model: string): KitComplete {
  return (system, user, { signal, timeoutMs }) =>
    streamChatCompletion(
      model,
      [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      SECTION_MAX_TOKENS,
      {
        signal: AbortSignal.any([AbortSignal.timeout(Math.max(1, timeoutMs)), signal]),
        // Careful reading, not deep reasoning: keeps a section fast and cheap.
        reasoning: { effort: "low" },
        temperature: 0.3,
      },
    );
}

/**
 * Local development without an API key: cards made mechanically from the
 * material's own sentences, so the whole flow (verification, balancing, the
 * page, the citation viewer) can be exercised. Never used in production.
 */
export const mockComplete: KitComplete = async (_system, user) => {
  const pages = [...user.matchAll(/\[\[page (\d+)\]\]\n([\s\S]*?)(?=\n\[\[page |\nEND MATERIAL )/g)];
  const cards: unknown[] = [];
  const questions: unknown[] = [];
  const notes: unknown[] = [];
  for (const [, page, text] of pages) {
    const sentences = text
      .replace(/\s+/g, " ")
      .split(/(?<=[.!?])\s+/)
      .filter((s) => s.split(" ").length >= 6 && s.length <= 300);
    if (sentences.length === 0) continue;
    notes.push({ heading: sentences[0].split(" ").slice(0, 5).join(" "), page: Number(page), points: sentences.slice(0, 3) });
    for (const sentence of sentences.slice(0, 3)) {
      const words = sentence.split(" ");
      cards.push({
        front: `Complete: ${words.slice(0, 5).join(" ")} …`,
        back: words.slice(5).join(" "),
        page: Number(page),
        quote: sentence,
      });
    }
    questions.push({
      kind: "true_false",
      prompt: sentences[0],
      answerBool: true,
      explanation: "Stated in the material.",
      page: Number(page),
      quote: sentences[0],
    });
  }
  return JSON.stringify({ notes, cards, questions });
};
