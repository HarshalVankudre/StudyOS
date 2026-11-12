"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Check, Eye, Pencil, Plus, Trash2, X } from "lucide-react";
import { useI18n } from "@/lib/i18n/client";
import type { QuizBlock, QuizQuestion, QuizQuestionKind } from "@/lib/workspace/types";
import { MAX_QUIZ_CHOICES, MAX_QUIZ_QUESTIONS, MAX_QUIZ_TEXT } from "@/lib/workspace/schema";
import {
  convertQuestion,
  moveChoice,
  newQuestion,
  questionIssue,
  removeChoice,
} from "@/lib/study/quiz";
import { cn } from "@/lib/utils";
import { CardContent } from "../study/CardContent";
import { SourceChip } from "../study/SourceChip";

const KINDS: QuizQuestionKind[] = ["mcq", "true_false", "short"];

/**
 * Hand authoring of a quiz, phone first: each question is a card with a type
 * switch, auto-growing fields, large buttons to reorder or delete, and a hint
 * naming what a half-written question still needs. Half-written questions are
 * saved as they are and skipped when the quiz is taken. Every change goes
 * through the workspace update path (so it autosaves and Ctrl+Z undoes it);
 * deleting a question that has content asks first.
 */
export function QuizEditor({
  questions,
  mutate,
}: {
  questions: QuizQuestion[];
  mutate: (fn: (b: QuizBlock) => void) => void;
}) {
  const { dict, t } = useI18n();
  const Q = dict.quiz;
  const [previewing, setPreviewing] = useState(false);
  const [focusId, setFocusId] = useState<string | null>(null);
  const prompts = useRef(new Map<string, HTMLTextAreaElement>());

  useEffect(() => {
    if (!focusId) return;
    const el = prompts.current.get(focusId);
    if (el) {
      el.focus();
      el.scrollIntoView?.({ block: "nearest" });
      setFocusId(null);
    }
  }, [focusId, questions]);

  const atLimit = questions.length >= MAX_QUIZ_QUESTIONS;
  const unfinished = questions.filter((q) => questionIssue(q) !== null).length;

  const addQuestion = (kind: QuizQuestionKind) => {
    if (atLimit) return;
    const q = newQuestion(kind);
    mutate((b) => {
      if (b.questions.length < MAX_QUIZ_QUESTIONS) b.questions.push(q);
    });
    setPreviewing(false);
    setFocusId(q.id);
  };

  const edit = (id: string, fn: (q: QuizQuestion) => void) =>
    mutate((b) => {
      const q = b.questions.find((x) => x.id === id);
      if (q) fn(q);
    });

  const setKind = (id: string, kind: QuizQuestionKind) =>
    mutate((b) => {
      const i = b.questions.findIndex((x) => x.id === id);
      if (i >= 0) b.questions[i] = convertQuestion(b.questions[i], kind);
    });

  const move = (id: string, delta: -1 | 1) =>
    mutate((b) => {
      const i = b.questions.findIndex((x) => x.id === id);
      const j = i + delta;
      if (i < 0 || j < 0 || j >= b.questions.length) return;
      [b.questions[i], b.questions[j]] = [b.questions[j], b.questions[i]];
    });

  const remove = (id: string) =>
    mutate((b) => {
      b.questions = b.questions.filter((x) => x.id !== id);
    });

  return (
    <div className="space-y-3 border-t border-line px-3 py-3 sm:px-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-ink-soft">{Q.markdownHint}</p>
        {questions.length > 0 && (
          <button
            onClick={() => setPreviewing((v) => !v)}
            aria-pressed={previewing}
            className="flex min-h-11 items-center gap-1.5 rounded-lg px-3 text-xs font-semibold text-ink-soft transition hover:bg-hover hover:text-ink"
          >
            {previewing ? <Pencil className="size-4" aria-hidden /> : <Eye className="size-4" aria-hidden />}
            {previewing ? Q.edit : Q.preview}
          </button>
        )}
      </div>

      {questions.length === 0 && <p className="py-2 text-sm text-ink-soft">{Q.emptyQuiz}</p>}

      <ol className="space-y-3">
        {questions.map((q, index) => (
          <QuestionCard
            key={q.id}
            q={q}
            index={index}
            count={questions.length}
            previewing={previewing}
            promptRef={(el) => {
              if (el) prompts.current.set(q.id, el);
              else prompts.current.delete(q.id);
            }}
            onEdit={(fn) => edit(q.id, fn)}
            onKind={(kind) => setKind(q.id, kind)}
            onMove={(delta) => move(q.id, delta)}
            onRemove={() => remove(q.id)}
          />
        ))}
      </ol>

      {unfinished > 0 && (
        <p className="text-xs text-amber-700 dark:text-amber-400">{t(Q.incompleteSkipped, { count: unfinished })}</p>
      )}
      {atLimit ? (
        <p className="text-xs text-ink-soft">{t(Q.quizFull, { max: MAX_QUIZ_QUESTIONS })}</p>
      ) : (
        <div className="space-y-1.5">
          <p className="text-xs font-semibold text-ink-soft">{Q.addQuestion}</p>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            {KINDS.map((kind) => (
              <button
                key={kind}
                onClick={() => addQuestion(kind)}
                className="flex min-h-12 items-center justify-center gap-2 rounded-xl border border-dashed border-line-strong px-3 text-sm font-semibold text-ink-soft transition hover:border-ink/40 hover:text-ink"
              >
                <Plus className="size-4" aria-hidden />
                {Q.kinds[kind]}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function QuestionCard({
  q,
  index,
  count,
  previewing,
  promptRef,
  onEdit,
  onKind,
  onMove,
  onRemove,
}: {
  q: QuizQuestion;
  index: number;
  count: number;
  previewing: boolean;
  promptRef: (el: HTMLTextAreaElement | null) => void;
  onEdit: (fn: (q: QuizQuestion) => void) => void;
  onKind: (kind: QuizQuestionKind) => void;
  onMove: (delta: -1 | 1) => void;
  onRemove: () => void;
}) {
  const { dict, t } = useI18n();
  const Q = dict.quiz;
  const [confirming, setConfirming] = useState(false);
  const label = t(Q.questionNumber, { n: index + 1 });
  const issue = questionIssue(q);
  const hasContent =
    q.prompt.trim() !== "" ||
    (q.choices ?? []).some((c) => c.trim() !== "") ||
    !!q.answerText?.trim() ||
    !!q.explanation?.trim();

  const requestRemove = () => (hasContent ? setConfirming(true) : onRemove());

  return (
    <li aria-label={label} className="rounded-xl border border-line bg-paper p-2.5 sm:p-3">
      <div className="mb-2 flex flex-wrap items-center gap-1">
        <span className="me-auto font-mono text-[11px] font-semibold text-ink-soft">{label}</span>
        <IconButton label={`${Q.moveUp} (${label})`} onClick={() => onMove(-1)} disabled={index === 0}>
          <ArrowUp className="size-4" aria-hidden />
        </IconButton>
        <IconButton label={`${Q.moveDown} (${label})`} onClick={() => onMove(1)} disabled={index === count - 1}>
          <ArrowDown className="size-4" aria-hidden />
        </IconButton>
        <IconButton label={`${Q.deleteQuestion} (${label})`} onClick={requestRemove} danger>
          <Trash2 className="size-4" aria-hidden />
        </IconButton>
      </div>

      {confirming && (
        <div
          role="alertdialog"
          aria-label={Q.confirmDelete}
          className="mb-2 flex flex-wrap items-center gap-2 rounded-lg border border-rose-500/30 bg-rose-500/10 p-2"
        >
          <span className="me-auto text-sm font-medium text-ink">{Q.confirmDelete}</span>
          <button
            onClick={() => setConfirming(false)}
            className="min-h-11 rounded-lg px-3 text-sm font-semibold text-ink-soft transition hover:bg-hover"
          >
            {Q.keep}
          </button>
          <button
            onClick={() => {
              setConfirming(false);
              onRemove();
            }}
            className="min-h-11 rounded-lg bg-rose-600 px-3 text-sm font-semibold text-white transition hover:bg-rose-700"
          >
            {Q.confirmDeleteYes}
          </button>
        </div>
      )}

      {previewing ? (
        <QuestionPreview q={q} />
      ) : (
        <div className="space-y-2">
          <div role="radiogroup" aria-label={`${Q.kindLabel} (${label})`} className="flex flex-wrap gap-1.5">
            {KINDS.map((kind) => (
              <button
                key={kind}
                role="radio"
                aria-checked={q.kind === kind}
                onClick={() => onKind(kind)}
                className={cn(
                  "min-h-11 rounded-lg border px-3 text-xs font-semibold transition",
                  q.kind === kind
                    ? "border-lime bg-lime-faint text-ink"
                    : "border-line bg-card text-ink-soft hover:bg-hover",
                )}
              >
                {Q.kinds[kind]}
              </button>
            ))}
          </div>

          <TextArea
            ref={promptRef}
            value={q.prompt}
            label={`${Q.promptLabel} (${label})`}
            placeholder={Q.promptPlaceholder}
            onChange={(v) => onEdit((x) => void (x.prompt = v))}
          />

          {q.kind === "mcq" && <ChoicesEditor q={q} label={label} onEdit={onEdit} />}

          {q.kind === "true_false" && (
            <div role="radiogroup" aria-label={`${Q.correctAnswer} (${label})`} className="space-y-1">
              <p className="text-[11px] font-semibold text-ink-soft">{Q.correctAnswer}</p>
              <div className="grid grid-cols-2 gap-2">
                {[true, false].map((value) => (
                  <button
                    key={String(value)}
                    role="radio"
                    aria-checked={q.answerBool === value}
                    onClick={() => onEdit((x) => void (x.answerBool = value))}
                    className={cn(
                      "flex min-h-11 items-center justify-center gap-1.5 rounded-lg border text-sm font-semibold transition",
                      q.answerBool === value
                        ? "border-emerald-500 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                        : "border-line bg-card text-ink-soft hover:bg-hover",
                    )}
                  >
                    {q.answerBool === value && <Check className="size-4" aria-hidden />}
                    {value ? Q.trueLabel : Q.falseLabel}
                  </button>
                ))}
              </div>
            </div>
          )}

          {q.kind === "short" && (
            <TextArea
              value={q.answerText ?? ""}
              label={`${Q.modelAnswerLabel} (${label})`}
              placeholder={Q.modelAnswerPlaceholder}
              onChange={(v) => onEdit((x) => void (x.answerText = v))}
              visibleLabel={Q.modelAnswerLabel}
            />
          )}

          <TextArea
            value={q.explanation ?? ""}
            label={`${Q.explanationLabel} (${label})`}
            placeholder={Q.explanationPlaceholder}
            onChange={(v) =>
              onEdit((x) => {
                if (v) x.explanation = v;
                else delete x.explanation;
              })
            }
            visibleLabel={Q.explanationLabel}
            small
          />
          {q.source && <SourceChip source={q.source} />}
        </div>
      )}

      {issue && (
        <p className="mt-2 text-xs font-medium text-amber-700 dark:text-amber-400">{Q.issues[issue]}</p>
      )}
    </li>
  );
}

function ChoicesEditor({
  q,
  label,
  onEdit,
}: {
  q: QuizQuestion;
  label: string;
  onEdit: (fn: (q: QuizQuestion) => void) => void;
}) {
  const { dict, t } = useI18n();
  const Q = dict.quiz;
  const choices = q.choices ?? [];
  return (
    <div className="space-y-1.5">
      <p className="text-[11px] font-semibold text-ink-soft">{Q.choicesHint}</p>
      <ul className="space-y-1.5">
        {choices.map((choice, i) => {
          const n = i + 1;
          const isAnswer = q.answerIndex === i;
          return (
            <li key={i} className="flex items-start gap-1">
              <button
                role="radio"
                aria-checked={isAnswer}
                aria-label={`${t(Q.markCorrect, { n })} (${label})`}
                title={t(Q.markCorrect, { n })}
                onClick={() => onEdit((x) => void (x.answerIndex = i))}
                className={cn(
                  "grid h-11 w-11 shrink-0 place-items-center rounded-lg border transition",
                  isAnswer
                    ? "border-emerald-500 bg-emerald-500 text-white"
                    : "border-line bg-card text-ink-soft hover:bg-hover",
                )}
              >
                {isAnswer ? <Check className="size-4" aria-hidden /> : <span className="font-mono text-xs">{n}</span>}
              </button>
              <TextArea
                value={choice}
                label={`${t(Q.choiceLabel, { n })} (${label})`}
                placeholder={t(Q.choiceLabel, { n })}
                onChange={(v) =>
                  onEdit((x) => {
                    x.choices ??= [];
                    x.choices[i] = v;
                  })
                }
                small
              />
              <div className="flex shrink-0 flex-col sm:flex-row">
                <IconButton
                  label={`${Q.moveUp} (${t(Q.choiceLabel, { n })}, ${label})`}
                  onClick={() => onEdit((x) => moveChoice(x, i, -1))}
                  disabled={i === 0}
                >
                  <ArrowUp className="size-4" aria-hidden />
                </IconButton>
                <IconButton
                  label={`${t(Q.removeChoice, { n })} (${label})`}
                  onClick={() => onEdit((x) => removeChoice(x, i))}
                  disabled={choices.length <= 2}
                  danger
                >
                  <X className="size-4" aria-hidden />
                </IconButton>
              </div>
            </li>
          );
        })}
      </ul>
      {choices.length < MAX_QUIZ_CHOICES && (
        <button
          onClick={() =>
            onEdit((x) => {
              x.choices = [...(x.choices ?? []), ""];
            })
          }
          className="flex min-h-11 items-center gap-1.5 rounded-lg px-3 text-sm font-semibold text-ink-soft transition hover:bg-hover hover:text-ink"
        >
          <Plus className="size-4" aria-hidden />
          {Q.addChoice}
        </button>
      )}
    </div>
  );
}

function QuestionPreview({ q }: { q: QuizQuestion }) {
  const { dict } = useI18n();
  const Q = dict.quiz;
  const answer =
    q.kind === "mcq"
      ? q.answerIndex !== undefined
        ? q.choices?.[q.answerIndex]
        : undefined
      : q.kind === "true_false"
        ? q.answerBool === undefined
          ? undefined
          : q.answerBool
            ? Q.trueLabel
            : Q.falseLabel
        : q.answerText;
  return (
    <div className="space-y-2 rounded-lg border border-line bg-card px-3 py-2">
      {q.prompt.trim() ? (
        <CardContent text={q.prompt} className="text-sm font-semibold text-ink" />
      ) : (
        <p className="text-sm italic text-ink-soft/60">{Q.emptyField}</p>
      )}
      {q.kind === "mcq" && (
        <ol className="space-y-1">
          {(q.choices ?? []).map((c, i) => (
            <li key={i} className={cn("flex gap-2 text-sm", i === q.answerIndex ? "font-semibold text-emerald-700 dark:text-emerald-300" : "text-ink-soft")}>
              <span className="font-mono text-xs">{i + 1}.</span>
              {c.trim() ? <CardContent text={c} /> : <span className="italic opacity-60">{Q.emptyField}</span>}
            </li>
          ))}
        </ol>
      )}
      {q.kind !== "mcq" && (
        <div className="text-sm">
          <p className="text-[11px] font-semibold text-ink-soft">{Q.correctAnswer}</p>
          {answer?.trim() ? (
            <CardContent text={answer} className="text-emerald-700 dark:text-emerald-300" />
          ) : (
            <p className="italic text-ink-soft/60">{Q.emptyField}</p>
          )}
        </div>
      )}
      {q.explanation?.trim() && <CardContent text={q.explanation} className="text-xs text-ink-soft" />}
    </div>
  );
}

function TextArea({
  ref,
  value,
  label,
  placeholder,
  onChange,
  visibleLabel,
  small,
}: {
  ref?: React.Ref<HTMLTextAreaElement>;
  value: string;
  label: string;
  placeholder: string;
  onChange: (value: string) => void;
  visibleLabel?: string;
  small?: boolean;
}) {
  const lines = value.split("\n").length;
  const field = (
    <textarea
      ref={ref}
      dir="auto"
      value={value}
      aria-label={label}
      placeholder={placeholder}
      maxLength={MAX_QUIZ_TEXT}
      rows={Math.min(10, Math.max(small ? 1 : 2, lines))}
      onChange={(e) => onChange(e.target.value)}
      className={cn(
        "w-full min-w-0 resize-y rounded-lg border border-line bg-card px-3 py-2 text-base text-ink outline-none [field-sizing:content] placeholder:text-ink-soft/50 focus:border-ink/30 sm:text-sm",
        small ? "min-h-11" : "min-h-16",
      )}
    />
  );
  if (!visibleLabel) return field;
  return (
    <div className="space-y-1">
      <p aria-hidden className="text-[11px] font-semibold text-ink-soft">
        {visibleLabel}
      </p>
      {field}
    </div>
  );
}

function IconButton({
  label,
  onClick,
  disabled,
  danger,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className={`grid h-11 w-11 shrink-0 place-items-center rounded-lg text-ink-soft transition hover:bg-hover disabled:cursor-not-allowed disabled:opacity-30 ${
        danger ? "hover:text-rose-600" : "hover:text-ink"
      }`}
    >
      {children}
    </button>
  );
}
