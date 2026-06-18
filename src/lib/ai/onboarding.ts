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
 * be shared by both the client UI and the server actions.
 */

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

/** Sensible, study-agnostic questions used when the AI can't write tailored ones. */
export function defaultQuestions(): GenQuestion[] {
  return [
    {
      id: "level",
      question: "What's your study level?",
      type: "single",
      options: [
        { id: "hs", label: "High school", emoji: "🎒" },
        { id: "ug", label: "Undergrad", emoji: "🎓" },
        { id: "grad", label: "Grad / Postgrad", emoji: "📚" },
        { id: "self", label: "Self-study", emoji: "💡" },
      ],
    },
    {
      id: "load",
      question: "How many courses are you juggling?",
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
      question: "What do you most want to track?",
      type: "multi",
      options: [
        { id: "assign", label: "Assignments", emoji: "📝" },
        { id: "exams", label: "Exams", emoji: "🧪" },
        { id: "read", label: "Readings", emoji: "📖" },
        { id: "notes", label: "Notes", emoji: "🗒️" },
        { id: "habits", label: "Study habits", emoji: "🔥" },
        { id: "grades", label: "Grades", emoji: "💯" },
      ],
    },
    {
      id: "style",
      question: "How do you like to plan?",
      type: "single",
      options: [
        { id: "cal", label: "By calendar", emoji: "🗓️" },
        { id: "board", label: "By board", emoji: "📋" },
        { id: "list", label: "Simple lists", emoji: "✅" },
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
