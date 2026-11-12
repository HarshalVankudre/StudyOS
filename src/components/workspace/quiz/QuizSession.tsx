"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CircleCheck, ClipboardCheck, Dumbbell, Timer, X } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { useI18n } from "@/lib/i18n/client";
import {
  applyRunResults,
  isCorrect,
  prepareRun,
  scoreRun,
  type PreparedQuestion,
  type QuestionResult,
  type QuizAnswer,
  type QuizItem,
  type Rng,
} from "@/lib/study/quiz";
import { cn } from "@/lib/utils";
import { useWorkspace } from "../WorkspaceContext";
import { useReviewRecorder } from "../study/useReviewRecorder";
import { ExamQuestion, Explanation, PracticeAnswer, QuestionPrompt, Verdict } from "./QuizQuestionViews";
import { QuizResults } from "./QuizResults";

export type QuizMode = "practice" | "exam";

let runCounter = 0;
/** A unique id per run (each answer of a run is saved exactly once). */
const nextRunId = () => (runCounter += 1);

/** Timer choices offered before an exam (minutes; null = no timer). */
export const EXAM_TIMERS: (number | null)[] = [null, 10, 20, 30, 45, 60];

interface Run {
  id: number;
  mode: QuizMode;
  questions: PreparedQuestion[];
  /** Record an attempt in this quiz (a full run of one quiz, not a re-drill). */
  attemptFor?: { pageId: string; blockId: string };
  /** Mixed questions (weak-question practice): show which quiz each is from. */
  mixed: boolean;
}

type Phase = "setup" | "running" | "results";

/**
 * Full-screen quiz session.
 *
 * Practice: one question at a time with immediate feedback (right or wrong,
 * the explanation and the source). Exam: an optional timer, every question at
 * once and no feedback until submission, then the score and a review of every
 * answer. Short answers are self-marked against the model answer.
 *
 * Results (per-question stats, and an attempt for full runs of one quiz) are
 * saved in the quiz block through the normal workspace update path, re-run on
 * the newer document if the workspace changed elsewhere meanwhile: when a
 * practice run ends (or for what was answered when it is left early), when an
 * exam is submitted, and again as each written answer is self-marked. Every
 * answer counts as studying for the streak. Afterwards, one tap re-drills
 * only the missed questions.
 */
