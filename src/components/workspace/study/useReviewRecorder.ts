"use client";

import { useCallback, useEffect, useRef } from "react";
import { recordReviewsAction } from "@/app/app/study-actions";
import { isoDay } from "@/lib/study/days";
import { ReviewBuffer, type StudyEvent } from "@/lib/study/recorder";

/** Fired on `window` after answers reach the server (the streak can refresh). */
export const STUDIED_EVENT = "studyos:studied";
const FLUSH_DELAY_MS = 4_000;

/**
 * Records answered cards into the per-day study record. The first answer is
 * sent at once (so the streak lights up), later ones in batches; anything
 * pending is sent when the session closes or the tab is hidden.
 */
export function useReviewRecorder(workspaceId: string): (event: StudyEvent) => void {
  const buffer = useRef<ReviewBuffer | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sentOnce = useRef(false);

  const flush = useCallback(async () => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    const batches = buffer.current?.drain() ?? [];
    if (batches.length === 0) return;
    try {
      await recordReviewsAction(batches);
      window.dispatchEvent(new CustomEvent(STUDIED_EVENT));
    } catch {
      buffer.current?.restore(batches); // offline: try again with the next batch
    }
  }, []);

  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === "hidden") void flush();
    };
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", onHide);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", onHide);
      void flush();
    };
  }, [flush]);

  return useCallback(
    (event: StudyEvent) => {
      buffer.current ??= new ReviewBuffer();
      buffer.current.add(workspaceId, isoDay(new Date()), event);
      if (!sentOnce.current) {
        sentOnce.current = true;
        void flush();
      } else if (!timer.current) {
        timer.current = setTimeout(() => void flush(), FLUSH_DELAY_MS);
      }
    },
    [workspaceId, flush],
  );
}
