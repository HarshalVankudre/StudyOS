"use client";

import { useRef } from "react";
import { Check, CircleHelp, X } from "lucide-react";
import { useI18n } from "@/lib/i18n/client";
import { isCorrect, type PreparedQuestion, type QuizAnswer } from "@/lib/study/quiz";
import { cn } from "@/lib/utils";
import { CardContent } from "../study/CardContent";
import { SourceChip } from "../study/SourceChip";

/** The correct answer of a question as display text (Markdown). */
export function correctAnswerText(q: PreparedQuestion, labels: { trueLabel: string; falseLabel: string }): string {
  const question = q.question;
  if (question.kind === "mcq") return question.choices?.[question.answerIndex ?? -1] ?? "";
  if (question.kind === "true_false") return question.answerBool ? labels.trueLabel : labels.falseLabel;
  return question.answerText ?? "";
}

/** The student's answer as display text (Markdown), or "" for no answer. */
export function givenAnswerText(
  q: PreparedQuestion,
  answer: QuizAnswer | undefined,
  labels: { trueLabel: string; falseLabel: string },
): string {
  if (!answer) return "";
  if (answer.kind === "mcq") return q.question.choices?.[answer.choice] ?? "";
  if (answer.kind === "true_false") return answer.value ? labels.trueLabel : labels.falseLabel;
  return answer.text;
}

/** Prompt of a question, with its quiz name in mixed sessions and its topic. */
export function QuestionPrompt({ q, showQuiz }: { q: PreparedQuestion; showQuiz?: boolean }) {
  const meta = [showQuiz ? q.quizTitle : null, q.question.topic].filter(Boolean).join(" · ");
  return (
    <div className="space-y-2">
      {meta && <p className="text-xs font-semibold text-ink-soft">{meta}</p>}
      <CardContent
        text={q.question.prompt}
        className="font-display text-lg font-semibold leading-snug text-ink sm:text-xl"
      />
    </div>
  );
}

