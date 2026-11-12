"use client";

import { useState } from "react";
import { ChevronDown, Copy, Download, Dumbbell, Layers, Pencil, Play, Plus, Upload } from "lucide-react";
import { useI18n } from "@/lib/i18n/client";
import type { Flashcard, FlashcardsBlock as FlashcardsBlockData } from "@/lib/workspace/types";
import { MAX_FLASHCARDS } from "@/lib/workspace/schema";
import {
  assignSchedule,
  deckStats,
  dueQueue,
  isStudyable,
  practiceQueue,
  type Grade,
} from "@/lib/study/srs";
import { dueReviews, needsCatchUp, planCatchUp, postponeCard } from "@/lib/study/backlog";
import { deckFileName, toAnkiText, toQuizletText } from "@/lib/study/transfer";
import { StudySession, type ReviewItem, type StudyMode } from "./StudySession";
import { useWorkspace } from "./WorkspaceContext";
import { CardEditor } from "./study/CardEditor";
import { CatchUpBanner } from "./study/CatchUpBanner";
import { ImportDialog } from "./study/ImportDialog";
import { useReviewRecorder } from "./study/useReviewRecorder";

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

export function FlashcardsBlock({
  pageId,
  block,
}: {
  pageId: string;
  block: FlashcardsBlockData;
}) {
  const { workspace, update } = useWorkspace();
  const { dict, t } = useI18n();
  const S = dict.study;
  const T = dict.studyTools;
  const record = useReviewRecorder(workspace.id);
  const [session, setSession] = useState<StudyMode | null>(null);
  const [editing, setEditing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [notice, setNotice] = useState("");

  const now = new Date();
  // Blank cards stay in the deck while being written but are never studied.
  const stats = deckStats(block.cards, now);
  const studyable = block.cards.filter(isStudyable).length;
  const keyed = block.cards.map((card) => ({ key: card.id, card }));
  const catchUp = needsCatchUp(keyed, now) ? planCatchUp(keyed, now) : null;

  // Locate this block in a draft so mutations target the right cards.
  const mutateBlock = (fn: (b: FlashcardsBlockData) => void) =>
    update((d) => {
      const b = d.pages
        .find((p) => p.id === pageId)
        ?.blocks.find((x) => x.id === block.id);
      if (b?.type === "flashcards") fn(b);
    });

  const onGrade = (item: ReviewItem, _grade: Grade, next: Flashcard) =>
    mutateBlock((b) => {
      const card = b.cards.find((c) => c.id === item.card.id);
      if (card) assignSchedule(card, next);
    });

  const spreadOut = () => {
    if (!catchUp) return;
    const moves = new Map(catchUp.moves.map((m) => [m.key, m.dueAt]));
    mutateBlock((b) => {
      for (const card of b.cards) {
        const day = moves.get(card.id);
        if (day) postponeCard(card, day);
      }
    });
    setNotice(t(T.spreadDone, { today: catchUp.today, moved: catchUp.moved, days: catchUp.days }));
  };

  const queue = session === "practice" ? practiceQueue(block.cards, now) : dueQueue(block.cards, now);
  const items: ReviewItem[] = queue.map((card) => ({ pageId, blockId: block.id, card }));

  const startEditingWithCard = () => {
    setEditing(true);
    if (block.cards.length >= MAX_FLASHCARDS) return;
    mutateBlock((b) => {
      if (b.cards.length < MAX_FLASHCARDS) b.cards.push({ id: crypto.randomUUID(), front: "", back: "" });
    });
  };

  const title = block.title || S.untitledDeck;
  const exportCards = (kind: "anki" | "quizlet" | "copy") => {
    setMoreOpen(false);
    if (kind === "anki") {
      const name = deckFileName(title, "-anki.txt");
      download(name, toAnkiText(block.cards));
      setNotice(t(T.exported, { file: name }));
    } else if (kind === "quizlet") {
      const name = deckFileName(title, "-quizlet.txt");
      download(name, toQuizletText(block.cards));
      setNotice(t(T.exported, { file: name }));
    } else {
      navigator.clipboard
        ?.writeText(toQuizletText(block.cards))
        .then(() => setNotice(T.copied))
        .catch(() => setNotice(T.copyFailed));
    }
  };

  const secondary =
    "flex min-h-11 items-center gap-1.5 rounded-lg border border-line-strong bg-card px-3 text-sm font-semibold text-ink transition hover:bg-hover";

  return (
    <div className="my-4 overflow-hidden rounded-xl border border-line-strong bg-card shadow-card">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-3 border-b border-line px-3 py-3 sm:px-4">
        <Layers className="size-5 shrink-0 text-lime-deep" aria-hidden />
        <input
          value={block.title ?? ""}
          onChange={(e) =>
            mutateBlock((b) => {
              b.title = e.target.value;
            })
          }
          aria-label={S.deckTitlePlaceholder}
          placeholder={S.deckTitlePlaceholder}
          className="min-w-0 flex-1 rounded bg-transparent px-1 font-display text-base font-bold text-ink outline-none placeholder:text-ink-soft/40 hover:bg-hover focus:bg-hover"
        />
        <div className="flex items-center gap-1.5 font-mono text-[11px] text-ink-soft">
          <Chip label={t(S.stats.cards, { count: block.cards.length })} />
          {stats.due > 0 && <Chip label={t(S.stats.due, { count: stats.due })} tone="due" />}
          {stats.mature > 0 && <Chip label={t(S.stats.mature, { count: stats.mature })} tone="mature" />}
        </div>
      </div>

      {catchUp && (
        <div className="px-3 pt-3 sm:px-4">
          <CatchUpBanner plan={catchUp} dueCount={dueReviews(keyed, now).length} onSpread={spreadOut} />
        </div>
      )}

      {/* Actions */}
      <div className="flex flex-col gap-2 px-3 py-3 sm:px-4">
        <div className="flex flex-wrap items-center gap-2">
          {stats.due > 0 ? (
            <button
              onClick={() => setSession("review")}
              className="flex min-h-11 items-center gap-1.5 rounded-lg bg-lime px-4 text-sm font-semibold text-lime-on transition hover:bg-lime-deep"
            >
              <Play className="size-4" aria-hidden />
              {t(S.studyDue, { count: stats.due })}
            </button>
          ) : studyable > 0 ? (
            <button
              onClick={() => setSession("practice")}
              className="flex min-h-11 items-center gap-1.5 rounded-lg bg-lime px-4 text-sm font-semibold text-lime-on transition hover:bg-lime-deep"
            >
              <Dumbbell className="size-4" aria-hidden />
              {T.practice}
            </button>
          ) : (
            <button
              onClick={startEditingWithCard}
              className="flex min-h-11 items-center gap-1.5 rounded-lg bg-lime px-4 text-sm font-semibold text-lime-on transition hover:bg-lime-deep"
            >
              <Plus className="size-4" aria-hidden />
              {T.addCard}
            </button>
          )}
          {stats.due > 0 && (
            <button onClick={() => setSession("practice")} className={secondary}>
              <Dumbbell className="size-4" aria-hidden />
              {T.practice}
            </button>
          )}
          <button onClick={() => setEditing((v) => !v)} aria-pressed={editing} className={secondary}>
            <Pencil className="size-4" aria-hidden />
            {editing ? S.doneEditing : S.editCards}
          </button>
          <button
            onClick={() => setMoreOpen((v) => !v)}
            aria-expanded={moreOpen}
            className={secondary}
          >
            {T.importExport}
            <ChevronDown className={`size-4 transition ${moreOpen ? "rotate-180" : ""}`} aria-hidden />
          </button>
        </div>
        {stats.due === 0 && studyable > 0 && (
          <p className="text-xs text-ink-soft">{T.caughtUpHint}</p>
        )}
        {moreOpen && (
          <div className="flex flex-wrap gap-2 rounded-lg bg-hover/60 p-2">
            <button
              onClick={() => {
                setMoreOpen(false);
                setImporting(true);
              }}
              className={secondary}
            >
              <Upload className="size-4" aria-hidden />
              {T.importCards}
            </button>
            <button onClick={() => exportCards("anki")} disabled={studyable === 0} className={`${secondary} disabled:opacity-40`}>
              <Download className="size-4" aria-hidden />
              {T.exportAnki}
            </button>
            <button onClick={() => exportCards("quizlet")} disabled={studyable === 0} className={`${secondary} disabled:opacity-40`}>
              <Download className="size-4" aria-hidden />
              {T.exportQuizlet}
            </button>
            <button onClick={() => exportCards("copy")} disabled={studyable === 0} className={`${secondary} disabled:opacity-40`}>
              <Copy className="size-4" aria-hidden />
              {T.copyQuizlet}
            </button>
          </div>
        )}
        <p role="status" aria-live="polite" className="text-xs text-ink-soft empty:hidden">
          {notice}
        </p>
      </div>

      {editing && <CardEditor cards={block.cards} mutate={mutateBlock} />}

      {importing && (
        <ImportDialog
          existing={block.cards}
          onClose={() => setImporting(false)}
          onImport={(cards) => {
            mutateBlock((b) => {
              b.cards.push(...cards.slice(0, Math.max(0, MAX_FLASHCARDS - b.cards.length)));
            });
            setImporting(false);
            setNotice(t(T.imported, { count: cards.length }));
          }}
        />
      )}

      {/* No live-length guard: `items` empties as cards are graded, and gating
          the render on it would unmount the session before its summary.
          StudySession snapshots its own queue. */}
      {session && (
        <StudySession
          items={items}
          title={title}
          mode={session}
          onGrade={onGrade}
          onAnswer={(e) => record({ grade: e.grade, prevState: e.prevState, practice: e.practice })}
          onClose={() => setSession(null)}
        />
      )}
    </div>
  );
}

function Chip({ label, tone }: { label: string; tone?: "due" | "mature" }) {
  const cls =
    tone === "due"
      ? "bg-lime-faint text-lime-deep ring-lime/30"
      : tone === "mature"
        ? "bg-emerald-400/10 text-emerald-600 ring-emerald-400/30 dark:text-emerald-300"
        : "bg-hover text-ink-soft ring-line-strong";
  return <span className={`rounded-full px-2 py-0.5 ring-1 ring-inset ${cls}`}>{label}</span>;
}