export function QuizSession({
  items,
  title,
  mode,
  attemptFor,
  mixed = false,
  onClose,
  rng,
}: {
  items: QuizItem[];
  title: string;
  mode: QuizMode;
  attemptFor?: { pageId: string; blockId: string };
  mixed?: boolean;
  onClose: () => void;
  /** Deterministic shuffling for tests. */
  rng?: Rng;
}) {
  const { dict, t } = useI18n();
  const Q = dict.quiz;
  const { update, workspace } = useWorkspace();
  const record = useReviewRecorder(workspace.id);

  const makeRun = useCallback(
    (source: QuizItem[], runMode: QuizMode, forQuiz?: { pageId: string; blockId: string }): Run => ({
      id: nextRunId(),
      mode: runMode,
      // A weak-questions round keeps its weakest-first order (so stopping
      // early still covered the hardest ones); everything else is shuffled.
      // Choices are always shuffled.
      questions: prepareRun(source, { rng, shuffleQuestions: !mixed }),
      attemptFor: forQuiz,
      mixed,
    }),
    [rng, mixed],
  );

  const [run, setRun] = useState<Run>(() => makeRun(items, mode, attemptFor));
  const [phase, setPhase] = useState<Phase>(mode === "exam" ? "setup" : "running");
  const [answers, setAnswers] = useState<ReadonlyMap<string, QuizAnswer>>(() => new Map());
  // Practice
  const [index, setIndex] = useState(0);
  const [shortChecked, setShortChecked] = useState(false);
  // Exam
  const [timer, setTimer] = useState<number | null>(null);
  const [deadline, setDeadline] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [confirmSubmit, setConfirmSubmit] = useState(false);
  const [timedOut, setTimedOut] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);

  /** Each run's moment, fixed at its first save: the key its results are saved under. */
  const runAt = useRef(new Map<number, string>());
  /** `${runId}:${key}` of answers already saved into the question stats. */
  const saved = useRef(new Set<string>());
  /** Each run's attempt score as last saved (an exam's grows as answers are marked). */
  const savedAttempt = useRef(new Map<number, number>());
  /** Keys whose answers were already counted for the streak (practice). */
  const recorded = useRef(new Set<string>());

  /**
   * Save what is new in a run: answers not yet in the stats and, for a
   * completed full run of one quiz, its attempt (an exam is saved at
   * submission and updated as written answers are self-marked). Re-run on
   * the newer document when another tab or the agent changed the workspace
   * meanwhile, so nothing is lost or counted twice (see applyRunResults).
   */
  const save = useCallback(
    (r: Run, answerMap: ReadonlyMap<string, QuizAnswer>, complete: boolean) => {
      let at = runAt.current.get(r.id);
      if (!at) {
        at = new Date().toISOString();
        runAt.current.set(r.id, at);
      }
      const results: QuestionResult[] = [];
      for (const q of r.questions) {
        const answer = answerMap.get(q.key);
        let correct = isCorrect(q.question, answer);
        // A submitted exam's blank answer counts as missed; an unmarked
        // written answer is left out of the stats (until it is marked).
        if (correct === null && complete && r.mode === "exam" && !answer) correct = false;
        if (correct === null) continue;
        const savedKey = `${r.id}:${q.key}`;
        if (!saved.current.has(savedKey)) {
          saved.current.add(savedKey);
          results.push({ pageId: q.pageId, blockId: q.blockId, questionId: q.questionId, correct });
        }
        if (!recorded.current.has(savedKey)) {
          recorded.current.add(savedKey);
          record({ quiz: true, correct });
        }
      }
      const score = scoreRun(r.questions, answerMap);
      const attempt =
        complete && r.attemptFor && savedAttempt.current.get(r.id) !== score.score
          ? {
              ...r.attemptFor,
              attempt: { at, mode: r.mode, score: score.score, total: score.total },
            }
          : undefined;
      if (results.length === 0 && !attempt) return;
      if (attempt) savedAttempt.current.set(r.id, score.score);
      const runMoment = at;
      update((d) => applyRunResults(d, results, attempt, runMoment), { rebase: "rerun" });
    },
    [record, update],
  );

  const startRun = (next: Run) => {
    setRun(next);
    setAnswers(new Map());
    setIndex(0);
    setShortChecked(false);
    setConfirmSubmit(false);
    setTimedOut(false);
    setDeadline(null);
    setPhase(next.mode === "exam" ? "setup" : "running");
  };

  const close = () => {
    if (phase === "running" && run.mode === "practice") save(run, answers, false);
    if (phase === "results") save(run, answers, true);
    onClose();
  };

  const requestClose = () => {
    if (phase === "running" && run.mode === "exam" && !confirmLeave) {
      setConfirmLeave(true);
      return;
    }
    close();
  };

  // ---- Practice ---------------------------------------------------------
  const current = run.questions[index];
  const currentAnswer = current ? answers.get(current.key) : undefined;
  const currentVerdict = current ? isCorrect(current.question, currentAnswer) : null;
  const answered = currentVerdict !== null;

  const answerPractice = useCallback(
    (a: QuizAnswer) => {
      // An answer locks once it has a verdict.
      if (!current || isCorrect(current.question, answers.get(current.key)) !== null) return;
      const correct = isCorrect(current.question, a);
      setAnswers((prev) => new Map(prev).set(current.key, a));
      if (correct !== null && !recorded.current.has(`${run.id}:${current.key}`)) {
        recorded.current.add(`${run.id}:${current.key}`);
        record({ quiz: true, correct });
      }
    },
    [current, answers, record, run.id],
  );

  const checkShort = (text: string) => {
    if (!current) return;
    setAnswers((prev) => new Map(prev).set(current.key, { kind: "short", text }));
    setShortChecked(true);
  };

  const nextQuestion = useCallback(() => {
    if (index + 1 >= run.questions.length) {
      save(run, answers, true);
      setPhase("results");
    } else {
      setIndex(index + 1);
      setShortChecked(false);
    }
  }, [index, run, answers, save]);

  const questionRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (phase === "running" && run.mode === "practice") questionRef.current?.focus();
  }, [index, phase, run]);

  // Keyboard: number keys answer, Enter moves on. Typing is never hijacked.
  useEffect(() => {
    if (phase !== "running" || run.mode !== "practice" || !current) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
      const target = e.target as HTMLElement | null;
      if (target?.closest?.("input, textarea, select, [contenteditable='true']")) return;
      const q = current.question;
      if (answered) {
        if (e.key === "Enter" && !target?.closest?.("button, a")) {
          e.preventDefault();
          nextQuestion();
        }
        return;
      }
      const n = Number(e.key);
      if (!Number.isInteger(n) || n < 1) return;
      if (q.kind === "mcq") {
        const choice = current.choices?.[n - 1];
        if (!choice) return;
        e.preventDefault();
        answerPractice({ kind: "mcq", choice: choice.index });
      } else if (q.kind === "true_false" && n <= 2) {
        e.preventDefault();
        answerPractice({ kind: "true_false", value: n === 1 });
      } else if (q.kind === "short" && shortChecked && n <= 2) {
        e.preventDefault();
        const text = currentAnswer?.kind === "short" ? currentAnswer.text : "";
        answerPractice({ kind: "short", text, correct: n === 1 });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [phase, run.mode, current, answered, shortChecked, currentAnswer, answerPractice, nextQuestion]);

  // ---- Exam -------------------------------------------------------------
  const submitExam = useCallback(
    (timeUp = false) => {
      setConfirmSubmit(false);
      setConfirmLeave(false);
      setTimedOut(timeUp);
      setDeadline(null);
      setPhase("results");
      // Saved now, so closing the tab on the results screen loses nothing;
      // written answers update it as they are self-marked.
      save(run, answers, true);
    },
    [run, answers, save],
  );

  const startExam = () => {
    setPhase("running");
    setDeadline(timer ? Date.now() + timer * 60_000 : null);
    setNow(Date.now());
  };

  // The clock ticks once a second; at zero the exam submits itself.
  const submitRef = useRef(submitExam);
  useEffect(() => {
    submitRef.current = submitExam;
  });
  useEffect(() => {
    if (deadline === null || phase !== "running") return;
    const id = setInterval(() => {
      const t = Date.now();
      if (t >= deadline) submitRef.current(true);
      else setNow(t);
    }, 1_000);
    return () => clearInterval(id);
  }, [deadline, phase]);

  const remainingMs = deadline === null ? null : Math.max(0, deadline - now);

  const answeredCount = useMemo(
    () =>
      run.questions.filter((q) => {
        const a = answers.get(q.key);
        return a && (a.kind !== "short" || a.text.trim() !== "");
      }).length,
    [run.questions, answers],
  );

  const setExamAnswer = (key: string, a: QuizAnswer | undefined) =>
    setAnswers((prev) => {
      const next = new Map(prev);
      if (a) next.set(key, a);
      else next.delete(key);
      return next;
    });

  const trySubmit = () => {
    if (answeredCount < run.questions.length && !confirmSubmit) {
      setConfirmSubmit(true);
      return;
    }
    submitExam(false);
  };

  // ---- Results ----------------------------------------------------------
  const score = useMemo(() => scoreRun(run.questions, answers), [run.questions, answers]);

  const markShort = (key: string, correct: boolean) => {
    const a = answers.get(key);
    if (a?.kind !== "short") return;
    const next = new Map(answers).set(key, { ...a, correct });
    setAnswers(next);
    // Each mark is saved at once (the answer's stats and the attempt's score).
    save(run, next, true);
  };

  const redrill = () => {
    save(run, answers, true);
    const missed = new Set([...score.missed, ...score.unmarked]);
    startRun(makeRun(run.questions.filter((q) => missed.has(q.key)), "practice"));
  };

  const retake = () => {
    save(run, answers, true);
    startRun(makeRun(run.questions, run.mode, run.attemptFor));
  };

  // ---- Render -----------------------------------------------------------
  const total = run.questions.length;
  const practice = run.mode === "practice";
  const progress =
    phase === "results" ? 100 : practice ? Math.round((index / Math.max(1, total)) * 100) : Math.round((answeredCount / Math.max(1, total)) * 100);

  return (
    <Dialog open onOpenChange={(open) => !open && requestClose()}>
      <DialogContent
        showCloseButton={false}
        onPointerDownOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => {
          if (phase === "running" && !practice) {
            e.preventDefault();
            setConfirmLeave(true);
          }
        }}
        className="inset-0 top-0 left-0 flex h-[100dvh] w-screen max-w-none translate-x-0 translate-y-0 flex-col gap-0 rounded-none border-0 bg-paper/95 p-0 backdrop-blur-sm sm:max-w-none"
      >
        <DialogDescription className="sr-only">{practice ? Q.practiceBanner : Q.examBanner}</DialogDescription>
        {/* Top bar */}
        <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-2 sm:px-5">
          <DialogTitle dir="auto" className="min-w-0 truncate font-display text-sm font-bold text-ink">{title}</DialogTitle>
          <div className="flex shrink-0 items-center gap-3">
            {phase === "running" && remainingMs !== null && (
              <span
                role="timer"
                aria-label={Q.timeLeft}
                className={cn(
                  "flex items-center gap-1 font-mono text-xs font-semibold",
                  remainingMs < 60_000 ? "text-rose-600 dark:text-rose-400" : "text-ink-soft",
                )}
                dir="ltr"
              >
                <Timer className="size-4" aria-hidden />
                {formatClock(remainingMs)}
              </span>
            )}
            {phase === "running" && practice && (
              <span className="font-mono text-xs text-ink-soft" dir="ltr">
                {Math.min(index + 1, total)} / {total}
              </span>
            )}
            {phase === "running" && !practice && (
              <span
                className="flex items-center gap-1 font-mono text-xs text-ink-soft"
                aria-label={t(Q.answeredCount, { answered: answeredCount, total })}
                title={t(Q.answeredCount, { answered: answeredCount, total })}
              >
                <CircleCheck className="size-4" aria-hidden />
                <span dir="ltr" aria-hidden>
                  {answeredCount} / {total}
                </span>
              </span>
            )}
            <button
              onClick={requestClose}
              className="grid h-11 w-11 place-items-center rounded-md text-ink-soft transition hover:bg-hover hover:text-ink"
              aria-label={Q.close}
            >
              <X className="size-5" aria-hidden />
            </button>
          </div>
        </div>
        <div
          role="progressbar"
          aria-label={title}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={progress}
          className="h-1 w-full bg-line"
        >
          <div className="h-full bg-lime transition-all" style={{ width: `${progress}%` }} />
        </div>
        {confirmLeave && (
          <div
            role="alertdialog"
            aria-label={Q.leaveExamQ}
            className="flex flex-wrap items-center justify-center gap-2 border-b border-line bg-amber-400/10 px-4 py-2"
          >
            <span className="text-sm font-medium text-ink">{Q.leaveExamQ}</span>
            <button
              onClick={() => setConfirmLeave(false)}
              className="min-h-11 rounded-lg px-3 text-sm font-semibold text-ink-soft transition hover:bg-hover"
            >
              {Q.stay}
            </button>
            <button
              onClick={close}
              className="min-h-11 rounded-lg bg-rose-600 px-3 text-sm font-semibold text-white transition hover:bg-rose-700"
            >
              {Q.leave}
            </button>
          </div>
        )}

        {total === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
            <p className="max-w-sm text-sm text-ink-soft">{Q.noPlayable}</p>
            <button
              onClick={onClose}
              className="min-h-12 rounded-lg bg-lime px-6 text-sm font-semibold text-lime-on transition hover:bg-lime-deep"
            >
              {Q.done}
            </button>
          </div>
        ) : phase === "setup" ? (
          <ExamSetup count={total} timer={timer} onTimer={setTimer} onStart={startExam} />
        ) : phase === "results" ? (
          <QuizResults
            questions={run.questions}
            answers={answers}
            score={score}
            mode={run.mode}
            timedOut={timedOut}
            mixed={run.mixed}
            onMark={markShort}
            onRedrill={redrill}
            onRetake={retake}
            onDone={close}
          />
        ) : practice ? (
          <div className="flex min-h-0 flex-1 flex-col items-center overflow-y-auto px-4 py-6 sm:px-6">
            <p className="mb-4 flex items-center gap-2 rounded-full bg-sky-500/10 px-3 py-1 text-xs font-medium text-sky-700 dark:text-sky-300">
              <Dumbbell className="size-4 shrink-0" aria-hidden />
              {Q.practiceBanner}
            </p>
            <div className="flex w-full max-w-2xl flex-col gap-4">
              <div
                ref={questionRef}
                tabIndex={-1}
                aria-label={t(Q.questionOf, { n: index + 1, total })}
                data-testid="practice-question"
                className="space-y-4 rounded-2xl border border-line-strong bg-card p-4 shadow-pop outline-none sm:p-6"
              >
                <QuestionPrompt q={current} showQuiz={run.mixed} />
                <PracticeAnswer
                  key={current.key}
                  q={current}
                  answer={currentAnswer}
                  shortChecked={shortChecked}
                  onAnswer={answerPractice}
                  onCheckShort={checkShort}
                />
              </div>
              {answered && (
                <div aria-live="polite" className="space-y-3">
                  <Verdict correct={currentVerdict} />
                  <Explanation q={current} />
                  <button
                    onClick={nextQuestion}
                    autoFocus
                    className="min-h-12 w-full rounded-lg bg-ink px-6 py-3 text-sm font-semibold text-paper transition hover:bg-ink/90 sm:w-auto"
                  >
                    {index + 1 >= total ? Q.seeResults : Q.next}
                    <span aria-hidden className="ms-2 hidden font-mono text-[11px] opacity-60 sm:inline">
                      Enter
                    </span>
                  </button>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col items-center overflow-y-auto px-4 py-6 sm:px-6">
            <div className="flex w-full max-w-2xl flex-col gap-4">
              <p className="flex items-center gap-2 text-xs text-ink-soft">
                <ClipboardCheck className="size-4 shrink-0" aria-hidden />
                {Q.examBanner}
              </p>
              {run.questions.map((q, i) => (
                <ExamQuestion
                  key={q.key}
                  q={q}
                  number={i + 1}
                  total={total}
                  answer={answers.get(q.key)}
                  onAnswer={(a) => setExamAnswer(q.key, a)}
                />
              ))}
              {confirmSubmit && (
                <div role="alert" className="rounded-lg border border-amber-500/40 bg-amber-400/10 p-3 text-sm text-ink">
                  {t(Q.unansweredWarning, { count: total - answeredCount })}
                </div>
              )}
              <div className="flex flex-col gap-2 pb-6 sm:flex-row">
                {confirmSubmit && (
                  <button
                    onClick={() => setConfirmSubmit(false)}
                    className="min-h-12 flex-1 rounded-lg border border-line-strong bg-card px-6 text-sm font-semibold text-ink transition hover:bg-hover"
                  >
                    {Q.keepWorking}
                  </button>
                )}
                <button
                  onClick={trySubmit}
                  className="min-h-12 flex-1 rounded-lg bg-lime px-6 text-sm font-semibold text-lime-on transition hover:bg-lime-deep"
                >
                  {confirmSubmit ? Q.submitAnyway : Q.submit}
                </button>
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function ExamSetup({
  count,
  timer,
  onTimer,
  onStart,
}: {
  count: number;
  timer: number | null;
  onTimer: (minutes: number | null) => void;
  onStart: () => void;
}) {
  const { dict, t } = useI18n();
  const Q = dict.quiz;
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-5 overflow-y-auto px-6 py-8 text-center">
      <ClipboardCheck className="size-12 text-lime-deep" aria-hidden />
      <h2 className="font-display text-2xl font-bold tracking-tight text-ink">{Q.examSetupTitle}</h2>
      <p className="max-w-md text-sm text-ink-soft">{t(Q.examSetupBody, { count })}</p>
      <div role="radiogroup" aria-label={Q.timerLabel} className="w-full max-w-md space-y-2">
        <p className="text-xs font-semibold text-ink-soft">{Q.timerLabel}</p>
        <div className="grid grid-cols-3 gap-2">
          {EXAM_TIMERS.map((m) => (
            <button
              key={m ?? "off"}
              role="radio"
              aria-checked={timer === m}
              onClick={() => onTimer(m)}
              className={cn(
                "min-h-11 rounded-lg border px-2 text-sm font-semibold transition",
                timer === m ? "border-lime bg-lime-faint text-ink" : "border-line bg-card text-ink-soft hover:bg-hover",
              )}
            >
              {m === null ? Q.timerOff : t(Q.timerMinutes, { n: m })}
            </button>
          ))}
        </div>
      </div>
      <button
        onClick={onStart}
        className="min-h-12 rounded-lg bg-lime px-8 text-sm font-semibold text-lime-on transition hover:bg-lime-deep"
      >
        {Q.startExam}
      </button>
    </div>
  );
}

/** m:ss (or h:mm:ss) for the exam timer. */
export function formatClock(ms: number): string {
  const s = Math.ceil(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
}
