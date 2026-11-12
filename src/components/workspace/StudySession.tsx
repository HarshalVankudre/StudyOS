"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Dumbbell, PartyPopper, X } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { useI18n } from "@/lib/i18n/client";
import type { Flashcard } from "@/lib/workspace/types";
import {
  GRADES,
  cardState,
  isShortTerm,
  isStudyable,
  isoDay,
  msUntilDue,
  previewCard,
  reviewCard,
  type CardState,
  type Grade,
} from "@/lib/study/srs";
import { daysBetween } from "@/lib/study/days";
import { intervalParts } from "@/lib/study/format";
import { CardContent } from "./study/CardContent";
import { findCard } from "./study/gradeEdit";
import { useWorkspace } from "./WorkspaceContext";

/** A card to review, tagged with where it lives so grades persist correctly. */
export interface ReviewItem {
  pageId: string;
  blockId: string;
  card: Flashcard;
}

/**
 * A card can be studied only when both sides have content. Blank cards are
 * allowed in a deck while the student is still writing them; they are simply
 * left out of review until both sides are filled in.
 */
export const isStudyableCard = isStudyable;

export type StudyMode = "review" | "practice";

export interface AnswerEvent {
  item: ReviewItem;
  grade: Grade;
  /** The card's state before this answer. */
  prevState: CardState;
  practice: boolean;
}

const GRADE_STYLES: Record<Grade, string> = {
  again: "border-rose-500/40 text-rose-600 hover:bg-rose-500 hover:text-white dark:text-rose-400",
  hard: "border-amber-500/40 text-amber-600 hover:bg-amber-500 hover:text-white dark:text-amber-400",
  good: "border-emerald-500/40 text-emerald-600 hover:bg-emerald-500 hover:text-white dark:text-emerald-400",
  easy: "border-sky-500/40 text-sky-600 hover:bg-sky-500 hover:text-white dark:text-sky-400",
};

const keyOf = (item: ReviewItem) => `${item.pageId}:${item.blockId}:${item.card.id}`;

/**
 * Full-screen flashcard session.
 *
 * mode "review": spaced repetition. Every grade is reported through `onGrade`
 *   with the card's next FSRS state and the moment of the answer, so the
 *   parent can persist it (see study/gradeEdit.ts); a card that lands in a
 *   short (re)learning step comes back later in the same session. Cards are
 *   read from the workspace as it is now (not as it was when the session
 *   started), so a change made meanwhile (another device, the AI agent) is
 *   shown and built upon.
 * mode "practice": cram through any cards without touching the schedule;
 *   "again" simply shows the card once more at the end.
 *
 * Blank cards are skipped. Keyboard: Space/Enter flips, 1–4 grade, Esc exits.
 * Ends with a summary: cards studied, how many felt hard, when they are due.
 */
