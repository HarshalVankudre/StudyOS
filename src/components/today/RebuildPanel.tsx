"use client";

import { useId, useState, useTransition } from "react";
import { ChevronDown, RotateCcw } from "lucide-react";
import { fmt } from "@/lib/i18n/interpolate";
import { TODAY_MINUTES_OPTIONS } from "@/lib/agents/daily-study/types";
import { formatDuration, type TodayCopy } from "@/lib/agents/daily-study/present";
import { cn } from "@/lib/utils";

/**
 * "Rebuild from today": one tap to re-plan the rest of the day around the
 * time the student actually has. What is done stays done.
 */
export function RebuildPanel({
  T,
  dailyMinutes,
  onRebuild,
}: {
  T: TodayCopy;
  dailyMinutes: number;
  onRebuild: (minutes?: number) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [minutes, setMinutes] = useState<number | undefined>(undefined);
  const [pending, startTransition] = useTransition();
  const panelId = useId();
  const questionId = useId();

  const choices: { value: number | undefined; label: string }[] = [
    ...TODAY_MINUTES_OPTIONS.filter((m) => m !== dailyMinutes).map((m) => ({
      value: m as number | undefined,
      label: formatDuration(m, T),
    })),
    { value: undefined, label: fmt(T.usualTime, { time: formatDuration(dailyMinutes, T) }) },
  ];

  return (
    <div>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex min-h-11 items-center gap-2 rounded-md text-sm font-semibold text-ink transition hover:text-lime-deep"
      >
        <RotateCcw className="h-4 w-4 rtl:-scale-x-100" aria-hidden />
        {T.rebuildTitle}
        <ChevronDown className={cn("h-4 w-4 transition", open && "rotate-180")} aria-hidden />
      </button>
      {open && (
        <div id={panelId} className="pb-2">
          <p className="text-sm leading-6 text-ink-soft">{T.rebuildBody}</p>
          <p id={questionId} className="mt-3 text-sm font-semibold text-ink">
            {T.rebuildQuestion}
          </p>
          <div role="radiogroup" aria-labelledby={questionId} className="mt-2 flex flex-wrap gap-2">
            {choices.map((choice) => {
              const selected = choice.value === minutes;
              return (
                <button
                  key={choice.label}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => setMinutes(choice.value)}
                  className={cn(
                    "min-h-10 rounded-full border px-3.5 text-sm transition",
                    selected
                      ? "border-lime bg-lime-faint font-semibold text-ink"
                      : "border-line-strong bg-surface text-ink-soft hover:bg-hover hover:text-ink",
                  )}
                >
                  {choice.label}
                </button>
              );
            })}
          </div>
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                await onRebuild(minutes);
                setOpen(false);
              })
            }
            className="mt-3 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-md bg-ink px-5 text-sm font-semibold text-paper shadow-card transition hover:opacity-90 disabled:opacity-60 sm:w-auto"
          >
            {pending && (
              <span
                className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-r-transparent"
                aria-hidden
              />
            )}
            {pending ? T.rebuilding : T.rebuild}
          </button>
        </div>
      )}
    </div>
  );
}
