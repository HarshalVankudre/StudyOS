"use client";

import { useState } from "react";
import { FileText } from "lucide-react";
import { MaterialSourceViewer } from "../materials/MaterialSourceViewer";
import { useI18n } from "@/lib/i18n/client";
import { cn } from "@/lib/utils";
import type { SourceRef } from "@/lib/workspace/types";

/** The short text a source chip shows, or null when the source says nothing. */
export function sourceChipText(
  source: SourceRef | undefined,
  pageLabel: (page: number) => string,
): string | null {
  if (!source) return null;
  if (typeof source.page === "number" && source.page > 0) return pageLabel(source.page);
  const label = source.label?.trim();
  if (label) return label;
  const quote = source.quote?.trim();
  if (quote) return quote.length > 40 ? `“${quote.slice(0, 39)}…”` : `“${quote}”`;
  return null;
}

/**
 * A compact "p. 4"-style chip naming where a card or question came from in
 * the student's own material. Renders nothing when the source is empty.
 * When there is something to show (a stored material, or at least a quote),
 * tapping it opens the source viewer: the cited page with the quoted passage
 * highlighted.
 */
export function SourceChip({ source, className }: { source: SourceRef; className?: string }) {
  const { dict, t } = useI18n();
  const Q = dict.quiz;
  const [viewing, setViewing] = useState(false);
  const text = sourceChipText(source, (page) => t(Q.sourcePage, { page }));
  if (!text) return null;
  const full = [source.label?.trim(), text !== source.label?.trim() ? text : null, source.quote?.trim()]
    .filter(Boolean)
    .join(" · ");
  if (source.materialId || source.quote?.trim()) {
    return (
      <>
        <button
          type="button"
          data-testid="source-chip"
          title={full}
          aria-label={t(dict.materials.sourceOpen, { source: full })}
          aria-haspopup="dialog"
          onClick={(e) => {
            // Inside a study card, a tap on the chip must not also flip or grade it.
            e.stopPropagation();
            setViewing(true);
          }}
          className={cn(
            // The ::after extends the touch target well past the small chip.
            "relative inline-flex max-w-full items-center gap-1 rounded-full border border-line bg-card px-2 py-0.5 text-[11px] font-medium text-ink-soft transition after:absolute after:-inset-x-1 after:-inset-y-3 after:content-[''] hover:border-line-strong hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/30",
            className,
          )}
        >
          <FileText className="size-3 shrink-0" aria-hidden />
          <span className="truncate">{text}</span>
        </button>
        {viewing && <MaterialSourceViewer source={source} onClose={() => setViewing(false)} />}
      </>
    );
  }
  return (
    <span
      data-testid="source-chip"
      title={full}
      aria-label={t(Q.sourceAria, { source: full })}
      className={cn(
        "inline-flex max-w-full items-center gap-1 rounded-full border border-line bg-card px-2 py-0.5 text-[11px] font-medium text-ink-soft",
        className,
      )}
    >
      <FileText className="size-3 shrink-0" aria-hidden />
      <span className="truncate">{text}</span>
    </span>
  );
}
