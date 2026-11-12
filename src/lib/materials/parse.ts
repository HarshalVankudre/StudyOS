/**
 * Parse one section's model reply. Every item is validated on its own: a
 * malformed card or question is dropped and counted, never fatal, so one bad
 * item cannot cost the student the rest of the section. Only a reply with no
 * JSON object at all is an error (the caller may retry it).
 */
import { z } from "zod";
import { extractJson } from "@/lib/ai/generate";
import type { QuizQuestionKind } from "@/lib/workspace/types";
import { MAX_QUOTE_CHARS } from "./quote";

const MAX_TEXT = 600;
const MAX_HEADING = 160;
const MAX_POINT = 400;

/**
 * Generated text is rendered as Markdown. An image there would make the
 * reader's browser fetch a URL the model chose, a channel a hostile document
 * could use to leak data, so images (Markdown or HTML) are removed. Bounded
 * quantifiers keep this linear; the reply itself is capped by max_tokens.
 */
export function stripImages(s: string): string {
  return s
    .replace(/!\[[^\]\n]{0,300}\]\([^)\n]{0,2000}\)/g, "")
    .replace(/<img\b[^>\n]{0,2000}>?/gi, "");
}

const text = (max: number) =>
  z
    .string()
    .max(20_000)
    .transform((s) => stripImages(s).replace(/\s+/g, " ").trim())
    .pipe(z.string().min(1).max(max));

const pageNumber = z
  .union([z.number(), z.string().regex(/^\s*\d{1,4}\s*$/).transform(Number)])
  .pipe(z.number().int().positive().max(100_000))
  .optional()
  .catch(undefined);

const indexNumber = z.union([
  z.number().int(),
  z.string().regex(/^\s*\d\s*$/).transform(Number),
]);

const boolValue = z.union([
  z.boolean(),
  z.enum(["true", "false", "True", "False"]).transform((s) => s.toLowerCase() === "true"),
]);

const noteSchema = z.object({
  heading: text(MAX_HEADING),
  page: pageNumber,
  points: z.array(z.unknown()).max(12),
});

const cardSchema = z.object({
  front: text(MAX_TEXT),
  back: text(MAX_TEXT),
  page: pageNumber,
  quote: text(MAX_QUOTE_CHARS * 1.5),
});

const common = {
  prompt: text(MAX_TEXT),
  explanation: text(MAX_TEXT).optional().catch(undefined),
  topic: text(80).optional().catch(undefined),
  page: pageNumber,
  quote: text(MAX_QUOTE_CHARS * 1.5),
};

const mcqSchema = z.object({
  kind: z.literal("mcq"),
  choices: z.array(text(300)).min(3).max(6),
  answerIndex: indexNumber,
  ...common,
});
const trueFalseSchema = z.object({
  kind: z.enum(["true_false", "truefalse", "tf"]).transform(() => "true_false" as const),
  answerBool: boolValue,
  ...common,
});
const shortSchema = z.object({
  kind: z.enum(["short", "short_answer"]).transform(() => "short" as const),
  answerText: text(MAX_TEXT),
  ...common,
});

const questionSchema = z.union([mcqSchema, trueFalseSchema, shortSchema]);

export interface ProposedNote {
  heading: string;
  points: string[];
  page?: number;
}

export interface ProposedCard {
  front: string;
  back: string;
  page?: number;
  quote: string;
}

export interface ProposedQuestion {
  kind: QuizQuestionKind;
  prompt: string;
  choices?: string[];
  answerIndex?: number;
  answerBool?: boolean;
  answerText?: string;
  explanation?: string;
  topic?: string;
  page?: number;
  quote: string;
}

export interface ParsedSection {
  notes: ProposedNote[];
  cards: ProposedCard[];
  questions: ProposedQuestion[];
  /** Items present in the reply but dropped as malformed. */
  malformed: number;
}

/** The reply held no JSON object we could read (worth one retry). */
export class UnreadableReplyError extends Error {
  constructor() {
    super("The model reply held no readable JSON object");
    this.name = "UnreadableReplyError";
  }
}

// "All of the above" and friends make "exactly one correct answer" false.
const META_CHOICE = /^(all|none|both|neither) of (the )?(above|these|them)\b/i;

function fold(s: string): string {
  return s.normalize("NFKC").toLowerCase().replace(/[\s.,;:!?"'()]+/g, " ").trim();
}

/** Extra rules zod cannot express. Returns null when the question is unusable. */
function checkQuestion(q: z.infer<typeof questionSchema>): ProposedQuestion | null {
  if (q.kind === "mcq") {
    const folded = q.choices.map(fold);
    // Two identical choices would mean two right answers (or a giveaway).
    if (new Set(folded).size !== folded.length) return null;
    if (q.choices.some((choice) => META_CHOICE.test(choice.trim()))) return null;
    if (q.answerIndex < 0 || q.answerIndex >= q.choices.length) return null;
    return {
      kind: "mcq",
      prompt: q.prompt,
      choices: q.choices,
      answerIndex: q.answerIndex,
      explanation: q.explanation,
      topic: q.topic,
      page: q.page,
      quote: q.quote,
    };
  }
  if (q.kind === "true_false") {
    return {
      kind: "true_false",
      prompt: q.prompt,
      answerBool: q.answerBool,
      explanation: q.explanation,
      topic: q.topic,
      page: q.page,
      quote: q.quote,
    };
  }
  return {
    kind: "short",
    prompt: q.prompt,
    answerText: q.answerText,
    explanation: q.explanation,
    topic: q.topic,
    page: q.page,
    quote: q.quote,
  };
}

function list(value: unknown, max: number): unknown[] {
  return Array.isArray(value) ? value.slice(0, max) : [];
}

/**
 * Parse a section reply. `limits` caps how many of each kind are read (the
 * model may over-produce; the extra is never even validated).
 */
export function parseSectionReply(
  raw: string,
  limits: { notes: number; cards: number; questions: number },
): ParsedSection {
  const json = extractJson(raw);
  if (!json || typeof json !== "object" || Array.isArray(json)) throw new UnreadableReplyError();
  const reply = json as Record<string, unknown>;
  let malformed = 0;

  const notes: ProposedNote[] = [];
  for (const item of list(reply.notes, limits.notes)) {
    const parsed = noteSchema.safeParse(item);
    if (!parsed.success) {
      malformed += 1;
      continue;
    }
    const points = parsed.data.points
      .map((p) => (typeof p === "string" ? stripImages(p.slice(0, 4_000)).replace(/\s+/g, " ").trim() : ""))
      .filter((p) => p.length > 0)
      .map((p) => (p.length > MAX_POINT ? `${p.slice(0, MAX_POINT - 1)}…` : p));
    if (points.length === 0) {
      malformed += 1;
      continue;
    }
    notes.push({ heading: parsed.data.heading, points, page: parsed.data.page });
  }

  const cards: ProposedCard[] = [];
  for (const item of list(reply.cards, limits.cards)) {
    const parsed = cardSchema.safeParse(item);
    if (!parsed.success) {
      malformed += 1;
      continue;
    }
    cards.push(parsed.data);
  }

  const questions: ProposedQuestion[] = [];
  for (const item of list(reply.questions, limits.questions)) {
    const parsed = questionSchema.safeParse(item);
    const checked = parsed.success ? checkQuestion(parsed.data) : null;
    if (!checked) {
      malformed += 1;
      continue;
    }
    questions.push(checked);
  }

  return { notes, cards, questions, malformed };
}
