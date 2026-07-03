"use client";

import { useCallback, useEffect, useState } from "react";
import { useI18n } from "@/lib/i18n/client";
import type { Flashcard } from "@/lib/workspace/types";
import { GRADES, reviewCard, type Grade } from "@/lib/study/srs";

/** A card to review, tagged with where it lives so grades persist correctly. */
export interface ReviewItem {
  pageId: string;
  blockId: string;
  card: Flashcard;
}

/** Human interval label for a grade button, e.g. "3d" / "10m". */
function intervalLabel(card: Flashcard, grade: Grade): string {
  if (grade === "again") return "<10m";
  const next = reviewCard(card, grade, new Date());
  const d = next.intervalDays ?? 0;
  return d <= 0 ? "<10m" : d === 1 ? "1d" : d < 30 ? `${d}d` : `${Math.round(d / 30)}mo`;
}

const GRADE_STYLES: Record<Grade, string> = {
  again: "border-rose-500/40 text-rose-500 hover:bg-rose-500 hover:text-white",
  hard: "border-amber-500/40 text-amber-600 hover:bg-amber-500 hover:text-white",
  good: "border-emerald-500/40 text-emerald-600 hover:bg-emerald-500 hover:text-white",
  easy: "border-sky-500/40 text-sky-600 hover:bg-sky-500 hover:text-white",
};

/**
 * Full-screen spaced-repetition review. Manages its own queue: an "again"
 * re-queues the card to the end for a same-session retry; every grade is
 * reported via `onGrade` so the parent can persist SM-2 state into the
 * workspace. Keyboard: Space/Enter flips, 1–4 grade, Esc exits.
 */
export function StudySession({
  items,
  title,
  onGrade,
  onClose,
  onFirstReview,
}: {
  items: ReviewItem[];
  title: string;
  onGrade: (item: ReviewItem, grade: Grade) => void;
  onClose: () => void;
  onFirstReview?: () => void;
}) {
  const { dict, t } = useI18n();
  const S = dict.study;
  const [queue, setQueue] = useState<ReviewItem[]>(items);
  const [flipped, setFlipped] = useState(false);
  const [done, setDone] = useState(0);
  const [again, setAgain] = useState(0);
  const [firstFired, setFirstFired] = useState(false);

  const current = queue[0];
  const total = items.length;

  const grade = useCallback(
    (g: Grade) => {
      if (!current) return;
      if (!firstFired) {
        setFirstFired(true);
        onFirstReview?.();
      }
      onGrade(current, g);
      setDone((n) => n + 1);
      setQueue((q) => {
        const [head, ...rest] = q;
        // "again": retry later this session with the freshly-scheduled state.
        return g === "again"
          ? [...rest, { ...head, card: reviewCard(head.card, g, new Date()) }]
          : rest;
      });
      if (g === "again") setAgain((n) => n + 1);
      setFlipped(false);
    },
    [current, firstFired, onFirstReview, onGrade],
  );

  const finished = !current;

  // Keyboard controls.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") return onClose();
      if (finished) return;
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
  }, [flipped, finished, grade, onClose]);

  const progress = total === 0 ? 100 : Math.round((done / (done + queue.length)) * 100);

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-paper/95 backdrop-blur-sm">
      {/* Top bar */}
      <div className="flex items-center justify-between border-b border-line px-5 py-3">
        <span className="truncate font-display text-sm font-bold text-ink">
          {title}
        </span>
        <div className="flex items-center gap-4">
          <span className="font-mono text-xs text-ink-soft">
            {finished ? total : Math.min(done + 1, total)} / {total}
          </span>
          <button
            onClick={onClose}
            className="rounded-md px-2 py-1 text-sm text-ink-soft transition hover:bg-hover hover:text-ink"
            aria-label={dict.common.cancel}
          >
            ✕
          </button>
        </div>
      </div>
      <div className="h-1 w-full bg-line">
        <div
          className="h-full bg-lime transition-all"
          style={{ width: `${progress}%` }}
        />
      </div>

      {finished ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-5 px-6 text-center">
          <div className="text-5xl" aria-hidden>
            🎉
          </div>
          <h2 className="font-display text-3xl font-bold tracking-tight text-ink">
            {S.doneTitle}
          </h2>
          <p className="max-w-sm text-ink-soft">
            {t(S.doneSummary, { count: total })}
            {again > 0 ? ` ${t(S.doneAgain, { count: again })}` : ""}
          </p>
          <button
            onClick={onClose}
            className="mt-2 rounded-lg bg-lime px-6 py-3 text-sm font-semibold text-lime-on transition hover:bg-lime-deep"
          >
            {S.finish}
          </button>
        </div>
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center gap-6 px-6 py-8">
          {/* Card */}
          <button
            onClick={() => setFlipped(true)}
            className="flex min-h-[220px] w-full max-w-2xl cursor-pointer flex-col items-center justify-center gap-4 rounded-2xl border border-line-strong bg-card p-8 text-center shadow-pop transition hover:border-ink/20"
            aria-label={flipped ? undefined : S.tapToReveal}
          >
            <p className="whitespace-pre-wrap font-display text-2xl font-semibold leading-snug text-ink">
              {current.card.front}
            </p>
            {flipped && (
              <>
                <div className="my-1 h-px w-16 bg-line-strong" aria-hidden />
                <p className="whitespace-pre-wrap text-lg leading-relaxed text-ink-soft">
                  {current.card.back}
                </p>
              </>
            )}
          </button>

          {/* Controls */}
          {flipped ? (
            <div className="grid w-full max-w-2xl grid-cols-2 gap-2 sm:grid-cols-4">
              {GRADES.map((g, i) => (
                <button
                  key={g}
                  onClick={() => grade(g)}
                  className={`flex flex-col items-center gap-1 rounded-xl border bg-card py-3 text-sm font-semibold transition ${GRADE_STYLES[g]}`}
                >
                  <span>{S.grades[g]}</span>
                  <span className="font-mono text-[11px] opacity-70">
                    {intervalLabel(current.card, g)}
                    <span className="ml-1 hidden sm:inline">· {i + 1}</span>
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <button
              onClick={() => setFlipped(true)}
              className="rounded-lg bg-ink px-6 py-3 text-sm font-semibold text-paper transition hover:bg-ink/90"
            >
              {S.showAnswer}
              <span className="ml-2 hidden font-mono text-[11px] opacity-60 sm:inline">
                {S.spaceKey}
              </span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}
