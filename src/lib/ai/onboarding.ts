/**
 * StudyOS — onboarding questionnaire.
 *
 * After the student writes their one-line description, we ask a few quick
 * multiple-choice questions to tailor the generated workspace. The questions
 * are normally written by the AI (so they fit the description), but this module
 * also holds the pure types + a static fallback set, so the flow works with no
 * API key and never blocks generation.
 *
 * This file is intentionally dependency-free (no server-only imports) so it can
 * be shared by both the client UI and the server actions. Localized strings are
 * passed IN (the onboarding dictionary slice) rather than imported, so this
 * stays free of the full dictionary bundle.
 */
import type { Dictionary } from "@/lib/i18n/dictionaries/en";

export type QuestionType = "single" | "multi";

export interface QuestionOption {
  id: string;
  label: string;
  emoji?: string;
}

export interface GenQuestion {
  id: string;
  question: string;
  /** "single" = pick one, "multi" = pick any number. */
  type: QuestionType;
  options: QuestionOption[];
}

/** A user's answer to one question: the option labels they chose. */
export interface QuestionAnswer {
  question: string;
  answers: string[];
}

/**
 * Sensible, study-agnostic questions used when the AI can't write tailored ones.
 * Localized via the onboarding dictionary slice passed in by the caller.
 */
export function defaultQuestions(o: Dictionary["onboarding"]): GenQuestion[] {
  return [
    {
      id: "level",
      question: o.level.question,
      type: "single",
      options: [
        { id: "hs", label: o.level.options.hs, emoji: "🎒" },
        { id: "ug", label: o.level.options.ug, emoji: "🎓" },
        { id: "grad", label: o.level.options.grad, emoji: "📚" },
        { id: "self", label: o.level.options.self, emoji: "💡" },
      ],
    },
    {
      id: "load",
      question: o.load.question,
      type: "single",
      options: [
        { id: "1-2", label: "1–2", emoji: "🍃" },
        { id: "3-4", label: "3–4", emoji: "🌿" },
        { id: "5-6", label: "5–6", emoji: "🌳" },
        { id: "7+", label: "7+", emoji: "🌲" },
      ],
    },
    {
      id: "track",
      question: o.track.question,
      type: "multi",
      options: [
        { id: "assign", label: o.track.options.assign, emoji: "📝" },
        { id: "exams", label: o.track.options.exams, emoji: "🧪" },
        { id: "read", label: o.track.options.read, emoji: "📖" },
        { id: "notes", label: o.track.options.notes, emoji: "🗒️" },
        { id: "habits", label: o.track.options.habits, emoji: "🔥" },
        { id: "grades", label: o.track.options.grades, emoji: "💯" },
      ],
    },
    {
      id: "style",
      question: o.style.question,
      type: "single",
      options: [
        { id: "cal", label: o.style.options.cal, emoji: "🗓️" },
        { id: "board", label: o.style.options.board, emoji: "📋" },
        { id: "list", label: o.style.options.list, emoji: "✅" },
      ],
    },
  ];
}

/**
 * Turn the chosen answers into a short preference brief that gets appended to
 * the generation prompt. Returns "" when nothing was selected.
 */
export function formatPreferences(answers: QuestionAnswer[]): string {
  const lines = answers
    .filter((a) => a.answers.length > 0)
    .map((a) => `- ${a.question} ${a.answers.join(", ")}`);
  if (lines.length === 0) return "";
  return `The student answered a few onboarding questions:\n${lines.join("\n")}`;
}
