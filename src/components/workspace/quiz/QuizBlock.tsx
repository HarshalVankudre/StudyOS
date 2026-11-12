"use client";

import { useState } from "react";
import { ClipboardCheck, Dumbbell, ListChecks, Pencil, Plus } from "lucide-react";
import { useI18n } from "@/lib/i18n/client";
import type { QuizBlock as QuizBlockData } from "@/lib/workspace/types";
import { MAX_QUIZ_QUESTIONS } from "@/lib/workspace/schema";
import { isPlayableQuestion, newQuestion, percent, quizItems } from "@/lib/study/quiz";
import { useWorkspace } from "../WorkspaceContext";
import { DraftInput } from "../editor/DraftInput";
import { QuizEditor } from "./QuizEditor";
import { QuizSession, type QuizMode } from "./QuizSession";

/**
 * A practice quiz in a page: take it in practice or exam mode (never limited),
 * see the last score, and author questions by hand. Results are saved in the
 * block through the workspace update path.
 */
export function QuizBlock({ pageId, block }: { pageId: string; block: QuizBlockData }) {
  const { update } = useWorkspace();
  const { dict, t, plural } = useI18n();
  const Q = dict.quiz;
  const [session, setSession] = useState<QuizMode | null>(null);
  const [editing, setEditing] = useState(false);

  const playable = block.questions.filter(isPlayableQuestion).length;
  const attempts = block.attempts ?? [];
  const last = attempts.at(-1);
  const best = attempts.reduce<number | null>((m, a) => {
    const p = percent(a.score, a.total);
    return m === null || p > m ? p : m;
  }, null);

  const mutateBlock = (fn: (b: QuizBlockData) => void) =>
    update((d) => {
      const b = d.pages.find((p) => p.id === pageId)?.blocks.find((x) => x.id === block.id);
      if (b?.type === "quiz") fn(b);
    });

  const startEditingWithQuestion = () => {
    setEditing(true);
    if (block.questions.length >= MAX_QUIZ_QUESTIONS) return;
    mutateBlock((b) => {
      if (b.questions.length < MAX_QUIZ_QUESTIONS) b.questions.push(newQuestion("mcq"));
    });
  };

  const title = block.title || Q.untitled;
  const secondary =
    "flex min-h-11 items-center gap-1.5 rounded-lg border border-line-strong bg-card px-3 text-sm font-semibold text-ink transition hover:bg-hover";
  const primary =
    "flex min-h-11 items-center gap-1.5 rounded-lg bg-lime px-4 text-sm font-semibold text-lime-on transition hover:bg-lime-deep";

  return (
    <div className="my-4 overflow-hidden rounded-xl border border-line-strong bg-card shadow-card" data-testid="quiz-block">
      <div className="flex flex-wrap items-center gap-3 border-b border-line px-3 py-3 sm:px-4">
        <ListChecks className="size-5 shrink-0 text-lime-deep" aria-hidden />
        <DraftInput
          dir="auto"
          value={block.title ?? ""}
          onCommit={(title) =>
            mutateBlock((b) => {
              b.title = title;
            })
          }
          aria-label={Q.titlePlaceholder}
          placeholder={Q.titlePlaceholder}
          className="min-w-0 flex-1 rounded bg-transparent px-1 font-display text-base font-bold text-ink outline-none placeholder:text-ink-soft/40 hover:bg-hover focus:bg-hover"
        />
        <div className="flex flex-wrap items-center gap-1.5 font-mono text-[11px] text-ink-soft">
          <Chip label={plural(dict.counts.questions, playable)} />
          {last ? (
            <Chip label={t(Q.lastScore, { percent: percent(last.score, last.total) })} tone="score" />
          ) : (
            playable > 0 && <Chip label={Q.notTaken} />
          )}
          {best !== null && attempts.length > 1 && <Chip label={t(Q.bestScore, { percent: best })} />}
        </div>
      </div>

      <div data-print="hide" className="flex flex-col gap-2 px-3 py-3 sm:px-4">
        <div className="flex flex-wrap items-center gap-2">
          {playable > 0 ? (
            <>
              <button onClick={() => setSession("practice")} className={primary}>
                <Dumbbell className="size-4" aria-hidden />
                {Q.practice}
              </button>
              <button onClick={() => setSession("exam")} className={secondary}>
                <ClipboardCheck className="size-4" aria-hidden />
                {Q.exam}
              </button>
            </>
          ) : (
            <button onClick={startEditingWithQuestion} className={primary}>
              <Plus className="size-4" aria-hidden />
              {Q.addQuestion}
            </button>
          )}
          <button onClick={() => setEditing((v) => !v)} aria-pressed={editing} className={secondary}>
            <Pencil className="size-4" aria-hidden />
            {editing ? Q.doneEditing : Q.editQuestions}
          </button>
        </div>
        {playable === 0 && block.questions.length > 0 && (
          <p className="text-xs text-ink-soft">{Q.noPlayable}</p>
        )}
      </div>

      {editing && <QuizEditor questions={block.questions} mutate={mutateBlock} />}

      {session && (
        <QuizSession
          items={quizItems(pageId, block)}
          title={title}
          mode={session}
          attemptFor={{ pageId, blockId: block.id }}
          onClose={() => setSession(null)}
        />
      )}
    </div>
  );
}

function Chip({ label, tone }: { label: string; tone?: "score" }) {
  const cls =
    tone === "score"
      ? "bg-lime-faint text-lime-deep ring-lime/30"
      : "bg-hover text-ink-soft ring-line-strong";
  return <span className={`rounded-full px-2 py-0.5 ring-1 ring-inset ${cls}`}>{label}</span>;
}
