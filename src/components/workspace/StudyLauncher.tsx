"use client";

import { useEffect, useState } from "react";
import { BarChart3, Dumbbell, Flame, Layers, Play } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { useI18n } from "@/lib/i18n/client";
import type { Flashcard } from "@/lib/workspace/types";
import { getStudyStatsAction } from "@/app/app/study-actions";
import {
  assignSchedule,
  dueQueue,
  isStudyable,
  practiceQueue,
  type Grade,
} from "@/lib/study/srs";
import { dueReviews, needsCatchUp, planCatchUp, postponeCard } from "@/lib/study/backlog";
import type { StreakStatus } from "@/lib/study/streak";
import { StudySession, type ReviewItem, type StudyMode } from "./StudySession";
import { useWorkspace } from "./WorkspaceContext";
import { CatchUpBanner } from "./study/CatchUpBanner";
import { StudyStats } from "./study/StudyStats";
import { STUDIED_EVENT, useReviewRecorder } from "./study/useReviewRecorder";

const itemKey = (pageId: string, blockId: string, cardId: string) => `${pageId}:${blockId}:${cardId}`;

/**
 * Header control for studying the whole workspace: one tap reviews every due
 * card across all decks; the streak button opens the study hub (practice all
 * decks, the welcome-back catch-up plan, streak freezes and statistics).
 */