/** Explanation and source shown after answering (practice) or in the review. */
export function Explanation({ q }: { q: PreparedQuestion }) {
  const { dict } = useI18n();
  const Q = dict.quiz;
  const explanation = q.question.explanation?.trim();
  if (!explanation && !q.question.source) return null;
  return (
    <div className="space-y-1.5 rounded-lg bg-hover/60 px-3 py-2">
      {explanation && (
        <>
          <p className="text-[11px] font-semibold text-ink-soft">{Q.explanation}</p>
          <CardContent text={explanation} className="text-sm text-ink" />
        </>
      )}
      {q.question.source && <SourceChip source={q.question.source} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Practice: one question, immediate feedback
// ---------------------------------------------------------------------------

/**
 * Answer controls for one practice question. Choices lock on the first tap
 * and show right and wrong at once; a short answer is typed, checked against
 * the model answer, then self-marked.
 */
export function PracticeAnswer({
  q,
  answer,
  shortChecked,
  onAnswer,
  onCheckShort,
}: {
  q: PreparedQuestion;
  answer: QuizAnswer | undefined;
  /** Short answer: the model answer is showing and waits for a self-mark. */
  shortChecked: boolean;
  onAnswer: (answer: QuizAnswer) => void;
  onCheckShort: (text: string) => void;
}) {
  const { dict } = useI18n();
  const Q = dict.quiz;
  const draft = useRef<HTMLTextAreaElement>(null);
  const question = q.question;
  const locked = answer !== undefined && (answer.kind !== "short" || answer.correct !== undefined);

  if (question.kind === "mcq") {
    return (
      <div role="group" aria-label={Q.choicesGroup} className="grid gap-2">
        {(q.choices ?? []).map((c, i) => {
          const chosen = answer?.kind === "mcq" && answer.choice === c.index;
          const right = c.index === question.answerIndex;
          return (
            <ChoiceButton
              key={c.index}
              n={i + 1}
              text={c.text}
              disabled={locked}
              state={!locked ? "idle" : right ? "right" : chosen ? "wrong" : "dim"}
              pressed={chosen}
              onClick={() => onAnswer({ kind: "mcq", choice: c.index })}
            />
          );
        })}
      </div>
    );
  }

  if (question.kind === "true_false") {
    return (
      <div role="group" aria-label={Q.choicesGroup} className="grid grid-cols-2 gap-2">
        {[true, false].map((value, i) => {
          const chosen = answer?.kind === "true_false" && answer.value === value;
          const right = question.answerBool === value;
          return (
            <ChoiceButton
              key={String(value)}
              n={i + 1}
              text={value ? Q.trueLabel : Q.falseLabel}
              plain
              disabled={locked}
              state={!locked ? "idle" : right ? "right" : chosen ? "wrong" : "dim"}
              pressed={chosen}
              onClick={() => onAnswer({ kind: "true_false", value })}
            />
          );
        })}
      </div>
    );
  }

  // Short answer: type, check, compare with the model answer, self-mark.
  const typed = answer?.kind === "short" ? answer.text : "";
  if (!shortChecked && !locked) {
    return (
      <div className="space-y-2">
        <textarea
          dir="auto"
          ref={draft}
          defaultValue={typed}
          aria-label={Q.typeAnswer}
          placeholder={Q.typeAnswerPlaceholder}
          rows={3}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
              e.preventDefault();
              onCheckShort(draft.current?.value ?? "");
            }
          }}
          className="min-h-24 w-full resize-y rounded-lg border border-line-strong bg-card px-3 py-2 text-base text-ink outline-none [field-sizing:content] placeholder:text-ink-soft/50 focus:border-ink/40"
        />
        <button
          onClick={() => onCheckShort(draft.current?.value ?? "")}
          className="min-h-12 w-full rounded-lg bg-ink px-6 py-3 text-sm font-semibold text-paper transition hover:bg-ink/90 sm:w-auto"
        >
          {Q.showModelAnswer}
        </button>
      </div>
    );
  }
  return (
    <div className="space-y-3">
      <AnswerPair
        given={typed}
        correct={question.answerText ?? ""}
        status={answer?.kind === "short" ? answer.correct : undefined}
      />
      {!locked && (
        <div className="space-y-2">
          <p className="text-sm font-medium text-ink">{Q.selfMarkPrompt}</p>
          <SelfMarkButtons onMark={(correct) => onAnswer({ kind: "short", text: typed, correct })} keys />
        </div>
      )}
    </div>
  );
}

export function SelfMarkButtons({
  onMark,
  value,
  keys,
  label,
}: {
  onMark: (correct: boolean) => void;
  value?: boolean;
  keys?: boolean;
  label?: string;
}) {
  const { dict } = useI18n();
  const Q = dict.quiz;
  return (
    <div role="group" aria-label={label ?? Q.selfMarkPrompt} className="grid grid-cols-2 gap-2">
      <button
        onClick={() => onMark(true)}
        aria-pressed={value === true}
        className={cn(
          "flex min-h-12 items-center justify-center gap-1.5 rounded-xl border px-3 text-sm font-semibold transition",
          value === true
            ? "border-emerald-500 bg-emerald-500 text-white"
            : "border-emerald-500/40 bg-card text-emerald-700 hover:bg-emerald-500/10 dark:text-emerald-300",
        )}
      >
        <Check className="size-4" aria-hidden />
        {Q.markRight}
        {keys && <Kbd>1</Kbd>}
      </button>
      <button
        onClick={() => onMark(false)}
        aria-pressed={value === false}
        className={cn(
          "flex min-h-12 items-center justify-center gap-1.5 rounded-xl border px-3 text-sm font-semibold transition",
          value === false
            ? "border-rose-500 bg-rose-500 text-white"
            : "border-rose-500/40 bg-card text-rose-700 hover:bg-rose-500/10 dark:text-rose-300",
        )}
      >
        <X className="size-4" aria-hidden />
        {Q.markWrong}
        {keys && <Kbd>2</Kbd>}
      </button>
    </div>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <span aria-hidden className="ms-1 hidden font-mono text-[11px] opacity-60 sm:inline">
      {children}
    </span>
  );
}

