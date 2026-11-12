/**
 * Practice quizzes and exam mode: the pure rules behind the quiz block.
 *
 * Nothing here touches React or the workspace store, so playability, choice
 * shuffling, scoring, per-question stats, attempt history and the "weak
 * questions" selection are all unit-testable on plain objects.
 *
 * Incomplete questions are allowed to exist (a student adds one and fills it
 * in, with autosave in between). They are skipped when taking a quiz, the
 * same rule flashcards use for blank sides.
 */
import { MAX_QUIZ_ATTEMPTS, MAX_QUIZ_CHOICES } from "@/lib/workspace/schema";
import type {
  QuizAttempt,
  QuizBlock,
  QuizQuestion,
  QuizQuestionKind,
  Workspace,
} from "@/lib/workspace/types";

export type Rng = () => number;

// ---------------------------------------------------------------------------
// Playability
// ---------------------------------------------------------------------------

/** What a half-written question is still missing (for the editor's hint). */
export type QuestionIssue = "prompt" | "choices" | "answer";

/** The non-blank choices of an MCQ, each with its index in `choices`. */
function filledChoices(q: QuizQuestion): { text: string; index: number }[] {
  return (q.choices ?? [])
    .slice(0, MAX_QUIZ_CHOICES)
    .map((text, index) => ({ text, index }))
    .filter((c) => typeof c.text === "string" && c.text.trim() !== "");
}

/** The first thing a question is missing, or null when it can be taken. */
export function questionIssue(q: QuizQuestion): QuestionIssue | null {
  if (!q.prompt?.trim()) return "prompt";
  switch (q.kind) {
    case "mcq": {
      const filled = filledChoices(q);
      if (filled.length < 2) return "choices";
      const i = q.answerIndex;
      if (typeof i !== "number" || !filled.some((c) => c.index === i)) return "answer";
      return null;
    }
    case "true_false":
      return typeof q.answerBool === "boolean" ? null : "answer";
    case "short":
      return q.answerText?.trim() ? null : "answer";
    default:
      return "answer";
  }
}

/** A question can be taken only when it is complete. */
export function isPlayableQuestion(q: QuizQuestion): boolean {
  return questionIssue(q) === null;
}

/** A fresh, empty question of `kind` (what "Add question" creates). */
export function newQuestion(kind: QuizQuestionKind, id: string = crypto.randomUUID()): QuizQuestion {
  switch (kind) {
    case "mcq":
      return { id, kind, prompt: "", choices: ["", ""] };
    case "true_false":
      return { id, kind, prompt: "" };
    case "short":
      return { id, kind, prompt: "", answerText: "" };
  }
}

/**
 * Change a question's kind, keeping the prompt, explanation, topic, source and
 * stats; answer fields that do not apply to the new kind are dropped.
 */
export function convertQuestion(q: QuizQuestion, kind: QuizQuestionKind): QuizQuestion {
  if (q.kind === kind) return q;
  const base: QuizQuestion = { ...newQuestion(kind, q.id), prompt: q.prompt };
  for (const key of ["explanation", "topic", "source", "stats"] as const) {
    if (q[key] !== undefined) (base as unknown as Record<string, unknown>)[key] = q[key];
  }
  return base;
}

/**
 * Remove choice `index` from an MCQ, keeping `answerIndex` pointing at the
 * same choice (or clearing it when the correct choice itself is removed).
 */
export function removeChoice(q: QuizQuestion, index: number): void {
  if (!q.choices || index < 0 || index >= q.choices.length) return;
  q.choices.splice(index, 1);
  if (q.answerIndex === index) delete q.answerIndex;
  else if (typeof q.answerIndex === "number" && q.answerIndex > index) q.answerIndex -= 1;
}

/** Move choice `index` by `delta`, keeping `answerIndex` on the same choice. */
export function moveChoice(q: QuizQuestion, index: number, delta: -1 | 1): void {
  const choices = q.choices;
  const j = index + delta;
  if (!choices || index < 0 || j < 0 || j >= choices.length) return;
  [choices[index], choices[j]] = [choices[j], choices[index]];
  if (q.answerIndex === index) q.answerIndex = j;
  else if (q.answerIndex === j) q.answerIndex = index;
}

