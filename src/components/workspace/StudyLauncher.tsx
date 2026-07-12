"use client";

import { useEffect, useState } from "react";
import { useI18n } from "@/lib/i18n/client";
import { dueQueue, reviewCard, type Grade } from "@/lib/study/srs";
import {
  getStudyStatsAction,
  recordStudyReviewAction,
} from "@/app/app/study-actions";
import { StudySession, type ReviewItem } from "./StudySession";
import { useWorkspace } from "./WorkspaceContext";

/**
 * Header control that surfaces every due flashcard across the whole workspace
 * and launches one combined review session — the "you have N cards due today"
 * hook. Also shows the user's daily study streak.
 */
export function StudyLauncher() {
  const { workspace, update } = useWorkspace();
  const { dict, t } = useI18n();
  const S = dict.study;
  const [studying, setStudying] = useState(false);
  const [streak, setStreak] = useState(0);

  useEffect(() => {
    let active = true;
    // Pass the browser's UTC offset so the streak is bucketed by local day.
    getStudyStatsAction(new Date().getTimezoneOffset())
      .then((s) => {
        if (active) setStreak(s.streak);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  const now = new Date();
  const items: ReviewItem[] = [];
  for (const page of workspace.pages) {
    for (const block of page.blocks) {
      if (block.type === "flashcards") {
        for (const card of dueQueue(block.cards, now)) {
          items.push({ pageId: page.id, blockId: block.id, card });
        }
      }
    }
  }
  const dueCount = items.length;

  const onGrade = (item: ReviewItem, grade: Grade) =>
    update((d) => {
      const b = d.pages
        .find((p) => p.id === item.pageId)
        ?.blocks.find((x) => x.id === item.blockId);
      if (b?.type === "flashcards") {
        const card = b.cards.find((c) => c.id === item.card.id);
        if (card) Object.assign(card, reviewCard(card, grade, new Date()));
      }
    });

  // Nothing to study and no streak worth showing → stay out of the way.
  if (dueCount === 0 && streak === 0) return null;

  return (
    <>
      {streak > 0 && (
        <span
          className="flex items-center gap-1 rounded-md bg-amber-400/10 px-2 py-1 font-mono text-[11px] font-semibold text-amber-600 ring-1 ring-inset ring-amber-400/30"
          title={t(S.streak, { count: streak })}
        >
          🔥 {streak}
        </span>
      )}
      {dueCount > 0 && (
        <button
          onClick={() => setStudying(true)}
          className="flex min-h-11 items-center gap-1.5 rounded-md border border-lime bg-lime-faint px-2 text-xs font-semibold text-ink transition hover:bg-lime/20 sm:min-h-0 sm:px-3 sm:py-1.5"
        >
          🗂️ {t(S.dueAcrossWorkspace, { count: dueCount })}
        </button>
      )}

      {/* No live-count guard: `items` empties as cards are graded; gating the
          render on dueCount would unmount the session before its completion
          screen. StudySession snapshots its queue; the button gates opening. */}
      {studying && (
        <StudySession
          items={items}
          title={workspace.name}
          onGrade={onGrade}
          onClose={() => setStudying(false)}
          onFirstReview={() => {
            void recordStudyReviewAction();
            if (!streak) setStreak(1); // optimistic: first study today
          }}
        />
      )}
    </>
  );
}
