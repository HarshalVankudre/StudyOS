"use client";

import { useId, useRef, useState } from "react";
import { Check, X } from "lucide-react";
import { useI18n } from "@/lib/i18n/client";
import type { PublicQuestion } from "@/lib/share/public-view";
import { cn } from "@/lib/utils";
import { ShareRichText } from "./ShareRichText";

type Answer =
  | { kind: "choice"; index: number; correct: boolean }
  | { kind: "short"; text: string; correct: boolean | null };

/** Whether a choice (mcq index, or 0 = true / 1 = false) is the right one. */
export function isRightChoice(q: PublicQuestion, index: number): boolean {
  if (q.kind === "mcq") return index === q.answerIndex;
  if (q.kind === "true_false") return (index === 0) === q.answer;
  return false;
}

/**
 * A quiz on a shared page, for practice only: one question at a time, see at
 * once whether the answer was right (a written answer is compared with the
 * model answer and marked by the visitor), then a score at the end. Nothing
 * is recorded: no stats, no attempts, nothing sent anywhere. Rich content
 * (a choice's Markdown) is never inside a button.
 */
export function PublicQuiz({ title, questions, token }: { title?: string; questions: PublicQuestion[]; token: string }) {
  const { dict, t, plural } = useI18n();
  const S = dict.share;
  const Q = dict.quiz;
  const [at, setAt] = useState(0);
  const [answers, setAnswers] = useState<(Answer | undefined)[]>(() => questions.map(() => undefined));
  const [done, setDone] = useState(false);
  const draft = useRef<HTMLTextAreaElement>(null);
  const choiceIds = useId();
  const name = title || Q.untitled;

  const restart = () => {
    setAnswers(questions.map(() => undefined));
    setAt(0);
    setDone(false);
  };
  const answer = (value: Answer) => setAnswers((prev) => prev.map((a, i) => (i === at ? value : a)));

  if (done) {
    const score = answers.filter((a) => a?.correct === true).length;
    return (
      <QuizFrame name={name} count={plural(dict.counts.questions, questions.length)} note={S.practiceNote}>
        <div className="flex flex-col items-center gap-3 py-6 text-center" role="status">
          <p className="font-display text-3xl font-bold text-ink">
            {t(S.score, { score, total: questions.length })}
          </p>
          <button
            type="button"
            onClick={restart}
            className="min-h-11 rounded-full border border-line-strong bg-card px-5 text-sm font-semibold text-ink transition hover:bg-hover"
          >
            {S.startOver}
          </button>
        </div>
      </QuizFrame>
    );
  }

  const q = questions[at];
  const current = answers[at];
  const last = at === questions.length - 1;
  const answered = current !== undefined && current.correct !== null;
  const choices =
    q.kind === "mcq" ? q.choices : q.kind === "true_false" ? [Q.trueLabel, Q.falseLabel] : [];

  return (
    <QuizFrame name={name} count={plural(dict.counts.questions, questions.length)} note={S.practiceNote}>
      {/* Keyed by question, so a typed answer never carries over to the next one. */}
      <div key={at}>
      <p className="text-xs font-semibold text-ink-soft">
        {t(S.questionOf, { n: at + 1, total: questions.length })}
        {q.topic ? <span dir="auto"> · {q.topic}</span> : null}
      </p>
      <div className="mt-2 break-words font-display text-lg font-semibold leading-snug text-ink sm:text-xl">
        <ShareRichText text={q.prompt} token={token} />
      </div>

      {q.kind !== "short" ? (
        <div role="group" aria-label={Q.choicesGroup} className={cn("mt-4 grid gap-2", q.kind === "true_false" && "grid-cols-2")}>
          {choices.map((choice, index) => {
            const chosen = current?.kind === "choice" && current.index === index;
            const right = isRightChoice(q, index);
            const state = !current ? "idle" : right ? "right" : chosen ? "wrong" : "dim";
            const pick = () => answer({ kind: "choice", index, correct: right });
            const frame = cn(
              "flex min-h-12 w-full items-center gap-3 rounded-2xl border px-3 py-2.5 text-start text-base transition sm:text-sm",
              state === "idle" && "border-line-strong bg-card text-ink",
              state === "right" && "border-emerald-500 bg-emerald-500/10 text-ink",
              state === "wrong" && "border-rose-500 bg-rose-500/10 text-ink",
              state === "dim" && "border-line bg-card text-ink-soft opacity-70",
            );
            const badge = cn(
              "grid size-7 shrink-0 place-items-center rounded-full font-mono text-xs font-semibold",
              state === "right" ? "bg-emerald-500 text-white" : state === "wrong" ? "bg-rose-500 text-white" : "bg-hover text-ink-soft",
            );
            const mark = state === "right" ? <Check className="size-4" /> : state === "wrong" ? <X className="size-4" /> : index + 1;
            if (q.kind === "true_false") {
              // Plain labels, no Markdown: the whole row is the button.
              return (
                <button
                  key={index}
                  type="button"
                  disabled={current !== undefined}
                  aria-pressed={chosen}
                  data-state={state}
                  onClick={pick}
                  className={cn(frame, "disabled:cursor-default", state === "idle" && "hover:bg-hover")}
                >
                  <span aria-hidden className={badge}>
                    {mark}
                  </span>
                  <span className="font-semibold">{choice}</span>
                </button>
              );
            }
            // A choice's Markdown may hold links, so it sits beside its
            // button (which takes the choice's text as its name), never
            // inside it. A click on the text picks it too, unless it hit a link.
            const textId = `${choiceIds}-${index}`;
            return (
              <div
                key={index}
                data-state={state}
                onClick={(event) => {
                  if (current !== undefined) return;
                  if ((event.target as HTMLElement).closest("a, button, [role='button']")) return;
                  pick();
                }}
                className={cn(frame, current === undefined && "cursor-pointer hover:bg-hover")}
              >
                <button
                  type="button"
                  disabled={current !== undefined}
                  aria-pressed={chosen}
                  aria-labelledby={textId}
                  onClick={pick}
                  className="-m-2 grid min-h-11 min-w-11 shrink-0 place-items-center rounded-full disabled:cursor-default focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/30"
                >
                  <span aria-hidden className={badge}>
                    {mark}
                  </span>
                </button>
                <div id={textId} className="min-w-0 flex-1 break-words">
                  <ShareRichText text={choice} token={token} />
                </div>
              </div>
            );
          })}
        </div>
      ) : current?.kind !== "short" ? (
        <div className="mt-4 space-y-2">
          <textarea
            ref={draft}
            dir="auto"
            rows={3}
            aria-label={Q.typeAnswer}
            placeholder={Q.typeAnswerPlaceholder}
            className="min-h-24 w-full resize-y rounded-2xl border border-line-strong bg-paper px-4 py-3 text-base text-ink outline-none placeholder:text-ink-faint focus-visible:border-ink sm:text-sm"
          />
          <button
            type="button"
            onClick={() => answer({ kind: "short", text: draft.current?.value ?? "", correct: null })}
            className="min-h-11 rounded-full bg-ink px-5 text-sm font-semibold text-paper transition hover:bg-ink/90"
          >
            {Q.showModelAnswer}
          </button>
        </div>
      ) : (
        <div className="mt-4 space-y-3">
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="rounded-2xl border border-line bg-card px-3 py-2">
              <p className="text-[11px] font-semibold text-ink-soft">{Q.yourAnswer}</p>
              {current.text.trim() ? (
                <p dir="auto" className="whitespace-pre-wrap break-words text-sm text-ink">
                  {current.text}
                </p>
              ) : (
                <p className="text-sm italic text-ink-soft">{Q.noAnswer}</p>
              )}
            </div>
            <div className="rounded-2xl border border-emerald-500/40 bg-emerald-500/5 px-3 py-2">
              <p className="text-[11px] font-semibold text-emerald-700 dark:text-emerald-300">{Q.correctAnswer}</p>
              <div className="break-words text-sm text-ink">
                <ShareRichText text={q.answer} token={token} />
              </div>
            </div>
          </div>
          {current.correct === null && (
            <div className="space-y-2">
              <p className="text-sm font-medium text-ink">{Q.selfMarkPrompt}</p>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => answer({ ...current, correct: true })}
                  className="flex min-h-12 items-center justify-center gap-1.5 rounded-2xl border border-emerald-500/40 bg-card px-3 text-sm font-semibold text-emerald-700 transition hover:bg-emerald-500/10 dark:text-emerald-300"
                >
                  <Check className="size-4" aria-hidden />
                  {Q.markRight}
                </button>
                <button
                  type="button"
                  onClick={() => answer({ ...current, correct: false })}
                  className="flex min-h-12 items-center justify-center gap-1.5 rounded-2xl border border-rose-500/40 bg-card px-3 text-sm font-semibold text-rose-700 transition hover:bg-rose-500/10 dark:text-rose-300"
                >
                  <X className="size-4" aria-hidden />
                  {Q.markWrong}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {answered && (
        <div className="mt-4 space-y-3" aria-live="polite">
          <p
            className={cn(
              "flex items-center gap-2 text-base font-bold",
              current.correct ? "text-emerald-700 dark:text-emerald-300" : "text-rose-700 dark:text-rose-300",
            )}
          >
            {current.correct ? <Check className="size-5" aria-hidden /> : <X className="size-5" aria-hidden />}
            {current.correct ? Q.correct : Q.incorrect}
          </p>
          {q.explanation && (
            <div className="rounded-2xl bg-oat px-4 py-3">
              <p className="text-[11px] font-semibold text-ink-soft">{Q.explanation}</p>
              <div className="break-words text-sm text-ink">
                <ShareRichText text={q.explanation} token={token} />
              </div>
            </div>
          )}
          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => (last ? setDone(true) : setAt(at + 1))}
              className="min-h-11 rounded-full bg-ink px-5 text-sm font-semibold text-paper transition hover:bg-ink/90"
            >
              {last ? Q.seeResults : Q.next}
            </button>
          </div>
        </div>
      )}
      </div>
    </QuizFrame>
  );
}

function QuizFrame({
  name,
  count,
  note,
  children,
}: {
  name: string;
  count: string;
  note: string;
  children: React.ReactNode;
}) {
  return (
    <section className="my-5 rounded-3xl border border-line bg-heather/50 p-4 sm:p-6" aria-label={name}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h3 dir="auto" className="font-display text-lg font-bold text-ink">
          {name}
        </h3>
        <p className="text-xs text-ink-soft">{count}</p>
      </div>
      <div className="mt-4 rounded-2xl border border-line bg-card p-4 sm:p-5">{children}</div>
      <p className="mt-3 text-xs text-ink-faint">{note}</p>
    </section>
  );
}
