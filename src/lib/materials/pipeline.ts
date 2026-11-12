/**
 * One study-kit run: read the planned sections of a material, one model call
 * per section (a few in parallel), then verify, deduplicate and balance.
 *
 * Honest-failure rules, matching workspace generation (lib/ai/generate.ts):
 * - A section gets one retry for a transient failure, an unreadable reply,
 *   or a reply with nothing usable in it. The first FREE_FAILED_ATTEMPTS
 *   failed attempts of a run are not reported to the caller's usage meter,
 *   so they are never billed; later ones are reported like any other call,
 *   so a document built to make most sections fail cannot buy unlimited
 *   unbilled model work (a run that delivers anything is charged for them,
 *   still never above the cap shown up front).
 * - A section that still fails is skipped and reported; the run succeeds
 *   with what the other sections made. A run that made nothing usable throws
 *   KitFailedError, and the caller charges nothing.
 * - Cancelling (the signal) stops new calls, aborts in-flight ones, reports
 *   only what the cut-off calls consumed, and throws KitCancelledError.
 *
 * The model is injected (`complete`), has no tools, and only ever sees one
 * section of fenced material; see ./prompt.
 */
import { AiRefusalError } from "@/lib/ai/anthropic";
import { forwardUsage, withUsageMeter, type TokenUsage } from "@/lib/ai/usage-meter";
import type { QuizQuestion } from "@/lib/workspace/types";
import { allocateByWeight, balance, dropNearDuplicates, verifyItems, type Verified } from "./assemble";
import {
  kitTargets,
  sectionQuotas,
  type KitAmount,
  type KitOutputs,
  type RunPlan,
} from "./limits";
import {
  parseSectionReply,
  type ProposedCard,
  type ProposedNote,
  type ProposedQuestion,
} from "./parse";
import { cleanNotes, noteSectionsFor, notePages } from "./notes";
import { KIT_SYSTEM_PROMPT, sectionUserPrompt } from "./prompt";
import type { Skeleton } from "./quote";
import type { KitCard, KitEvent, KitNoteSection, KitResult, KitStats } from "./types";

/** Asked per section beyond its quota, to make up for items verification drops. */
const OVERASK = 1.4;
const MAX_CARDS_PER_SECTION = 18;
const MAX_QUESTIONS_PER_SECTION = 12;
/** Upper bound for one section call; the run's deadline may cut it shorter. */
export const SECTION_CALL_TIMEOUT_MS = 150_000;
/** Do not start an attempt with less time than this left before the deadline. */
const MIN_ATTEMPT_MS = 30_000;
/** The practice-quiz mix the prompt asks for, kept when trimming to the amount. */
const QUESTION_MIX: Record<string, number> = { mcq: 3, true_false: 1, short: 1 };
/** Sections worked on at once. */
const DEFAULT_CONCURRENCY = 5;
/** Failed attempts per run whose model usage is never billed (see above). */
export const FREE_FAILED_ATTEMPTS = 2;

export type KitComplete = (
  system: string,
  user: string,
  options: { signal: AbortSignal; timeoutMs: number },
) => Promise<string>;

export class KitCancelledError extends Error {
  constructor() {
    super("Study kit cancelled");
    this.name = "KitCancelledError";
  }
}

/** The run delivered nothing usable. Nothing to save or charge. */
export class KitFailedError extends Error {
  constructor(message = "Study kit made nothing usable", options?: { cause?: unknown }) {
    super(message, options);
    this.name = "KitFailedError";
  }
}

export interface KitRunInput {
  material: { id: string; title: string; pages: readonly string[] };
  plan: RunPlan;
  outputs: KitOutputs;
  amount: KitAmount;
  /** English name of the output language, or null for the material's own. */
  language: string | null;
  complete: KitComplete;
  signal?: AbortSignal;
  /** Epoch ms by which model work must be finished. */
  deadline?: number;
  concurrency?: number;
  onEvent?: (event: KitEvent) => void;
  newId?: () => string;
  /** Marker token fencing the material in the prompt (random by default). */
  nonce?: string;
  /** Source of randomness for shuffling answer choices (tests pass a fixed one). */
  random?: () => number;
}

