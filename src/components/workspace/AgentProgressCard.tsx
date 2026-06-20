"use client";

import { useEffect, useMemo, useState } from "react";
import { useI18n } from "@/lib/i18n/client";
import {
  PHASE_ORDER,
  advanceAnimatedProgress,
  type AgentActivityState,
} from "@/lib/ai/progress";

export function AgentProgressCard({
  activity,
  onCancel,
}: {
  activity: AgentActivityState;
  onCancel: () => void;
}) {
  const { dict } = useI18n();
  const [animatedProgress, setAnimatedProgress] = useState(activity.progress);

  useEffect(() => {
    const timer = setInterval(() => {
      setAnimatedProgress((current) =>
        advanceAnimatedProgress(
          current,
          activity.progress,
          activity.phase,
        ),
      );
    }, 450);
    return () => clearInterval(timer);
  }, [activity.phase, activity.progress]);

  const activeIndex = PHASE_ORDER.indexOf(activity.phase);
  // Show whichever is higher: the smoothly-animated value or the latest
  // confirmed progress, so a real jump appears immediately without waiting for
  // the next animation tick. Deriving it (rather than syncing in an effect)
  // keeps the bar monotonic and avoids a cascading setState-in-effect.
  const percent = Math.round(Math.max(animatedProgress, activity.progress));
  const milestones = useMemo(
    () =>
      PHASE_ORDER.map((phase, index) => ({
        phase,
        label: dict.agentChat.phase[phase],
        state:
          index < activeIndex
            ? "complete"
            : index === activeIndex
              ? "active"
              : "next",
      })),
    [activeIndex, dict.agentChat.phase],
  );

  return (
    <div
      className="ai-pop overflow-hidden rounded-xl border border-line-strong bg-card shadow-[0_16px_40px_-28px_rgba(26,23,18,0.55)]"
      role="status"
      aria-live="polite"
    >
      <div className="relative overflow-hidden border-b border-line bg-ink px-4 py-4 text-paper">
        <div className="paper-grid pointer-events-none absolute inset-0 opacity-[0.07]" />
        <div className="relative flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <span className="ai-orb grid h-7 w-7 place-items-center rounded-full bg-lime text-xs text-ink">
                ✦
              </span>
              <span className="font-display text-sm font-bold">
                {dict.agentChat.buildingUpdate}
              </span>
            </div>
            <p className="mt-2 text-xs text-paper/65">{activity.message}</p>
          </div>
          <button
            onClick={onCancel}
            className="font-mono text-[9px] uppercase tracking-wider text-paper/50 transition hover:text-paper"
          >
            {dict.common.cancel}
          </button>
        </div>

        <div className="relative mt-4 flex items-center gap-3">
          <div
            className="h-1.5 flex-1 overflow-hidden rounded-full bg-paper/15"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percent}
          >
            <div
              className="h-full rounded-full bg-lime transition-[width] duration-500 ease-out"
              style={{ width: `${percent}%` }}
            />
          </div>
          <span className="font-mono text-[10px] font-semibold text-lime">
            {percent}%
          </span>
        </div>
      </div>

      <div className="space-y-3 p-3">
        {activity.plan && (
          <p className="px-3 pt-2 text-xs font-medium text-ink">{activity.plan.summary}</p>
        )}
        {(activity.areas ?? []).length > 0 && (
          <div className="flex flex-wrap gap-1.5 px-3 pt-1">
            {(activity.areas ?? []).map((area) => (
              <span key={area.id} className="rounded-full bg-hover px-2 py-0.5 text-[10px] text-ink-soft">
                {dict.agentChat.areaStatus[area.status]} · {area.label}
              </span>
            ))}
          </div>
        )}
        {activity.discoveries.map((discovery) => (
          <div
            key={discovery.id}
            className="flex gap-2.5 rounded-lg bg-hover/70 p-2.5"
          >
            <span className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-lime/35 text-xs">
              ✓
            </span>
            <div>
              <p className="text-xs font-semibold text-ink">
                {discovery.title}
              </p>
              {discovery.detail && (
                <p className="mt-0.5 text-[11px] leading-relaxed text-ink-soft">
                  {discovery.detail}
                </p>
              )}
            </div>
          </div>
        ))}

        <div className="space-y-1.5">
          {milestones.map((milestone) => (
            <div
              key={milestone.phase}
              className={`flex items-center gap-2 text-xs ${
                milestone.state === "active"
                  ? "font-semibold text-ink"
                  : "text-ink-soft"
              }`}
            >
              <span
                className={`grid h-5 w-5 place-items-center rounded-full text-[10px] ${
                  milestone.state === "complete"
                    ? "bg-lime text-ink"
                    : milestone.state === "active"
                      ? "bg-ink text-paper"
                      : "bg-hover"
                }`}
              >
                {milestone.state === "complete"
                  ? "✓"
                  : milestone.state === "active"
                    ? "✦"
                    : "·"}
              </span>
              {milestone.label}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
