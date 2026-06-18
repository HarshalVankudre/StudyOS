"use client";

import { useEffect, useState } from "react";
import { useI18n } from "@/lib/i18n/client";

/**
 * Calm activity indicator shown while the AI is working — during the initial
 * generation and when applying an "Ask AI" edit. A quiet spinner, a title, and
 * a status line that steps through the phases so the wait stays legible. The
 * real call is a single request; the phases just make the wait readable.
 */
export type AiStep = { icon?: string; label: string };

export function AiActivity({
  title,
  steps,
  fullscreen = false,
}: {
  title?: string;
  steps?: AiStep[];
  fullscreen?: boolean;
}) {
  const { dict } = useI18n();
  const resolvedTitle = title ?? dict.aiActivity.defaultTitle;
  const resolvedSteps =
    steps ?? dict.aiActivity.defaultSteps.map((label) => ({ label }));
  const [i, setI] = useState(0);

  // Advance through the phases, then hold on the last one until the call ends.
  useEffect(() => {
    const t = setInterval(
      () => setI((v) => Math.min(v + 1, resolvedSteps.length - 1)),
      1500,
    );
    return () => clearInterval(t);
  }, [resolvedSteps.length]);

  const current = resolvedSteps[i];

  return (
    <div
      className={`${fullscreen ? "fixed" : "absolute"} inset-0 z-20 flex items-center justify-center bg-paper/70 backdrop-blur-sm`}
      role="status"
      aria-live="polite"
      aria-label={`${resolvedTitle}: ${current.label}`}
    >
      <div className="w-[min(22rem,90vw)] rounded-xl border border-ink/10 bg-card p-7 shadow-[0_24px_60px_-28px_rgba(26,23,18,0.35)]">
        <div className="flex items-center gap-3">
          <span
            className="h-5 w-5 shrink-0 animate-spin rounded-full border-2 border-ink/15 border-t-ink"
            aria-hidden
          />
          <h3 className="font-display text-base font-bold text-ink">{resolvedTitle}</h3>
        </div>

        <p key={i} className="ai-fade mt-3 text-sm text-ink-soft">
          {current.label}…
        </p>

        <div className="mt-5 flex gap-1.5">
          {resolvedSteps.map((s, idx) => (
            <span
              key={s.label}
              className={`h-1 flex-1 rounded-full transition-all duration-500 ${
                idx <= i ? "bg-ink" : "bg-ink/10"
              }`}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