// ---------------------------------------------------------------------------
// Preparing a run (shuffle without ever losing the correct choice)
// ---------------------------------------------------------------------------

/** Where a question lives, so results persist to the right block. */
export interface QuestionRef {
  pageId: string;
  blockId: string;
  questionId: string;
}

export interface QuizItem extends QuestionRef {
  question: QuizQuestion;
  /** Title of the quiz the question belongs to (shown in mixed sessions). */
  quizTitle?: string;
}

/** A displayed choice: its text and its index in the question's `choices`. */
export interface PreparedChoice {
  text: string;
  index: number;
}

export interface PreparedQuestion extends QuizItem {
  /** Unique within a run: `${pageId}:${blockId}:${questionId}`. */
  key: string;
  /** MCQ only: the non-blank choices in display order. */
  choices?: PreparedChoice[];
}

export const keyOfRef = (r: QuestionRef): string => `${r.pageId}:${r.blockId}:${r.questionId}`;

/** Fisher–Yates shuffle into a new array. */
export function shuffled<T>(items: readonly T[], rng: Rng = Math.random): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export interface PrepareOptions {
  shuffleQuestions?: boolean;
  shuffleChoices?: boolean;
  rng?: Rng;
}

/**
 * The questions of one run: incomplete ones are skipped, and question and
 * choice order are shuffled per run. A displayed choice always carries its
 * ORIGINAL index, and correctness is checked against that index, so no
 * shuffle can ever change which choice is correct.
 */
export function prepareRun(items: readonly QuizItem[], opts: PrepareOptions = {}): PreparedQuestion[] {
  const rng = opts.rng ?? Math.random;
  const seen = new Set<string>();
  const out: PreparedQuestion[] = [];
  for (const item of items) {
    if (!isPlayableQuestion(item.question)) continue;
    const key = keyOfRef(item);
    if (seen.has(key)) continue;
    seen.add(key);
    const prepared: PreparedQuestion = { ...item, key };
    if (item.question.kind === "mcq") {
      const choices = filledChoices(item.question);
      prepared.choices = opts.shuffleChoices === false ? choices : shuffled(choices, rng);
    }
    out.push(prepared);
  }
  return opts.shuffleQuestions === false ? out : shuffled(out, rng);
}

/** Every question of one quiz block as run items. */
export function quizItems(pageId: string, block: QuizBlock): QuizItem[] {
  return block.questions.map((question) => ({
    pageId,
    blockId: block.id,
    questionId: question.id,
    question,
    quizTitle: block.title,
  }));
}

// ---------------------------------------------------------------------------
// Answers and scoring
// ---------------------------------------------------------------------------

export type QuizAnswer =
  /** `choice` is the ORIGINAL index into `question.choices`. */
  | { kind: "mcq"; choice: number }
  | { kind: "true_false"; value: boolean }
  /** Short answers are self-marked: `correct` is unset until the student marks it. */
  | { kind: "short"; text: string; correct?: boolean };

/** Is `answer` right? null when there is no answer or a short answer is not yet self-marked. */
export function isCorrect(q: QuizQuestion, answer: QuizAnswer | undefined): boolean | null {
  if (!answer || answer.kind !== q.kind) return null;
  switch (answer.kind) {
    case "mcq":
      return answer.choice === q.answerIndex;
    case "true_false":
      return answer.value === q.answerBool;
    case "short":
      return typeof answer.correct === "boolean" ? answer.correct : null;
  }
}

export interface QuizScore {
  score: number;
  total: number;
  /** Keys answered correctly. */
  correct: string[];
  /** Keys answered wrong or left unanswered (what a re-drill covers). */
  missed: string[];
  /** Short answers still waiting to be self-marked. */
  unmarked: string[];
  /** Keys with no answer at all. */
  unanswered: string[];
}

export function scoreRun(
  questions: readonly PreparedQuestion[],
  answers: ReadonlyMap<string, QuizAnswer>,
): QuizScore {
  const s: QuizScore = { score: 0, total: questions.length, correct: [], missed: [], unmarked: [], unanswered: [] };
  for (const q of questions) {
    const answer = answers.get(q.key);
    const result = isCorrect(q.question, answer);
    if (!answer) s.unanswered.push(q.key);
    if (result === true) {
      s.score += 1;
      s.correct.push(q.key);
    } else if (result === null && answer?.kind === "short" && answer.text.trim() !== "") {
      s.unmarked.push(q.key);
    } else {
      s.missed.push(q.key);
    }
  }
  return s;
}

