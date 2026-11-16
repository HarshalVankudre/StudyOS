"use client";

import { useState } from "react";
import { ChevronLeft, ChevronRight, RotateCcw, Shuffle } from "lucide-react";
import { useI18n } from "@/lib/i18n/client";
import type { PublicCard } from "@/lib/share/public-view";
import { cn } from "@/lib/utils";
import { ShareRichText } from "./ShareRichText";

/** A new order for `count` cards (Fisher-Yates), never the same order twice in a row when it can differ. */
export function shuffledOrder(count: number, previous: readonly number[], random: () => number = Math.random): number[] {
  const order = Array.from({ length: count }, (_, i) => i);
  for (let attempt = 0; attempt < 5; attempt += 1) {
    for (let i = order.length - 1; i > 0; i -= 1) {
      const j = Math.floor(random() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
    if (count < 2 || order.some((value, i) => value !== previous[i])) break;
  }
  return order;
}

/**
 * A flashcard deck on a shared page, for practice only: flip a card, go
 * back and forth, shuffle. Everything lives in this component's state;
 * nothing is scheduled, counted or sent anywhere. A card's rich content is
 * never inside a button (it may hold links): "Show answer" is a button of
 * its own.
 */
export function PublicFlashcards({ title, cards, token }: { title?: string; cards: PublicCard[]; token: string }) {
  const { dict, t, plural } = useI18n();
  const S = dict.share;
  const [order, setOrder] = useState(() => cards.map((_, i) => i));
  const [at, setAt] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const card = cards[order[at] ?? 0];
  if (!card) return null;

  const go = (next: number) => {
    setAt(Math.min(cards.length - 1, Math.max(0, next)));
    setFlipped(false);
  };

  return (
    <section className="my-5 rounded-3xl border border-line bg-cloud/60 p-4 sm:p-6" aria-label={title || dict.study.untitledDeck}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h3 dir="auto" className="font-display text-lg font-bold text-ink">
          {title || dict.study.untitledDeck}
        </h3>
        <p className="text-xs text-ink-soft">{plural(dict.counts.cards, cards.length)}</p>
      </div>

      {/* The card's Markdown (links included) sits in a plain region; flipping is its own button. */}
      <div
        role="group"
        aria-label={`${t(S.cardOf, { n: at + 1, total: cards.length })}. ${flipped ? S.back : S.front}`}
        className="mt-4 flex min-h-48 w-full flex-col rounded-2xl border border-line bg-card p-5 sm:min-h-56 sm:p-7"
      >
        <span className={cn("text-xs font-semibold", flipped ? "text-lime-deep" : "text-ink-soft")}>
          {flipped ? S.back : S.front}
        </span>
        <div className="flex w-full flex-1 items-center justify-center py-4 text-center" aria-live="polite">
          <div className="w-full min-w-0 break-words text-lg leading-relaxed text-ink [&_li]:whitespace-pre-line [&_p]:whitespace-pre-line">
            <ShareRichText key={flipped ? "back" : "front"} text={flipped ? card.back : card.front} token={token} />
          </div>
        </div>
        <div className="flex justify-center">
          <button
            type="button"
            onClick={() => setFlipped((f) => !f)}
            className="inline-flex min-h-11 items-center gap-1.5 rounded-full bg-ink px-5 text-sm font-semibold text-paper transition hover:bg-ink/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/30 focus-visible:ring-offset-2"
          >
            <RotateCcw className="h-4 w-4" aria-hidden />
            {flipped ? S.showQuestion : S.showAnswer}
          </button>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => go(at - 1)}
            disabled={at === 0}
            className="inline-flex min-h-11 items-center gap-1 rounded-full border border-line-strong bg-card px-4 text-sm font-semibold text-ink transition hover:bg-hover disabled:opacity-40"
          >
            <ChevronLeft className="h-4 w-4 rtl:-scale-x-100" aria-hidden />
            {S.previous}
          </button>
          <button
            type="button"
            onClick={() => go(at + 1)}
            disabled={at >= cards.length - 1}
            className="inline-flex min-h-11 items-center gap-1 rounded-full border border-line-strong bg-card px-4 text-sm font-semibold text-ink transition hover:bg-hover disabled:opacity-40"
          >
            {S.next}
            <ChevronRight className="h-4 w-4 rtl:-scale-x-100" aria-hidden />
          </button>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs tabular-nums text-ink-soft" aria-live="polite">
            {t(S.cardOf, { n: at + 1, total: cards.length })}
          </span>
          {cards.length > 1 && (
            <button
              type="button"
              onClick={() => {
                setOrder((previous) => shuffledOrder(cards.length, previous));
                setAt(0);
                setFlipped(false);
              }}
              className="inline-flex min-h-11 items-center gap-1.5 rounded-full px-3 text-sm font-semibold text-ink-soft transition hover:bg-hover hover:text-ink"
            >
              <Shuffle className="h-4 w-4" aria-hidden />
              {S.shuffle}
            </button>
          )}
        </div>
      </div>
      <p className="mt-3 text-xs text-ink-faint">{S.practiceNote}</p>
    </section>
  );
}