export function StudyLauncher() {
  const { workspace, update } = useWorkspace();
  const { dict, t } = useI18n();
  const S = dict.study;
  const T = dict.studyTools;
  const record = useReviewRecorder(workspace.id);
  const [session, setSession] = useState<StudyMode | null>(null);
  const [hubOpen, setHubOpen] = useState(false);
  const [streak, setStreak] = useState<StreakStatus | null>(null);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    let active = true;
    const load = () =>
      // The browser's UTC offset makes "today" the student's local day.
      getStudyStatsAction(new Date().getTimezoneOffset())
        .then((s) => active && setStreak(s))
        .catch(() => {});
    void load();
    window.addEventListener(STUDIED_EVENT, load);
    return () => {
      active = false;
      window.removeEventListener(STUDIED_EVENT, load);
    };
  }, []);

  const now = new Date();
  const allCards: Flashcard[] = [];
  const itemOf = new Map<Flashcard, ReviewItem>();
  const dueItems: ReviewItem[] = [];
  const keyed: { key: string; card: Flashcard }[] = [];
  for (const page of workspace.pages) {
    for (const block of page.blocks) {
      if (block.type !== "flashcards") continue;
      for (const card of block.cards) {
        allCards.push(card);
        itemOf.set(card, { pageId: page.id, blockId: block.id, card });
        keyed.push({ key: itemKey(page.id, block.id, card.id), card });
      }
      for (const card of dueQueue(block.cards, now)) {
        dueItems.push({ pageId: page.id, blockId: block.id, card });
      }
    }
  }
  const hasDecks = itemOf.size > 0 || workspace.pages.some((p) => p.blocks.some((b) => b.type === "flashcards"));
  const studyable = allCards.filter(isStudyable).length;
  const dueCount = dueItems.length;
  const catchUp = needsCatchUp(keyed, now) ? planCatchUp(keyed, now) : null;

  const items =
    session === "practice" ? practiceQueue(allCards, now).map((c) => itemOf.get(c)!) : dueItems;

  const onGrade = (item: ReviewItem, _grade: Grade, next: Flashcard) =>
    update((d) => {
      const b = d.pages.find((p) => p.id === item.pageId)?.blocks.find((x) => x.id === item.blockId);
      if (b?.type !== "flashcards") return;
      const card = b.cards.find((c) => c.id === item.card.id);
      if (card) assignSchedule(card, next);
    });

  const spreadOut = () => {
    if (!catchUp) return;
    const moves = new Map(catchUp.moves.map((m) => [m.key, m.dueAt]));
    update((d) => {
      for (const page of d.pages) {
        for (const block of page.blocks) {
          if (block.type !== "flashcards") continue;
          for (const card of block.cards) {
            const day = moves.get(itemKey(page.id, block.id, card.id));
            if (day) postponeCard(card, day);
          }
        }
      }
    });
    setNotice(t(T.spreadDone, { today: catchUp.today, moved: catchUp.moved, days: catchUp.days }));
  };

  const start = (mode: StudyMode) => {
    setHubOpen(false);
    setSession(mode);
  };

  const current = streak?.current ?? 0;
  if (!hasDecks && current === 0) return null;

  const streakLabel = current > 0 ? `${t(T.streakDays, { count: current })} · ${T.openHub}` : T.openHub;

  return (
    <>
      <button
        onClick={() => setHubOpen(true)}
        aria-label={streakLabel}
        title={streakLabel}
        className={`flex min-h-11 min-w-11 items-center justify-center gap-1 rounded-md px-2 font-mono text-[11px] font-semibold ring-1 ring-inset transition sm:min-h-0 sm:py-1 ${
          streak?.atRisk
            ? "bg-amber-400/15 text-amber-700 ring-amber-500/60 dark:text-amber-300"
            : current > 0
              ? "bg-amber-400/10 text-amber-600 ring-amber-400/30 hover:bg-amber-400/20 dark:text-amber-300"
              : "text-ink-soft ring-line-strong hover:bg-hover"
        }`}
      >
        {current > 0 ? (
          <>
            <Flame className="size-4" aria-hidden />
            {current}
          </>
        ) : (
          <BarChart3 className="size-4" aria-hidden />
        )}
      </button>
      {dueCount > 0 && (
        <button
          onClick={() => (catchUp ? setHubOpen(true) : start("review"))}
          className="flex min-h-11 items-center gap-1.5 rounded-md border border-lime bg-lime-faint px-2 text-xs font-semibold text-ink transition hover:bg-lime/20 sm:min-h-0 sm:px-3 sm:py-1.5"
        >
          <Layers className="size-4" aria-hidden />
          {t(S.dueAcrossWorkspace, { count: dueCount })}
        </button>
      )}

      {hubOpen && (
        <Dialog open onOpenChange={(open) => !open && setHubOpen(false)}>
          <DialogContent className="flex max-h-[92dvh] flex-col gap-4 overflow-y-auto p-4 sm:max-w-lg sm:p-6">
            <DialogTitle className="font-display text-lg font-bold text-ink">{T.studyHub}</DialogTitle>
            <DialogDescription className="-mt-2 text-sm text-ink-soft">{T.studyHubDesc}</DialogDescription>

            {catchUp && (
              <CatchUpBanner
                plan={catchUp}
                dueCount={dueReviews(keyed, now).length}
                onSpread={spreadOut}
                onStudyAll={() => start("review")}
              />
            )}
            <p role="status" aria-live="polite" className="text-sm text-ink-soft empty:hidden">
              {notice}
            </p>

            <div className="flex flex-col gap-2 sm:flex-row">
              {dueCount > 0 && !catchUp && (
                <button
                  onClick={() => start("review")}
                  className="flex min-h-12 flex-1 items-center justify-center gap-2 rounded-lg bg-lime px-4 text-sm font-semibold text-lime-on transition hover:bg-lime-deep"
                >
                  <Play className="size-4" aria-hidden />
                  {t(T.reviewAllDecks, { count: dueCount })}
                </button>
              )}
              {studyable > 0 && (
                <button
                  onClick={() => start("practice")}
                  className="flex min-h-12 flex-1 items-center justify-center gap-2 rounded-lg border border-line-strong bg-card px-4 text-sm font-semibold text-ink transition hover:bg-hover"
                >
                  <Dumbbell className="size-4" aria-hidden />
                  {T.practiceAll}
                </button>
              )}
            </div>
            {dueCount === 0 && (
              <p className="-mt-2 text-xs text-ink-soft">{studyable > 0 ? T.caughtUpHint : T.noDecks}</p>
            )}

            <StudyStats workspaceId={workspace.id} cards={allCards} />
          </DialogContent>
        </Dialog>
      )}

      {/* No live-count guard: `items` empties as cards are graded; gating the
          render on dueCount would unmount the session before its summary.
          StudySession snapshots its queue. */}
      {session && (
        <StudySession
          items={items}
          title={workspace.name}
          mode={session}
          onGrade={onGrade}
          onAnswer={(e) => record({ grade: e.grade, prevState: e.prevState, practice: e.practice })}
          onClose={() => setSession(null)}
        />
      )}
    </>
  );
}