/** Whole-number percentage, 0 for an empty quiz. */
export function percent(score: number, total: number): number {
  return total > 0 ? Math.round((score / total) * 100) : 0;
}

// ---------------------------------------------------------------------------
// Persisting results (callers pass a cloned workspace draft)
// ---------------------------------------------------------------------------

export interface QuestionResult extends QuestionRef {
  correct: boolean;
}

/**
 * Add one answer to a question's running stats, built on the stats as they
 * are in the document it runs on. Idempotent: `at` (the run's moment) becomes
 * `lastAnsweredAt`, and an answer at or before the last recorded one is not
 * counted again. Monotonic, not "is it the latest one": a question answered
 * in two runs before a save is confirmed is still counted once per run when
 * both runs are replayed onto a document that already holds them.
 */
export function recordAnswer(q: QuizQuestion, correct: boolean, at: string): void {
  const last = q.stats?.lastAnsweredAt ? Date.parse(q.stats.lastAnsweredAt) : NaN;
  if (Number.isFinite(last) && last >= Date.parse(at)) return;
  const prev = q.stats ?? { attempts: 0, correct: 0 };
  q.stats = {
    attempts: prev.attempts + 1,
    correct: prev.correct + (correct ? 1 : 0),
    lastAnsweredAt: at,
  };
}

/**
 * Record an attempt, keeping only the newest MAX_QUIZ_ATTEMPTS. An attempt
 * with the same `at` (the same run) is updated in place, not added again: an
 * exam is saved at submission and updated as written answers are marked.
 */
export function pushAttempt(block: QuizBlock, attempt: QuizAttempt): void {
  const existing = block.attempts?.findIndex((a) => a.at === attempt.at) ?? -1;
  if (existing >= 0) {
    block.attempts![existing] = { ...attempt };
    return;
  }
  const attempts = [...(block.attempts ?? []), attempt];
  block.attempts = attempts.slice(-MAX_QUIZ_ATTEMPTS);
}

/**
 * Save a run into a workspace draft: every answered question's stats, and
 * optionally the run's attempt at a quiz (a full run of that quiz).
 *
 * Built for `update(fn, { rebase: "rerun" })`: questions and quizzes are found
 * by id wherever they are now (deleted ones are skipped silently), stats are
 * added to whatever the document holds (answers given on another device or an
 * agent edit meanwhile are kept), and running it again on a document that
 * already holds the run changes nothing (`at` is the natural key). Pass the
 * same `at` every time the same run is saved, never a fresh timestamp.
 */
export function applyRunResults(
  draft: Workspace,
  results: readonly QuestionResult[],
  attempt?: { pageId: string; blockId: string; attempt: QuizAttempt },
  runAt?: string,
): void {
  const at = runAt ?? attempt?.attempt.at ?? new Date().toISOString();
  const findQuiz = (pageId: string, blockId: string) => {
    const b = draft.pages.find((p) => p.id === pageId)?.blocks.find((x) => x.id === blockId);
    return b?.type === "quiz" ? b : undefined;
  };
  for (const r of results) {
    const q = findQuiz(r.pageId, r.blockId)?.questions.find((x) => x.id === r.questionId);
    if (q) recordAnswer(q, r.correct, at);
  }
  if (attempt) {
    const block = findQuiz(attempt.pageId, attempt.blockId);
    if (block) pushAttempt(block, attempt.attempt);
  }
}

// ---------------------------------------------------------------------------
// Weak questions (across every quiz in the workspace)
// ---------------------------------------------------------------------------

/** Every quiz question in a workspace, with where it lives. */
export function collectQuizItems(workspace: Pick<Workspace, "pages">): QuizItem[] {
  const out: QuizItem[] = [];
  for (const page of workspace.pages) {
    for (const block of page.blocks) {
      if (block.type === "quiz") out.push(...quizItems(page.id, block));
    }
  }
  return out;
}