export function StudySession({
  items,
  title,
  mode = "review",
  onGrade,
  onAnswer,
  onClose,
  returnFocus,
}: {
  items: ReviewItem[];
  title: string;
  mode?: StudyMode;
  onGrade?: (item: ReviewItem, grade: Grade, next: Flashcard, at: Date) => void;
  onAnswer?: (event: AnswerEvent) => void;
  onClose: () => void;
  /** Focus target on close when the button that opened the session is gone. */
  returnFocus?: () => HTMLElement | null | undefined;
}) {
  const { dict, t } = useI18n();
  const S = dict.study;
  const T = dict.studyTools;
  const practice = mode === "practice";
  const { workspace, status, retrySave } = useWorkspace();

  // Snapshot the queue: the parent's due list shrinks as cards are graded.
  const [queue, setQueue] = useState<ReviewItem[]>(() => items.filter((i) => isStudyable(i.card)));
  const [total] = useState(() => new Set(queue.map(keyOf)).size);
  const [flipped, setFlipped] = useState(false);
  const [results, setResults] = useState<ReadonlyMap<string, { hard: boolean; card: Flashcard }>>(
    () => new Map(),
  );
  const [answered, setAnswered] = useState(0);

  const queued = queue[0];
  // The card as it is in the workspace now; the queued copy only if it was
  // deleted meanwhile.
  const liveCard = queued
    ? (workspace &&
        findCard(workspace, { pageId: queued.pageId, blockId: queued.blockId, cardId: queued.card.id })) ||
      queued.card
    : undefined;
  const current = useMemo(
    () => (queued && liveCard && liveCard !== queued.card ? { ...queued, card: liveCard } : queued),
    [queued, liveCard],
  );
  const finished = !current;
  const remaining = useMemo(() => new Set(queue.map(keyOf)).size, [queue]);
  const completed = total - remaining;

  const currentCard = current?.card;
  const preview = useMemo(
    () => (currentCard && !practice ? previewCard(currentCard, new Date()) : null),
    [currentCard, practice],
  );

  const grade = useCallback(
    (g: Grade) => {
      if (!current) return;
      const now = new Date();
      const prevState = cardState(current.card);
      let requeue: ReviewItem | null = null;
      let finalCard = current.card;
      if (practice) {
        if (g === "again") requeue = current;
      } else {
        const next = reviewCard(current.card, g, now);
        onGrade?.(current, g, next, now);
        finalCard = next;
        if (isShortTerm(next)) requeue = { ...current, card: next };
      }
      onAnswer?.({ item: current, grade: g, prevState, practice });
      const key = keyOf(current);
      setResults((prev) => {
        const next = new Map(prev);
        next.set(key, {
          hard: (prev.get(key)?.hard ?? false) || g === "again" || g === "hard",
          card: finalCard,
        });
        return next;
      });
      setAnswered((n) => n + 1);
      setQueue((q) => {
        const rest = q.slice(1);
        return requeue ? [...rest, requeue] : rest;
      });
      setFlipped(false);
    },
    [current, practice, onGrade, onAnswer],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (finished || e.defaultPrevented) return;
      const target = e.target as HTMLElement | null;
      if (target?.closest?.("input, textarea, [contenteditable='true']")) return;
      if (!flipped && (e.key === " " || e.key === "Enter")) {
        e.preventDefault();
        setFlipped(true);
        return;
      }
      if (flipped) {
        const idx = ["1", "2", "3", "4"].indexOf(e.key);
        if (idx >= 0) {
          e.preventDefault();
          grade(GRADES[idx]);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [flipped, finished, grade]);

  const intervalLabel = (g: Grade): string => {
    if (!preview) return "";
    const { unit, n } = intervalParts(msUntilDue(preview[g], new Date()));
    return t(T.intervals[unit], { n });
  };

  const progress = total === 0 ? 100 : Math.round((completed / total) * 100);

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        showCloseButton={false}
        returnFocus={returnFocus}
        onPointerDownOutside={(event) => event.preventDefault()}
        className="inset-0 top-0 left-0 flex h-[100dvh] w-screen max-w-none translate-x-0 translate-y-0 flex-col gap-0 rounded-none border-0 bg-paper/95 p-0 backdrop-blur-sm sm:max-w-none"
      >
        <DialogDescription className="sr-only">
          {practice ? T.practiceBanner : S.tapToReveal}
        </DialogDescription>
        {/* Top bar */}
        <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-2 sm:px-5">
          <DialogTitle dir="auto" className="min-w-0 truncate font-display text-sm font-bold text-ink">
            {title}
          </DialogTitle>
          <div className="flex shrink-0 items-center gap-3">
            <span className="font-mono text-xs text-ink-soft" dir="ltr">
              {finished ? total : Math.min(completed + 1, total)} / {total}
            </span>
            <button
              onClick={onClose}
              className="grid h-11 w-11 place-items-center rounded-md text-ink-soft transition hover:bg-hover hover:text-ink"
              aria-label={dict.common.cancel}
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
        {/* The editor's save banners sit behind this full-screen session. */}
        {!practice && status && status !== "saved" && status !== "saving" && (
          <div
            role="alert"
            className="flex flex-wrap items-center justify-center gap-2 border-b border-line bg-amber-400/10 px-4 py-2 text-center text-xs font-medium text-ink"
          >
            <span>{dict.safety.sessionNotSaving}</span>
            {(status === "error" || status === "offline") && retrySave && (
              <button
                type="button"
                onClick={retrySave}
                className="min-h-9 rounded-md border border-line-strong bg-card px-3 text-xs font-semibold transition hover:bg-hover"
              >
                {dict.safety.retry}
              </button>
            )}
          </div>
        )}
        {practice && !finished && (
          <p className="flex items-center justify-center gap-2 border-b border-line bg-sky-500/10 px-4 py-2 text-center text-xs font-medium text-sky-700 dark:text-sky-300">
            <Dumbbell className="size-4 shrink-0" aria-hidden />
            {T.practiceBanner}
          </p>
        )}

        {finished ? (
          <SessionSummary
            practice={practice}
            answered={answered}
            results={[...results.values()]}
            onClose={onClose}
          />
        ) : (
          <div className="flex min-h-0 flex-1 flex-col items-center gap-5 overflow-y-auto px-4 py-6 sm:justify-center sm:px-6">
            {/* Tap anywhere on the card to reveal; the button below is the
                keyboard and screen-reader path. */}
            <div
              onClick={() => setFlipped(true)}
              data-testid="study-card"
              className="flex min-h-[220px] w-full max-w-2xl cursor-pointer flex-col items-center justify-center gap-4 rounded-2xl border border-line-strong bg-card p-5 text-center shadow-pop transition hover:border-ink/20 sm:p-8"
            >
              <CardContent
                text={current.card.front}
                className="font-display text-xl font-semibold leading-snug text-ink sm:text-2xl"
              />
              {flipped && (
                <>
                  <div className="my-1 h-px w-16 bg-line-strong" aria-hidden />
                  <CardContent
                    text={current.card.back}
                    source={current.card.source}
                    className="text-base leading-relaxed text-ink-soft sm:text-lg"
                  />
                </>
              )}
            </div>

            {flipped ? (
              <div className="grid w-full max-w-2xl grid-cols-2 gap-2 sm:grid-cols-4">
                {GRADES.map((g, i) => (
                  <button
                    key={g}
                    onClick={() => grade(g)}
                    className={`flex min-h-12 flex-col items-center justify-center gap-0.5 rounded-xl border bg-card px-2 py-2.5 text-sm font-semibold transition ${GRADE_STYLES[g]}`}
                  >
                    <span>{S.grades[g]}</span>
                    <span className="font-mono text-[11px] opacity-75">
                      {!practice && <span dir="ltr">{intervalLabel(g)}</span>}
                      <span className="hidden sm:inline" aria-hidden>
                        {!practice && " · "}
                        {i + 1}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            ) : (
              <button
                onClick={() => setFlipped(true)}
                className="min-h-12 rounded-lg bg-ink px-6 py-3 text-sm font-semibold text-paper transition hover:bg-ink/90"
              >
                {S.showAnswer}
                <span className="ms-2 hidden font-mono text-[11px] opacity-60 sm:inline">
                  {S.spaceKey}
                </span>
              </button>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function SessionSummary({
  practice,
  answered,
  results,
  onClose,
}: {
  practice: boolean;
  answered: number;
  results: { hard: boolean; card: Flashcard }[];
  onClose: () => void;
}) {
  const { dict, t, plural } = useI18n();
  const S = dict.study;
  const T = dict.studyTools;
  const today = isoDay(new Date());
  const hard = results.filter((r) => r.hard).length;

  // When are this session's cards due next? (Practice leaves them as they were.)
  const byDay = new Map<string, number>();
  for (const { card } of results) {
    if (!card.dueAt || cardState(card) === "new") continue;
    const day = card.dueAt < today ? today : card.dueAt;
    if (!practice && day <= today) continue; // still mid-lesson today
    byDay.set(day, (byDay.get(day) ?? 0) + 1);
  }
  const nextDay = [...byDay.keys()].sort()[0];
  let nextLabel = T.nothingScheduled;
  if (nextDay) {
    const d = daysBetween(today, nextDay);
    const when = d <= 0 ? T.dueToday : d === 1 ? T.dueTomorrow : plural(dict.counts.inDays, d);
    nextLabel = `${when} · ${plural(dict.counts.cards, byDay.get(nextDay)!)}`;
  }

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-5 overflow-y-auto px-6 py-8 text-center">
      <PartyPopper className="size-12 text-lime-deep" aria-hidden />
      <h2 className="font-display text-3xl font-bold tracking-tight text-ink">{S.doneTitle}</h2>
      <dl className="grid w-full max-w-md grid-cols-3 gap-2">
        <SummaryTile label={practice ? T.summaryPracticed : T.summaryReviewed} value={String(results.length)} />
        <SummaryTile label={T.summaryHard} value={String(hard)} />
        <SummaryTile label={T.summaryNext} value={nextLabel} small />
      </dl>
      <p className="max-w-sm text-sm text-ink-soft">
        {practice ? T.scheduleUnchanged : t(T.summaryAnswers, { count: answered })}
      </p>
      <button
        onClick={onClose}
        className="mt-1 min-h-12 rounded-lg bg-lime px-6 py-3 text-sm font-semibold text-lime-on transition hover:bg-lime-deep"
      >
        {S.finish}
      </button>
    </div>
  );
}

function SummaryTile({ label, value, small }: { label: string; value: string; small?: boolean }) {
  return (
    <div className="flex flex-col items-center justify-center gap-1 rounded-xl border border-line bg-card px-2 py-3">
      <dt className="text-[11px] font-medium text-ink-soft">{label}</dt>
      <dd className={small ? "text-sm font-semibold text-ink" : "font-display text-2xl font-bold text-ink"}>
        {value}
      </dd>
    </div>
  );
}