type ChoiceState = "idle" | "right" | "wrong" | "dim";

function ChoiceButton({
  n,
  text,
  plain,
  state,
  pressed,
  disabled,
  onClick,
}: {
  n: number;
  text: string;
  plain?: boolean;
  state: ChoiceState;
  pressed: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-pressed={pressed}
      data-state={state}
      className={cn(
        "flex min-h-12 w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-start text-base transition disabled:cursor-default sm:text-sm",
        state === "idle" && "border-line-strong bg-card text-ink hover:border-ink/30 hover:bg-hover",
        state === "right" && "border-emerald-500 bg-emerald-500/10 text-ink",
        state === "wrong" && "border-rose-500 bg-rose-500/10 text-ink",
        state === "dim" && "border-line bg-card text-ink-soft opacity-70",
      )}
    >
      <span
        aria-hidden
        className={cn(
          "grid size-7 shrink-0 place-items-center rounded-md font-mono text-xs font-semibold",
          state === "right"
            ? "bg-emerald-500 text-white"
            : state === "wrong"
              ? "bg-rose-500 text-white"
              : "bg-hover text-ink-soft",
        )}
      >
        {state === "right" ? <Check className="size-4" /> : state === "wrong" ? <X className="size-4" /> : n}
      </span>
      {plain ? <span className="font-semibold">{text}</span> : <CardContent text={text} className="min-w-0 flex-1" />}
    </button>
  );
}

/** "Your answer" next to "Correct answer", for feedback and the review. */
export function AnswerPair({
  given,
  correct,
  status,
  hideGiven,
}: {
  given: string;
  correct: string;
  /** true: right, false: wrong, undefined/null: not marked yet. */
  status?: boolean | null;
  hideGiven?: boolean;
}) {
  const { dict } = useI18n();
  const Q = dict.quiz;
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {!hideGiven && (
        <div
          className={cn(
            "rounded-lg border px-3 py-2",
            status === true
              ? "border-emerald-500/50 bg-emerald-500/5"
              : status === false
                ? "border-rose-500/50 bg-rose-500/5"
                : "border-line bg-card",
          )}
        >
          <p className="text-[11px] font-semibold text-ink-soft">{Q.yourAnswer}</p>
          {given.trim() ? (
            <CardContent text={given} className="text-sm text-ink" />
          ) : (
            <p className="text-sm italic text-ink-soft">{Q.noAnswer}</p>
          )}
        </div>
      )}
      <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/5 px-3 py-2">
        <p className="text-[11px] font-semibold text-emerald-700 dark:text-emerald-300">{Q.correctAnswer}</p>
        <CardContent text={correct} className="text-sm text-ink" />
      </div>
    </div>
  );
}

/** The right / wrong / to-mark verdict line after answering. */
export function Verdict({ correct }: { correct: boolean | null }) {
  const { dict } = useI18n();
  const Q = dict.quiz;
  if (correct === null) {
    return (
      <p className="flex items-center gap-2 text-sm font-semibold text-amber-700 dark:text-amber-300">
        <CircleHelp className="size-5" aria-hidden />
        {Q.toMark}
      </p>
    );
  }
  return (
    <p
      className={cn(
        "flex items-center gap-2 text-base font-bold",
        correct ? "text-emerald-700 dark:text-emerald-300" : "text-rose-700 dark:text-rose-300",
      )}
    >
      {correct ? <Check className="size-5" aria-hidden /> : <X className="size-5" aria-hidden />}
      {correct ? Q.correct : Q.incorrect}
    </p>
  );
}

// ---------------------------------------------------------------------------
// Exam: every question on one page, no feedback until submission
// ---------------------------------------------------------------------------

/**
 * One exam question. Choices are native radio buttons (arrow keys move within
 * a question, Tab moves between questions) and the number keys pick a choice
 * while focus is anywhere inside the question.
 */
