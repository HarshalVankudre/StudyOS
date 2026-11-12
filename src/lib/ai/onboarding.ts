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
 * Limits for model-written questions. They are stated in the prompt, and
 * {@link normalizeGenQuestions} enforces them by trimming, so one long label
 * never throws away the whole reply. The question and label caps also keep
 * the answers inside what POST /api/generate accepts.
 */
export const QUESTION_LIMITS = {
  questions: 4,
  options: 6,
  questionChars: 140,
  labelChars: 40,
} as const;

/**
 * Shorten `text` to at most `max` characters, at a word boundary when one is
 * close, with an ellipsis. Whitespace is collapsed first.
 */
export function clipText(text: string, max: number): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, Math.max(1, max - 1));
  // Cut at a word boundary: the end of `cut` itself when a space follows it.
  const space = clean[cut.length] === " " ? cut.length : cut.lastIndexOf(" ");
  return `${(space >= max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,;:.–—-]+$/, "")}…`;
}

/** First visible character cluster (one emoji), or "" when it is not a short symbol. */
export function oneEmoji(value: unknown): string {
  if (typeof value !== "string") return "";
  const text = value.trim();
  if (!text) return "";
  let first = text;
  try {
    const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
    first = segmenter.segment(text)[Symbol.iterator]().next().value?.segment ?? text;
  } catch {
    first = Array.from(text)[0] ?? "";
  }
  // Letters and digits are not an icon ("A", "1"); keep pictographs and symbols.
  if (!first || /[\p{L}\p{N}]/u.test(first) || first.length > 16) return "";
  return first;
}

function slugId(value: unknown, fallback: string): string {
  const raw = typeof value === "string" || typeof value === "number" ? String(value) : "";
  const slug = raw
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return slug || fallback;
}

function uniqueIn(id: string, taken: Set<string>): string {
  let candidate = id;
  let n = 2;
  while (taken.has(candidate)) candidate = `${id}-${n++}`;
  taken.add(candidate);
  return candidate;
}

/**
 * Turn the model's questions reply into usable questions, repairing what can
 * be repaired: long text is trimmed, missing ids are made up, an unknown
 * type becomes "single", options may be plain strings, duplicates and empty
 * options are dropped. Only a question left with fewer than two options is
 * dropped. Returns [] when nothing usable is left.
 */
export function normalizeGenQuestions(raw: unknown): GenQuestion[] {
  const list = Array.isArray(raw)
    ? raw
    : raw && typeof raw === "object" && Array.isArray((raw as { questions?: unknown }).questions)
      ? (raw as { questions: unknown[] }).questions
      : [];
  const questionIds = new Set<string>();
  const out: GenQuestion[] = [];
  for (const [index, item] of list.entries()) {
    if (out.length >= QUESTION_LIMITS.questions) break;
    if (!item || typeof item !== "object") continue;
    const q = item as Record<string, unknown>;
    const text = typeof q.question === "string" ? clipText(q.question, QUESTION_LIMITS.questionChars) : "";
    if (!text) continue;
    const optionIds = new Set<string>();
    const labels = new Set<string>();
    const options: QuestionOption[] = [];
    for (const [optionIndex, rawOption] of (Array.isArray(q.options) ? q.options : []).entries()) {
      if (options.length >= QUESTION_LIMITS.options) break;
      const option =
        typeof rawOption === "string"
          ? { label: rawOption }
          : rawOption && typeof rawOption === "object"
            ? (rawOption as Record<string, unknown>)
            : null;
      if (!option || typeof option.label !== "string") continue;
      const label = clipText(option.label, QUESTION_LIMITS.labelChars);
      if (!label || labels.has(label.toLocaleLowerCase())) continue;
      labels.add(label.toLocaleLowerCase());
      const emoji = oneEmoji(option.emoji);
      options.push({
        id: uniqueIn(slugId(option.id ?? label, `o${optionIndex + 1}`), optionIds),
        label,
        ...(emoji ? { emoji } : {}),
      });
    }
    if (options.length < 2) continue;
    out.push({
      id: uniqueIn(slugId(q.id, `q${index + 1}`), questionIds),
      question: text,
      type: q.type === "multi" ? "multi" : "single",
      options,
    });
  }
  return out;
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
