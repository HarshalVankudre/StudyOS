"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Eye, Pencil, Plus, Trash2 } from "lucide-react";
import { useI18n } from "@/lib/i18n/client";
import type { Flashcard, FlashcardsBlock } from "@/lib/workspace/types";
import { MAX_FLASHCARDS, MAX_FLASHCARD_TEXT } from "@/lib/workspace/schema";
import { isStudyable } from "@/lib/study/srs";
import { CardContent } from "./CardContent";

/**
 * Comfortable card editing, phone first: each card is a stacked pair of
 * auto-growing text areas (side by side on wider screens), with large buttons
 * to move it up or down and to delete it. Deleting goes through the workspace
 * update path, so the editor's Undo covers it. A preview switch renders the
 * Markdown and math the way a study session shows them.
 */
export function CardEditor({
  cards,
  mutate,
}: {
  cards: Flashcard[];
  mutate: (fn: (b: FlashcardsBlock) => void) => void;
}) {
  const { dict, t } = useI18n();
  const S = dict.study;
  const T = dict.studyTools;
  const [previewing, setPreviewing] = useState(false);
  const [focusId, setFocusId] = useState<string | null>(null);
  const fronts = useRef(new Map<string, HTMLTextAreaElement>());

  useEffect(() => {
    if (!focusId) return;
    const el = fronts.current.get(focusId);
    if (el) {
      el.focus();
      el.scrollIntoView?.({ block: "nearest" });
      setFocusId(null);
    }
  }, [focusId, cards]);

  const atLimit = cards.length >= MAX_FLASHCARDS;
  const unfinished = cards.filter((c) => !isStudyable(c)).length;

  const addCard = () => {
    if (atLimit) return;
    const id = crypto.randomUUID();
    mutate((b) => {
      if (b.cards.length >= MAX_FLASHCARDS) return;
      b.cards.push({ id, front: "", back: "" });
    });
    setPreviewing(false);
    setFocusId(id);
  };

  const setSide = (id: string, side: "front" | "back", value: string) =>
    mutate((b) => {
      const c = b.cards.find((x) => x.id === id);
      if (c) c[side] = value;
    });

  const move = (id: string, delta: -1 | 1) =>
    mutate((b) => {
      const i = b.cards.findIndex((x) => x.id === id);
      const j = i + delta;
      if (i < 0 || j < 0 || j >= b.cards.length) return;
      [b.cards[i], b.cards[j]] = [b.cards[j], b.cards[i]];
    });

  const remove = (id: string) =>
    mutate((b) => {
      b.cards = b.cards.filter((x) => x.id !== id);
    });

  return (
    <div className="space-y-3 border-t border-line px-3 py-3 sm:px-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-ink-soft">{T.markdownHint}</p>
        {cards.length > 0 && (
          <button
            onClick={() => setPreviewing((v) => !v)}
            aria-pressed={previewing}
            className="flex min-h-11 items-center gap-1.5 rounded-lg px-3 text-xs font-semibold text-ink-soft transition hover:bg-hover hover:text-ink"
          >
            {previewing ? <Pencil className="size-4" aria-hidden /> : <Eye className="size-4" aria-hidden />}
            {previewing ? T.edit : T.preview}
          </button>
        )}
      </div>

      {cards.length === 0 && <p className="py-2 text-sm text-ink-soft">{S.emptyDeck}</p>}

      <ol className="space-y-3">
        {cards.map((card, index) => {
          const label = t(T.cardNumber, { n: index + 1 });
          return (
            <li
              key={card.id}
              aria-label={label}
              className="rounded-xl border border-line bg-paper p-2.5 sm:p-3"
            >
              <div className="mb-2 flex items-center gap-1">
                <span className="me-auto font-mono text-[11px] font-semibold text-ink-soft">{label}</span>
                <IconButton
                  label={`${T.moveUp} (${label})`}
                  onClick={() => move(card.id, -1)}
                  disabled={index === 0}
                >
                  <ArrowUp className="size-4" aria-hidden />
                </IconButton>
                <IconButton
                  label={`${T.moveDown} (${label})`}
                  onClick={() => move(card.id, 1)}
                  disabled={index === cards.length - 1}
                >
                  <ArrowDown className="size-4" aria-hidden />
                </IconButton>
                <IconButton
                  label={`${S.deleteCard} (${label})`}
                  onClick={() => remove(card.id)}
                  danger
                >
                  <Trash2 className="size-4" aria-hidden />
                </IconButton>
              </div>
              {previewing ? (
                <div className="grid gap-2 sm:grid-cols-2">
                  <PreviewSide label={T.frontLabel} text={card.front} empty={T.emptySide} />
                  <PreviewSide label={T.backLabel} text={card.back} empty={T.emptySide} />
                </div>
              ) : (
                <div className="grid gap-2 sm:grid-cols-2">
                  <SideInput
                    ref={(el) => {
                      if (el) fronts.current.set(card.id, el);
                      else fronts.current.delete(card.id);
                    }}
                    value={card.front}
                    label={`${T.frontLabel} (${label})`}
                    placeholder={S.frontPlaceholder}
                    onChange={(v) => setSide(card.id, "front", v)}
                  />
                  <SideInput
                    value={card.back}
                    label={`${T.backLabel} (${label})`}
                    placeholder={S.backPlaceholder}
                    onChange={(v) => setSide(card.id, "back", v)}
                  />
                </div>
              )}
            </li>
          );
        })}
      </ol>

      {unfinished > 0 && (
        <p className="text-xs text-amber-700 dark:text-amber-400">{t(T.blankSkipped, { count: unfinished })}</p>
      )}
      {atLimit ? (
        <p className="text-xs text-ink-soft">{t(T.deckFull, { max: MAX_FLASHCARDS })}</p>
      ) : (
        <button
          onClick={addCard}
          className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl border border-dashed border-line-strong px-3 text-sm font-semibold text-ink-soft transition hover:border-ink/40 hover:text-ink"
        >
          <Plus className="size-4" aria-hidden />
          {T.addCard}
        </button>
      )}
    </div>
  );
}