/**
 * How much a question needs practice. The smoothed miss rate (a question never
 * answered counts as a coin flip), boosted for each repeated miss, so the
 * questions a student keeps getting wrong come up most and the ones they
 * reliably know rarely do (but never never).
 */
export function weakness(q: QuizQuestion): number {
  const attempts = Math.max(0, q.stats?.attempts ?? 0);
  const correct = Math.min(attempts, Math.max(0, q.stats?.correct ?? 0));
  const missed = attempts - correct;
  const missRate = (missed + 1) / (attempts + 2);
  return missRate * (1 + 0.5 * Math.min(missed, 4));
}

/**
 * Pick up to `count` playable questions for a weak-questions session,
 * weighted by `weakness` (weighted sampling without replacement), weakest
 * first. Deterministic for a given `rng`.
 */
export function selectWeakQuestions(
  items: readonly QuizItem[],
  count = 10,
  rng: Rng = Math.random,
): QuizItem[] {
  const keyed = items
    .filter((item) => isPlayableQuestion(item.question))
    .map((item) => {
      const w = weakness(item.question);
      // Efraimidis–Spirakis: key = u^(1/w); the largest keys win.
      const u = Math.min(Math.max(rng(), 1e-12), 1);
      return { item, w, key: Math.pow(u, 1 / w) };
    });
  keyed.sort((a, b) => b.key - a.key);
  return keyed
    .slice(0, Math.max(0, count))
    .sort((a, b) => b.w - a.w)
    .map((k) => k.item);
}

/** How many playable questions in a workspace have been missed at least once. */
export function countMissedQuestions(items: readonly QuizItem[]): number {
  return items.filter(
    (i) => isPlayableQuestion(i.question) && (i.question.stats?.attempts ?? 0) > (i.question.stats?.correct ?? 0),
  ).length;
}

// ---------------------------------------------------------------------------
// Duplication and agent edits
// ---------------------------------------------------------------------------

/** A copy of a quiz with fresh question ids and no history (what Duplicate makes). */
export function duplicateQuiz(block: QuizBlock, id: string, newId: () => string): QuizBlock {
  const copy = structuredClone(block);
  copy.id = id;
  copy.questions = copy.questions.map((q) => {
    const fresh = { ...q, id: newId() };
    delete fresh.stats;
    return fresh;
  });
  delete copy.attempts;
  return copy;
}

const CONTENT_KEYS = [
  "kind",
  "prompt",
  "choices",
  "answerIndex",
  "answerBool",
  "answerText",
] as const;

function sameContent(a: QuizQuestion, b: QuizQuestion): boolean {
  return CONTENT_KEYS.every((k) => JSON.stringify(a[k] ?? null) === JSON.stringify(b[k] ?? null));
}

/**
 * Reconcile a quiz block written by the AI agent with the version already in
 * the workspace (`prev`, the same block id), mutating `next`:
 *  - the student's history is never lost by omission: a question that keeps
 *    its id keeps its stats, and the block keeps its attempts, when the agent
 *    leaves those fields out;
 *  - a question the agent added or changed must be complete (the agent may
 *    re-send a student's half-written question untouched, but may not author
 *    one). Returns a description of the first incomplete question, or null.
 */
export function reconcileAgentQuiz(next: QuizBlock, prev: QuizBlock | undefined): string | null {
  const before = new Map((prev?.questions ?? []).map((q) => [q.id, q]));
  if (prev?.attempts && next.attempts === undefined) next.attempts = structuredClone(prev.attempts);
  for (const q of next.questions) {
    const old = before.get(q.id);
    if (old?.stats && q.stats === undefined) q.stats = { ...old.stats };
    if (old && sameContent(old, q)) continue;
    const issue = questionIssue(q);
    if (issue) {
      return `quiz "${next.id}" question "${q.id}" is incomplete (${
        issue === "prompt"
          ? "empty prompt"
          : issue === "choices"
            ? "an mcq needs 2 to 6 non-empty choices"
            : q.kind === "mcq"
              ? "answerIndex must point at a non-empty choice"
              : q.kind === "true_false"
                ? "answerBool is required"
                : "answerText is required"
      })`;
    }
  }
  return null;
}
