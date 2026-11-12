"use client";

import { HeartHandshake } from "lucide-react";
import { useI18n } from "@/lib/i18n/client";
import type { CatchUpPlan } from "@/lib/study/backlog";

/**
 * The welcome-back offer shown instead of a wall of overdue cards: keep a
 * doable number for today, spread the rest out. Nothing is changed until the
 * student taps "Spread them out" (and that change is undoable like any edit).
 */
export function CatchUpBanner({
  plan,
  dueCount,
  onSpread,
  onStudyAll,
}: {
  plan: CatchUpPlan;
  dueCount: number;
  onSpread: () => void;
  onStudyAll?: () => void;
}) {
  const { dict, t } = useI18n();
  const T = dict.studyTools;
  return (
    <section
      aria-label={T.welcomeTitle}
      className="flex flex-col gap-3 rounded-xl border border-lime/40 bg-lime-faint p-3 text-start sm:p-4"
    >
      <div className="flex items-start gap-3">
        <HeartHandshake className="mt-0.5 size-5 shrink-0 text-lime-deep" aria-hidden />
        <div className="space-y-1">
          <p className="font-display text-sm font-bold text-ink">{T.welcomeTitle}</p>
          <p className="text-sm text-ink-soft">
            {t(T.welcomeBody, { count: dueCount, load: plan.today, days: plan.days })}
          </p>
          <p className="text-xs text-ink-soft">{T.welcomeKeep}</p>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <button
          onClick={onSpread}
          className="min-h-11 rounded-lg bg-lime px-4 text-sm font-semibold text-lime-on transition hover:bg-lime-deep"
        >
          {T.spreadOut}
        </button>
        {onStudyAll && (
          <button
            onClick={onStudyAll}
            className="min-h-11 rounded-lg border border-line-strong bg-card px-4 text-sm font-semibold text-ink transition hover:bg-hover"
          >
            {t(T.studyAllAnyway, { count: dueCount })}
          </button>
        )}
      </div>
    </section>
  );
}
