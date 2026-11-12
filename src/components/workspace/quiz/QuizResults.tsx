"use client";

import { Check, CircleHelp, PartyPopper, RotateCcw, Target, X } from "lucide-react";
import { useI18n } from "@/lib/i18n/client";
import {
  isCorrect,
  percent,
  type PreparedQuestion,
  type QuizAnswer,
  type QuizScore,
} from "@/lib/study/quiz";
import { cn } from "@/lib/utils";
import {
  AnswerPair,
  Explanation,
  QuestionPrompt,
  SelfMarkButtons,
  correctAnswerText,
  givenAnswerText,
} from "./QuizQuestionViews";

/**
 * After a quiz: the score, what was missed and one tap to re-drill only the
 * missed questions. Practice lists the missed questions; an exam reviews every
 * answer, and written answers are self-marked here against the model answer.
 */
export function QuizResults({
  questions,
  answers,
  score,
  mode,
  timedOut,
  mixed,
  onMark,
  onRedrill,
  onRetake,
  onDone,
}: {
  questions: PreparedQuestion[];
  answers: ReadonlyMap<string, QuizAnswer>;
  score: QuizScore;
  mode: "practice" | "exam";
  timedOut: boolean;
  mixed: boolean;
  onMark: (key: string, correct: boolean) => void;
  onRedrill: () => void;
  onRetake: () => void;
  onDone: () => void;
}) {
  const { dict, t } = useI18n();
  const Q = dict.quiz;
  const labels = { trueLabel: Q.trueLabel, falseLabel: Q.falseLabel };
  const redrillCount = score.missed.length + score.unmarked.length;
  const pct = percent(score.score, score.total);
  const missed = new Set(score.missed);
  const reviewed =
    mode === "exam" ? questions : questions.filter((q) => missed.has(q.key) || score.unmarked.includes(q.key));
  const numberOf = new Map(questions.map((q, i) => [q.key, i + 1]));

  return (
    <div className="flex min-h-0 flex-1 flex-col items-center overflow-y-auto px-4 py-8 sm:px-6">
      <div className="flex w-full max-w-2xl flex-col items-center gap-4 text-center">
        {redrillCount === 0 ? (
          <PartyPopper className="size-12 text-lime-deep" aria-hidden />
        ) : (
          <Target className="size-12 text-lime-deep" aria-hidden />
        )}
        <h2 className="font-display text-xl font-bold text-ink">{Q.resultsTitle}</h2>
        <p className="font-display text-5xl font-bold tracking-tight text-ink" data-testid="quiz-score">
          <span dir="ltr">{pct}%</span>
        </p>
        <p className="text-sm font-medium text-ink-soft" role="status">
          {t(Q.scoreLine, { score: score.score, total: score.total })}
        </p>
        {timedOut && <p className="text-sm text-amber-700 dark:text-amber-300">{Q.timeUp}</p>}
        {score.unmarked.length > 0 && (
          <p className="rounded-lg bg-amber-400/10 px-3 py-2 text-sm text-ink">
            {t(Q.markPending, { count: score.unmarked.length })}
          </p>
        )}
        {redrillCount === 0 && score.unmarked.length === 0 && (
          <p className="text-sm text-ink-soft">{Q.allCorrect}</p>
        )}

        <div className="flex w-full flex-col gap-2 sm:flex-row sm:justify-center">
          {redrillCount > 0 && (
            <button
              onClick={onRedrill}
              className="flex min-h-12 items-center justify-center gap-2 rounded-lg bg-lime px-5 text-sm font-semibold text-lime-on transition hover:bg-lime-deep"
            >
              <Target className="size-4" aria-hidden />
              {t(Q.redrill, { count: redrillCount })}
            </button>
          )}
          <button
            onClick={onRetake}
            className="flex min-h-12 items-center justify-center gap-2 rounded-lg border border-line-strong bg-card px-5 text-sm font-semibold text-ink transition hover:bg-hover"
          >
            <RotateCcw className="size-4" aria-hidden />
            {Q.retake}
          </button>
          <button
            onClick={onDone}
            className="min-h-12 rounded-lg border border-line-strong bg-card px-5 text-sm font-semibold text-ink transition hover:bg-hover"
          >
            {Q.done}
          </button>
        </div>
      </div>

      {reviewed.length > 0 && (
        <section className="mt-8 w-full max-w-2xl space-y-3" aria-label={mode === "exam" ? Q.reviewTitle : Q.missedTitle}>
          <h3 className="font-display text-base font-bold text-ink">
            {mode === "exam" ? Q.reviewTitle : Q.missedTitle}
          </h3>
          <ol className="space-y-3">
            {reviewed.map((q) => {
              const answer = answers.get(q.key);
              const verdict = isCorrect(q.question, answer);
              const unmarked = score.unmarked.includes(q.key);
              const n = numberOf.get(q.key) ?? 0;
              const label = t(Q.questionNumber, { n });
              return (
                <li
                  key={q.key}
                  aria-label={label}
                  data-testid="review-item"
                  className="space-y-3 rounded-xl border border-line bg-card p-4"
                >
                  <div className="flex items-center gap-2">
                    <StatusIcon verdict={verdict} unmarked={unmarked} />
                    <span className="font-mono text-[11px] font-semibold text-ink-soft">{label}</span>
                  </div>
                  <QuestionPrompt q={q} showQuiz={mixed} />
                  <AnswerPair
                    given={givenAnswerText(q, answer, labels)}
                    correct={correctAnswerText(q, labels)}
                    status={verdict}
                  />
                  {q.question.kind === "short" && answer?.kind === "short" && answer.text.trim() !== "" && (
                    <div className={cn("space-y-2", unmarked && "rounded-lg bg-amber-400/10 p-2")}>
                      {unmarked && <p className="text-sm font-medium text-ink">{Q.selfMarkPrompt}</p>}
                      <SelfMarkButtons
                        value={answer.correct}
                        onMark={(correct) => onMark(q.key, correct)}
                        label={`${Q.selfMarkPrompt} (${label})`}
                      />
                    </div>
                  )}
                  <Explanation q={q} />
                </li>
              );
            })}
          </ol>
        </section>
      )}
    </div>
  );
}

function StatusIcon({ verdict, unmarked }: { verdict: boolean | null; unmarked: boolean }) {
  const { dict } = useI18n();
  const Q = dict.quiz;
  if (verdict === true)
    return (
      <span className="flex items-center gap-1 text-xs font-semibold text-emerald-700 dark:text-emerald-300">
        <Check className="size-4" aria-hidden />
        {Q.correct}
      </span>
    );
  if (verdict === false)
    return (
      <span className="flex items-center gap-1 text-xs font-semibold text-rose-700 dark:text-rose-300">
        <X className="size-4" aria-hidden />
        {Q.incorrect}
      </span>
    );
  return (
    <span className="flex items-center gap-1 text-xs font-semibold text-amber-700 dark:text-amber-300">
      <CircleHelp className="size-4" aria-hidden />
      {unmarked ? Q.toMark : Q.unanswered}
    </span>
  );
}