/** The text of a question's correct answer (for comparing questions). */
function answerOf(q: ProposedQuestion): string {
  if (q.kind === "mcq") return q.choices?.[q.answerIndex ?? -1] ?? "";
  if (q.kind === "true_false") return q.answerBool ? "true" : "false";
  return q.answerText ?? "";
}

/** Shuffle choices (Fisher–Yates) and return where the correct one ended up. */
export function shuffleChoices(
  choices: readonly string[],
  answerIndex: number,
  random: () => number = Math.random,
): { choices: string[]; answerIndex: number } {
  const order = choices.map((_, i) => i);
  for (let i = order.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  return { choices: order.map((i) => choices[i]), answerIndex: order.indexOf(answerIndex) };
}

interface SectionOutcome {
  ok: boolean;
  notes: ProposedNote[];
  cards: Verified<ProposedCard>[];
  questions: Verified<ProposedQuestion>[];
  proposed: number;
  unverified: number;
  malformed: number;
  copiedNotePoints: number;
}

const EMPTY: SectionOutcome = {
  ok: false,
  notes: [],
  cards: [],
  questions: [],
  proposed: 0,
  unverified: 0,
  malformed: 0,
  copiedNotePoints: 0,
};

function httpStatusOf(error: unknown): number | undefined {
  if (error && typeof error === "object" && "status" in error) {
    const status = (error as { status?: unknown }).status;
    if (typeof status === "number") return status;
  }
  const match = error instanceof Error ? error.message.match(/request failed \((\d{3})\)/) : null;
  return match ? Number(match[1]) : undefined;
}

/** Worth another try: unreadable output, timeouts, rate limits, 5xx, network. */
function isRetryable(error: unknown): boolean {
  if (error instanceof AiRefusalError) return false;
  const status = httpStatusOf(error);
  if (status === undefined) return true;
  return status === 408 || status === 409 || status === 429 || status >= 500;
}

function randomNonce(): string {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function runStudyKit(input: KitRunInput): Promise<KitResult> {
  const { material, plan, outputs, signal } = input;
  const sections = plan.sections;
  const emit = (event: KitEvent) => input.onEvent?.(event);
  const newId = input.newId ?? (() => crypto.randomUUID());
  const nonce = input.nonce ?? randomNonce();
  const random = input.random ?? Math.random;
  const throwIfCancelled = () => {
    if (signal?.aborted) throw new KitCancelledError();
  };

  const targets = kitTargets(input.amount, outputs, plan.chars);
  const cardQuotas = sectionQuotas(sections, targets.cards);
  const questionQuotas = sectionQuotas(sections, targets.questions);
  const ask = (quota: number, wanted: number, max: number) =>
    wanted > 0 ? Math.min(max, Math.max(2, Math.ceil(quota * OVERASK) + 1)) : 0;
  const pageChars = material.pages.map((page) => page.length);

  const outcomes: SectionOutcome[] = sections.map(() => EMPTY);
  let cancelledUsage = false;
  let freeFailures = FREE_FAILED_ATTEMPTS;
  // Failed attempts past the run's free allowance: reported (billed) once the
  // run delivers something or is cancelled; a run that fails as a whole is
  // free and counts against the daily failed-run quota instead.
  const billableFailures: TokenUsage[] = [];
  const failedAttempt = (usage: TokenUsage) => {
    if (freeFailures > 0) freeFailures -= 1;
    else billableFailures.push(usage);
  };
  const reportBillableFailures = () => {
    for (const usage of billableFailures.splice(0)) forwardUsage(usage);
  };

  const runSection = async (index: number): Promise<SectionOutcome> => {
    const section = sections[index];
    const askCards = ask(cardQuotas[index], targets.cards, MAX_CARDS_PER_SECTION);
    const askQuestions = ask(questionQuotas[index], targets.questions, MAX_QUESTIONS_PER_SECTION);
    // About one note section per topic the pages teach (not per 4,000
    // characters, which gave an eight-page lecture two sections).
    const askNotes = outputs.notes ? noteSectionsFor(pageChars, section.from, section.to) : 0;
    const user = sectionUserPrompt({
      title: material.title,
      pages: material.pages,
      from: section.from,
      to: section.to,
      index,
      total: sections.length,
      notes: askNotes,
      notePages: askNotes > 0 ? notePages(material.pages, section.from, section.to) : [],
      cards: askCards,
      questions: askQuestions,
      language: input.language,
      nonce,
    });
    const cache = new Map<number, Skeleton>();
    const range = { index, from: section.from, to: section.to };

    for (let attempt = 1; attempt <= 2; attempt += 1) {
      throwIfCancelled();
      const remaining = input.deadline !== undefined ? input.deadline - Date.now() : Infinity;
      if (remaining < MIN_ATTEMPT_MS) break;
      if (attempt > 1) emit({ type: "section", index, status: "retrying" });
      const controller = new AbortController();
      const onAbort = () => controller.abort(signal?.reason);
      signal?.addEventListener("abort", onAbort, { once: true });
      const metered = await withUsageMeter(async () => {
        try {
          const raw = await input.complete(KIT_SYSTEM_PROMPT, user, {
            signal: controller.signal,
            timeoutMs: Math.min(SECTION_CALL_TIMEOUT_MS, remaining),
          });
          return { ok: true as const, raw };
        } catch (error) {
          return { ok: false as const, error };
        }
      });
      signal?.removeEventListener("abort", onAbort);

      if (signal?.aborted) {
        // Cut off by the student: bill only what this call really consumed.
        forwardUsage(metered.usage);
        cancelledUsage = true;
        throw new KitCancelledError();
      }
      if (!metered.result.ok) {
        console.warn(`[StudyOS] study kit section ${index + 1} attempt ${attempt} failed`);
        failedAttempt(metered.usage);
        if (!isRetryable(metered.result.error)) break;
        continue;
      }

      let parsed;
      try {
        parsed = parseSectionReply(metered.result.raw, {
          notes: askNotes * 2,
          cards: askCards * 2,
          questions: askQuestions * 2,
        });
      } catch {
        failedAttempt(metered.usage);
        continue; // Unreadable reply: one more try.
      }
      const cards = verifyItems(parsed.cards, material.pages, range, cache);
      const questions = verifyItems(parsed.questions, material.pages, range, cache);
      // Study notes, not excerpts: bullets lifted from the material are dropped.
      const notes = cleanNotes(parsed.notes, material.pages, section);
      const usable = cards.kept.length + questions.kept.length + notes.notes.length;
      if (usable === 0) {
        failedAttempt(metered.usage);
        continue; // Nothing usable: retry once.
      }

      forwardUsage(metered.usage);
      return {
        ok: true,
        notes: notes.notes,
        cards: cards.kept,
        questions: questions.kept,
        proposed: parsed.cards.length + parsed.questions.length,
        unverified: cards.dropped + questions.dropped,
        malformed: parsed.malformed,
        copiedNotePoints: notes.copied,
      };
    }
    return EMPTY;
  };

  // A small worker pool: sections start in document order.
  let next = 0;
  const worker = async () => {
    while (next < sections.length) {
      const index = next;
      next += 1;
      if (signal?.aborted) return;
      emit({ type: "section", index, status: "working" });
      const outcome = await runSection(index);
      outcomes[index] = outcome;
      emit(
        outcome.ok
          ? { type: "section", index, status: "done", made: outcome.cards.length + outcome.questions.length }
          : { type: "section", index, status: "failed" },
      );
    }
  };
  const workers = Array.from(
    { length: Math.min(sections.length, Math.max(1, input.concurrency ?? DEFAULT_CONCURRENCY)) },
    worker,
  );
  const settled = await Promise.allSettled(workers);
  if (signal?.aborted || cancelledUsage) {
    reportBillableFailures();
    throw new KitCancelledError();
  }
  const crashed = settled.find((s): s is PromiseRejectedResult => s.status === "rejected");
  if (crashed) throw crashed.reason;

  if (!outcomes.some((o) => o.ok)) throw new KitFailedError();
  reportBillableFailures();
  throwIfCancelled();
  emit({ type: "checking" });

  // Across the whole document: duplicates out, then balance to the targets.
  const allCards = outcomes.flatMap((o) => o.cards);
  const allQuestions = outcomes.flatMap((o) => o.questions);
  const uniqueCards = dropNearDuplicates(allCards, (c) => c.front, (c) => c.back);
  const uniqueQuestions = dropNearDuplicates(allQuestions, (q) => q.prompt, answerOf);
  const chosenCards = balance(uniqueCards.kept, cardQuotas, targets.cards);
  // Balance each question kind across the document separately, so the quiz
  // keeps its mix of kinds as well as its coverage.
  const byKind = new Map<string, Verified<ProposedQuestion>[]>();
  for (const entry of uniqueQuestions.kept) {
    byKind.set(entry.item.kind, [...(byKind.get(entry.item.kind) ?? []), entry]);
  }
  const kindTargets = allocateByWeight(
    targets.questions,
    Object.fromEntries([...byKind.entries()].map(([kind, list]) => [kind, list.length])),
    QUESTION_MIX,
  );
  const chosenQuestions = [...byKind.entries()]
    .flatMap(([kind, list]) => balance(list, sectionQuotas(sections, kindTargets[kind]), kindTargets[kind]))
    .sort((a, b) => a.section - b.section || a.page - b.page || a.order - b.order);

  const label = material.title;
  const cards: KitCard[] = chosenCards.map((entry) => ({
    id: newId(),
    front: entry.item.front,
    back: entry.item.back,
    source: { materialId: material.id, page: entry.page, quote: entry.quote, label },
  }));
  const questions: QuizQuestion[] = chosenQuestions.map((entry) => {
    const q = entry.item;
    const question: QuizQuestion = {
      id: newId(),
      kind: q.kind,
      prompt: q.prompt,
      source: { materialId: material.id, page: entry.page, quote: entry.quote, label },
    };
    if (q.kind === "mcq" && q.choices && q.answerIndex !== undefined) {
      // Models favour some answer positions; shuffling in code makes the
      // position of the right answer carry no information.
      const { choices, answerIndex } = shuffleChoices(q.choices, q.answerIndex, random);
      question.choices = choices;
      question.answerIndex = answerIndex;
    } else if (q.kind === "true_false") {
      question.answerBool = q.answerBool;
    } else {
      question.answerText = q.answerText;
    }
    if (q.explanation) question.explanation = q.explanation;
    if (q.topic) question.topic = q.topic;
    return question;
  });
  const notes: KitNoteSection[] = outcomes.flatMap((o) =>
    o.notes.map((n) => ({ heading: n.heading, points: n.points, page: n.page })),
  );

  if (cards.length + questions.length + notes.length === 0) throw new KitFailedError();

  const failed = sections
    .map((section, index) => ({ section, ok: outcomes[index].ok }))
    .filter((s) => !s.ok)
    .map((s) => ({ from: s.section.from, to: s.section.to }));
  const stats: KitStats = {
    proposed: outcomes.reduce((sum, o) => sum + o.proposed, 0),
    unverified: outcomes.reduce((sum, o) => sum + o.unverified, 0),
    malformed: outcomes.reduce((sum, o) => sum + o.malformed, 0),
    copiedNotePoints: outcomes.reduce((sum, o) => sum + o.copiedNotePoints, 0),
    duplicates: uniqueCards.dropped + uniqueQuestions.dropped,
    surplus:
      uniqueCards.kept.length - chosenCards.length + (uniqueQuestions.kept.length - chosenQuestions.length),
    sections: sections.length,
    failedSections: failed.length,
    failedRanges: failed,
  };

  return {
    materialId: material.id,
    title: material.title,
    from: plan.from,
    to: plan.to,
    pageCount: material.pages.length,
    notes,
    cards,
    questions,
    stats,
  };
}
