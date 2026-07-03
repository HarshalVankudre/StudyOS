"use client";

import { useState } from "react";
import { useI18n } from "@/lib/i18n/client";
import type { FlashcardsBlock as FlashcardsBlockData } from "@/lib/workspace/types";
import { deckStats, dueQueue, type Grade } from "@/lib/study/srs";
import { reviewCard } from "@/lib/study/srs";
import { recordStudyReviewAction } from "@/app/app/study-actions";
import { StudySession, type ReviewItem } from "./StudySession";
import { useWorkspace } from "./WorkspaceContext";

export function FlashcardsBlock({
  pageId,
  block,
}: {
  pageId: string;
  block: FlashcardsBlockData;
}) {
  const { update } = useWorkspace();
  const { dict, t } = useI18n();
  const S = dict.study;
  const [studying, setStudying] = useState(false);
  const [editing, setEditing] = useState(false);

  const now = new Date();
  const stats = deckStats(block.cards, now);

  // Locate this block in a draft so mutations target the right cards.
  const mutateBlock = (fn: (b: FlashcardsBlockData) => void) =>
    update((d) => {
      const b = d.pages
        .find((p) => p.id === pageId)
        ?.blocks.find((x) => x.id === block.id);
      if (b?.type === "flashcards") fn(b);
    });

  const onGrade = (item: ReviewItem, grade: Grade) =>
    mutateBlock((b) => {
      const card = b.cards.find((c) => c.id === item.card.id);
      if (card) Object.assign(card, reviewCard(card, grade, new Date()));
    });

  const startStudy = () => {
    if (stats.due === 0) return;
    setStudying(true);
  };

  const items: ReviewItem[] = dueQueue(block.cards, now).map((card) => ({
    pageId,
    blockId: block.id,
    card,
  }));

  const addCard = () =>
    mutateBlock((b) => {
      b.cards.push({ id: crypto.randomUUID(), front: "", back: "" });
    });

  return (
    <div className="my-4 overflow-hidden rounded-xl border border-line-strong bg-card shadow-card">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3">
        <span className="text-lg" aria-hidden>
          🗂️
        </span>
        <input
          value={block.title ?? ""}
          onChange={(e) =>
            mutateBlock((b) => {
              b.title = e.target.value;
            })
          }
          placeholder={S.deckTitlePlaceholder}
          className="min-w-0 flex-1 rounded bg-transparent px-1 font-display text-base font-bold text-ink outline-none placeholder:text-ink-soft/40 hover:bg-hover focus:bg-hover"
        />
        <div className="flex items-center gap-1.5 font-mono text-[11px] text-ink-soft">
          <Chip label={t(S.stats.cards, { count: stats.total })} />
          {stats.due > 0 && (
            <Chip
              label={t(S.stats.due, { count: stats.due })}
              tone="due"
            />
          )}
          {stats.mature > 0 && (
            <Chip label={t(S.stats.mature, { count: stats.mature })} tone="mature" />
          )}
        </div>
      </div>

      {/* Actions */}
      <div className="flex flex-wrap items-center gap-2 px-4 py-3">
        <button
          onClick={startStudy}
          disabled={stats.due === 0}
          className="rounded-lg bg-lime px-4 py-2 text-sm font-semibold text-lime-on transition hover:bg-lime-deep disabled:cursor-not-allowed disabled:opacity-40"
        >
          {stats.due > 0 ? t(S.studyDue, { count: stats.due }) : S.allCaughtUp}
        </button>
        <button
          onClick={() => setEditing((v) => !v)}
          className="rounded-lg border border-line-strong bg-card px-4 py-2 text-sm font-semibold text-ink transition hover:bg-hover"
        >
          {editing ? S.doneEditing : S.editCards}
        </button>
      </div>

      {/* Card editor */}
      {editing && (
        <div className="space-y-2 border-t border-line px-4 py-3">
          {block.cards.length === 0 && (
            <p className="py-2 text-sm text-ink-soft">{S.emptyDeck}</p>
          )}
          {block.cards.map((card) => (
            <div
              key={card.id}
              className="flex items-start gap-2 rounded-lg border border-line bg-paper p-2"
            >
              <div className="grid flex-1 gap-1.5 sm:grid-cols-2">
                <textarea
                  value={card.front}
                  onChange={(e) =>
                    mutateBlock((b) => {
                      const c = b.cards.find((x) => x.id === card.id);
                      if (c) c.front = e.target.value;
                    })
                  }
                  placeholder={S.frontPlaceholder}
                  rows={2}
                  className="resize-y rounded border border-line bg-card px-2 py-1.5 text-sm text-ink outline-none focus:border-ink/30"
                />
                <textarea
                  value={card.back}
                  onChange={(e) =>
                    mutateBlock((b) => {
                      const c = b.cards.find((x) => x.id === card.id);
                      if (c) c.back = e.target.value;
                    })
                  }
                  placeholder={S.backPlaceholder}
                  rows={2}
                  className="resize-y rounded border border-line bg-card px-2 py-1.5 text-sm text-ink outline-none focus:border-ink/30"
                />
              </div>
              <button
                onClick={() =>
                  mutateBlock((b) => {
                    b.cards = b.cards.filter((x) => x.id !== card.id);
                  })
                }
                title={S.deleteCard}
                className="shrink-0 px-1.5 py-1 text-ink-soft/50 transition hover:text-rose-500"
              >
                ✕
              </button>
            </div>
          ))}
          <button
            onClick={addCard}
            className="rounded-lg border border-dashed border-line-strong px-3 py-2 text-sm text-ink-soft transition hover:border-ink/40 hover:text-ink"
          >
            {S.addCard}
          </button>
        </div>
      )}

      {studying && items.length > 0 && (
        <StudySession
          items={items}
          title={block.title || S.untitledDeck}
          onGrade={onGrade}
          onClose={() => setStudying(false)}
          onFirstReview={() => void recordStudyReviewAction()}
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
        ? "bg-emerald-400/10 text-emerald-600 ring-emerald-400/30"
        : "bg-hover text-ink-soft ring-line-strong";
  return (
    <span className={`rounded-full px-2 py-0.5 ring-1 ring-inset ${cls}`}>
      {label}
    </span>
  );
}