export function ExamQuestion({
  q,
  number,
  total,
  answer,
  onAnswer,
}: {
  q: PreparedQuestion;
  number: number;
  total: number;
  answer: QuizAnswer | undefined;
  onAnswer: (answer: QuizAnswer | undefined) => void;
}) {
  const { dict, t } = useI18n();
  const Q = dict.quiz;
  const ref = useRef<HTMLFieldSetElement>(null);
  const question = q.question;
  const options: { value: string; text: string; plain?: boolean; pick: QuizAnswer }[] =
    question.kind === "mcq"
      ? (q.choices ?? []).map((c) => ({
          value: String(c.index),
          text: c.text,
          pick: { kind: "mcq", choice: c.index },
        }))
      : question.kind === "true_false"
        ? [true, false].map((value) => ({
            value: String(value),
            text: value ? Q.trueLabel : Q.falseLabel,
            plain: true,
            pick: { kind: "true_false", value },
          }))
        : [];
  const selected =
    answer?.kind === "mcq" ? String(answer.choice) : answer?.kind === "true_false" ? String(answer.value) : null;

  const onKeyDown = (e: React.KeyboardEvent) => {
    const target = e.target as HTMLElement;
    if (target.tagName === "TEXTAREA" || e.altKey || e.ctrlKey || e.metaKey) return;
    const i = Number(e.key) - 1;
    if (!Number.isInteger(i) || i < 0 || i >= options.length) return;
    e.preventDefault();
    onAnswer(options[i].pick);
    ref.current?.querySelectorAll<HTMLInputElement>("input[type=radio]")[i]?.focus();
  };

  const legend = t(Q.questionOf, { n: number, total });
  return (
    <fieldset
      ref={ref}
      onKeyDown={onKeyDown}
      data-testid="exam-question"
      className="w-full min-w-0 space-y-3 rounded-2xl border border-line-strong bg-card p-4 shadow-card sm:p-5"
    >
      <legend className="sr-only">{legend}</legend>
      <p aria-hidden className="font-mono text-[11px] font-semibold text-ink-soft">
        {t(Q.questionNumber, { n: number })}
      </p>
      <QuestionPrompt q={q} showQuiz={false} />
      {question.kind === "short" ? (
        <textarea
          dir="auto"
          value={answer?.kind === "short" ? answer.text : ""}
          onChange={(e) => onAnswer(e.target.value ? { kind: "short", text: e.target.value } : undefined)}
          aria-label={`${Q.typeAnswer} (${legend})`}
          placeholder={Q.typeAnswerPlaceholder}
          rows={3}
          className="min-h-24 w-full resize-y rounded-lg border border-line-strong bg-paper px-3 py-2 text-base text-ink outline-none [field-sizing:content] placeholder:text-ink-soft/50 focus:border-ink/40"
        />
      ) : (
        <div className={cn("grid gap-2", question.kind === "true_false" && "grid-cols-2")}>
          {options.map((o, i) => (
            <label
              key={o.value}
              className={cn(
                "flex min-h-12 cursor-pointer items-center gap-3 rounded-xl border px-3 py-2.5 text-base transition has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ink/30 sm:text-sm",
                selected === o.value
                  ? "border-ink bg-hover text-ink"
                  : "border-line-strong bg-paper text-ink hover:bg-hover",
              )}
            >
              <input
                type="radio"
                name={q.key}
                value={o.value}
                checked={selected === o.value}
                onChange={() => onAnswer(o.pick)}
                className="sr-only"
              />
              <span
                aria-hidden
                className={cn(
                  "grid size-7 shrink-0 place-items-center rounded-md font-mono text-xs font-semibold",
                  selected === o.value ? "bg-ink text-paper" : "bg-hover text-ink-soft",
                )}
              >
                {i + 1}
              </span>
              {o.plain ? (
                <span className="font-semibold">{o.text}</span>
              ) : (
                <CardContent text={o.text} className="min-w-0 flex-1" />
              )}
            </label>
          ))}
        </div>
      )}
    </fieldset>
  );
}

/** Whether `answer` is right, for a prepared question. */
export const verdictOf = (q: PreparedQuestion, answer: QuizAnswer | undefined) => isCorrect(q.question, answer);