function SideInput({
  ref,
  value,
  label,
  placeholder,
  onChange,
}: {
  ref?: React.Ref<HTMLTextAreaElement>;
  value: string;
  label: string;
  placeholder: string;
  onChange: (value: string) => void;
}) {
  const lines = value.split("\n").length;
  return (
    <textarea
      ref={ref}
      value={value}
      aria-label={label}
      placeholder={placeholder}
      maxLength={MAX_FLASHCARD_TEXT}
      rows={Math.min(10, Math.max(2, lines))}
      onChange={(e) => onChange(e.target.value)}
      className="min-h-16 w-full resize-y rounded-lg border border-line bg-card px-3 py-2 text-base text-ink outline-none [field-sizing:content] placeholder:text-ink-soft/50 focus:border-ink/30 sm:text-sm"
    />
  );
}

function PreviewSide({ label, text, empty }: { label: string; text: string; empty: string }) {
  return (
    <div className="min-h-16 rounded-lg border border-line bg-card px-3 py-2">
      <p className="mb-1 text-[11px] font-semibold text-ink-soft">{label}</p>
      {text.trim() ? (
        <CardContent text={text} className="text-sm text-ink" />
      ) : (
        <p className="text-sm italic text-ink-soft/60">{empty}</p>
      )}
    </div>
  );
}

function IconButton({
  label,
  onClick,
  disabled,
  danger,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className={`grid h-11 w-11 place-items-center rounded-lg text-ink-soft transition hover:bg-hover disabled:cursor-not-allowed disabled:opacity-30 ${
        danger ? "hover:text-rose-600" : "hover:text-ink"
      }`}
    >
      {children}
    </button>
  );
}
