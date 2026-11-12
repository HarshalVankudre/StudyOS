"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { useI18n } from "@/lib/i18n/client";
import { locateQuote } from "@/lib/materials/quote";
import type { MaterialPage } from "@/lib/materials/types";
import type { SourceRef } from "@/lib/workspace/types";
import { MaterialApiError, fetchMaterialPage } from "./api";

type Load =
  | { state: "loading" }
  | { state: "ready"; page: MaterialPage }
  | { state: "gone" }
  | { state: "error" };

/**
 * Where a card or question came from: the cited page of the student's own
 * material, with the quoted passage highlighted and scrolled into view. The
 * page text is fetched from the owner-only materials route; a deleted
 * material (or one whose workspace is in the trash) says so instead.
 */
export function MaterialSourceViewer({ source, onClose }: { source: SourceRef; onClose: () => void }) {
  const { dict, t } = useI18n();
  const M = dict.materials;
  const [pageNumber, setPageNumber] = useState(source.page ?? 1);
  const [tick, setTick] = useState(0);
  const markRef = useRef<HTMLElement>(null);
  // The last answer and which request it answers; anything else is "loading".
  const requestKey = `${source.materialId}:${pageNumber}:${tick}`;
  const [answer, setAnswer] = useState<{ key: string; load: Load } | null>(null);
  const load: Load = useMemo(
    () => (answer?.key === requestKey ? answer.load : { state: "loading" }),
    [answer, requestKey],
  );

  useEffect(() => {
    if (!source.materialId) return;
    const controller = new AbortController();
    const key = `${source.materialId}:${pageNumber}:${tick}`;
    fetchMaterialPage(source.materialId, pageNumber, controller.signal)
      .then((page) => setAnswer({ key, load: { state: "ready", page } }))
      .catch((cause) => {
        if (controller.signal.aborted) return;
        setAnswer({
          key,
          load:
            cause instanceof MaterialApiError && cause.code === "not_found" ? { state: "gone" } : { state: "error" },
        });
      });
    return () => controller.abort();
  }, [source.materialId, pageNumber, tick]);

  const onCitedPage = pageNumber === source.page;
  const match = useMemo(
    () =>
      load.state === "ready" && onCitedPage && source.quote ? locateQuote(load.page.text, source.quote) : null,
    [load, onCitedPage, source.quote],
  );

  useEffect(() => {
    markRef.current?.scrollIntoView?.({ block: "center" });
  }, [match]);

  const title = load.state === "ready" ? load.page.title : (source.label ?? M.viewerFallbackTitle);
  const pageCount = load.state === "ready" ? load.page.pageCount : undefined;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        // Keys typed here must not reach a study session underneath (Space flips, 1-4 grade).
        onKeyDown={(e) => {
          if (e.key !== "Escape" && e.key !== "Tab") e.stopPropagation();
        }}
        className="flex max-h-[88dvh] flex-col gap-3 overflow-hidden p-4 sm:max-w-2xl sm:p-6"
      >
        <DialogTitle className="pe-8 font-display text-base font-bold text-ink" dir="auto">
          {title}
        </DialogTitle>
        <DialogDescription className="-mt-2 text-xs text-ink-soft">
          {pageCount !== undefined ? t(M.viewerPage, { page: pageNumber, count: pageCount }) : t(M.viewerPageOnly, { page: pageNumber })}
        </DialogDescription>

        {source.quote && (
          <figure className="rounded-lg border-s-4 border-lime bg-lime-faint px-3 py-2">
            <figcaption className="text-[11px] font-semibold text-ink-soft">{M.viewerQuote}</figcaption>
            <blockquote className="text-sm text-ink" dir="auto">
              “{source.quote}”
            </blockquote>
          </figure>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain rounded-lg border border-line bg-card px-3 py-3">
          {!source.materialId ? (
            <p className="text-sm text-ink-soft">{M.viewerNoMaterial}</p>
          ) : load.state === "loading" ? (
            <p className="flex items-center gap-2 text-sm text-ink-soft">
              <Loader2 className="size-4 animate-spin" aria-hidden />
              {M.viewerLoading}
            </p>
          ) : load.state === "gone" ? (
            <p className="text-sm text-ink-soft">{M.viewerGone}</p>
          ) : load.state === "error" ? (
            <div role="alert" className="flex flex-col items-start gap-2 text-sm text-ink">
              <p>{M.errors.network}</p>
              <button
                type="button"
                onClick={() => setTick((n) => n + 1)}
                className="min-h-11 rounded-lg border border-line-strong bg-card px-3 text-sm font-semibold transition hover:bg-hover"
              >
                {M.retry}
              </button>
            </div>
          ) : load.page.text.trim() === "" ? (
            <p className="text-sm text-ink-soft">{M.viewerEmptyPage}</p>
          ) : (
            <>
              {onCitedPage && source.quote && !match && (
                <p className="mb-2 text-xs text-amber-700 dark:text-amber-400">{M.viewerNoMatch}</p>
              )}
              <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-ink" dir="auto">
                {match ? (
                  <>
                    {load.page.text.slice(0, match.start)}
                    <mark
                      ref={markRef}
                      className="rounded-sm bg-lime/40 px-0.5 text-ink ring-1 ring-lime dark:bg-lime/30"
                    >
                      {load.page.text.slice(match.start, match.end)}
                    </mark>
                    {load.page.text.slice(match.end)}
                  </>
                ) : (
                  load.page.text
                )}
              </p>
            </>
          )}
        </div>

        {source.materialId && pageCount !== undefined && pageCount > 1 && (
          <div className="flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => setPageNumber((n) => Math.max(1, n - 1))}
              disabled={pageNumber <= 1}
              aria-label={M.viewerPrev}
              className="flex min-h-11 items-center gap-1 rounded-lg border border-line-strong bg-card px-3 text-sm font-semibold text-ink transition hover:bg-hover disabled:opacity-40"
            >
              <ChevronLeft className="size-4 rtl:-scale-x-100" aria-hidden />
              <span className="hidden sm:inline">{M.viewerPrev}</span>
            </button>
            {!onCitedPage && source.page !== undefined && (
              <button
                type="button"
                onClick={() => setPageNumber(source.page ?? 1)}
                className="min-h-11 rounded-lg px-3 text-sm font-semibold text-ink underline underline-offset-2"
              >
                {t(M.viewerBack, { page: source.page })}
              </button>
            )}
            <button
              type="button"
              onClick={() => setPageNumber((n) => Math.min(pageCount, n + 1))}
              disabled={pageNumber >= pageCount}
              aria-label={M.viewerNext}
              className="flex min-h-11 items-center gap-1 rounded-lg border border-line-strong bg-card px-3 text-sm font-semibold text-ink transition hover:bg-hover disabled:opacity-40"
            >
              <span className="hidden sm:inline">{M.viewerNext}</span>
              <ChevronRight className="size-4 rtl:-scale-x-100" aria-hidden />
            </button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
