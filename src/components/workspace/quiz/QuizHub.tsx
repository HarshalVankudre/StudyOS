"use client";

import { ClipboardCheck, Dumbbell, Target } from "lucide-react";
import { useI18n } from "@/lib/i18n/client";
import type { Workspace } from "@/lib/workspace/types";
import {
  collectQuizItems,
  countMissedQuestions,
  isPlayableQuestion,
  percent,
  quizItems,
  selectWeakQuestions,
  type QuizItem,
} from "@/lib/study/quiz";
import type { QuizMode } from "./QuizSession";

/** How many questions a weak-questions round draws. */
export const WEAK_ROUND_SIZE = 10;

/** What the hub asks the launcher to start (the session outlives the hub dialog). */
export interface QuizRunRequest {
  items: QuizItem[];
  title: string;
  mode: QuizMode;
  attemptFor?: { pageId: string; blockId: string };
  mixed?: boolean;
}

/** Whether a workspace has any quiz block (the hub then shows quizzes). */
export function hasQuizzes(workspace: Pick<Workspace, "pages">): boolean {
  return workspace.pages.some((p) => p.blocks.some((b) => b.type === "quiz"));
}

/**
 * The quizzes part of the study hub: a weak-questions round drawn from every
 * quiz in the workspace (weighted toward the questions the student keeps
 * missing), and every quiz with its last score and one tap to practise or sit
 * it as an exam. Taking quizzes is never limited.
 */
export function QuizHubSection({
  workspace,
  onStart,
}: {
  workspace: Pick<Workspace, "pages">;
  onStart: (request: QuizRunRequest) => void;
}) {
  const { dict, t, plural } = useI18n();
  const Q = dict.quiz;
  const all = collectQuizItems(workspace);
  const playableCount = all.filter((i) => isPlayableQuestion(i.question)).length;
  const missed = countMissedQuestions(all);
  const quizzes = workspace.pages.flatMap((page) =>
    page.blocks.flatMap((block) => (block.type === "quiz" ? [{ page, block }] : [])),
  );

  return (
    <section aria-labelledby="quiz-hub-title" className="space-y-3">
      <h3 id="quiz-hub-title" className="font-display text-base font-bold text-ink">
        {Q.hubTitle}
      </h3>
      {quizzes.length === 0 ? (
        <p className="text-xs text-ink-soft">{Q.hubEmpty}</p>
      ) : (
        <>
          {playableCount > 0 && (
            <div className="space-y-2 rounded-xl border border-line bg-paper p-3">
              <p className="text-sm text-ink-soft">{Q.weakDesc}</p>
              <button
                onClick={() =>
                  onStart({
                    items: selectWeakQuestions(all, WEAK_ROUND_SIZE),
                    title: Q.weakSession,
                    mode: "practice",
                    mixed: true,
                  })
                }
                className="flex min-h-12 w-full items-center justify-center gap-2 rounded-lg bg-lime px-4 text-sm font-semibold text-lime-on transition hover:bg-lime-deep"
              >
                <Target className="size-4" aria-hidden />
                {Q.weakStart}
              </button>
              {missed > 0 && <p className="text-xs text-ink-soft">{t(Q.weakMissed, { count: missed })}</p>}
            </div>
          )}
          <ul className="space-y-2">
            {quizzes.map(({ page, block }) => {
              const playable = block.questions.filter(isPlayableQuestion).length;
              const last = block.attempts?.at(-1);
              const title = block.title || Q.untitled;
              const items = quizItems(page.id, block);
              const start = (mode: QuizMode) =>
                onStart({ items, title, mode, attemptFor: { pageId: page.id, blockId: block.id } });
              return (
                <li
                  key={`${page.id}:${block.id}`}
                  className="flex flex-wrap items-center gap-2 rounded-xl border border-line bg-card p-3"
                >
                  <div className="min-w-0 flex-1">
                    <p dir="auto" className="truncate text-sm font-semibold text-ink">{title}</p>
                    <p className="truncate text-xs text-ink-soft">
                      {[
                        page.title,
                        plural(dict.counts.questions, playable),
                        last ? t(Q.lastScore, { percent: percent(last.score, last.total) }) : Q.notTaken,
                      ].join(" · ")}
                    </p>
                  </div>
                  {playable > 0 && (
                    <div className="flex gap-2">
                      <button
                        onClick={() => start("practice")}
                        aria-label={`${Q.practice}: ${title}`}
                        className="flex min-h-11 items-center gap-1.5 rounded-lg border border-line-strong bg-card px-3 text-sm font-semibold text-ink transition hover:bg-hover"
                      >
                        <Dumbbell className="size-4" aria-hidden />
                        {Q.practice}
                      </button>
                      <button
                        onClick={() => start("exam")}
                        aria-label={`${Q.exam}: ${title}`}
                        className="flex min-h-11 items-center gap-1.5 rounded-lg border border-line-strong bg-card px-3 text-sm font-semibold text-ink transition hover:bg-hover"
                      >
                        <ClipboardCheck className="size-4" aria-hidden />
                        {Q.exam}
                      </button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </>
      )}
    </section>
  );
}
