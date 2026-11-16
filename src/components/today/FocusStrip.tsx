"use client";

import Link from "next/link";
import { Timer } from "lucide-react";
import { useFocusLauncher } from "@/components/focus/launcher";
import { formatDuration } from "@/lib/agents/daily-study/present";
import { useI18n } from "@/lib/i18n/client";
import { fmt } from "@/lib/i18n/interpolate";
import type { FocusSummary } from "@/lib/study/focus";
import { cn } from "@/lib/utils";

/** The bar a day reaches at this many minutes (or the week's busiest day, if more). */
const FULL_BAR_MINUTES = 50;

function weekday(day: string, locale: string): string {
  try {
    return new Intl.DateTimeFormat(locale, { weekday: "short", timeZone: "UTC" }).format(new Date(`${day}T12:00:00Z`));
  } catch {
    return day;
  }
}

/**
 * Focus time on the Today view: minutes focused today, the streak of days
 * with focus time, a tiny bar per day for the last week, and the button that
 * starts a session. Without a timer (outside the signed-in app) it shows the
 * numbers only.
 */
export function FocusStrip({
  summary,
  quiet = false,
  className,
}: {
  summary: FocusSummary | null;
  /** An outlined start button, for when the view already has a lime primary action. */
  quiet?: boolean;
  className?: string;
}) {
  const { dict, locale, plural } = useI18n();
  const F = dict.focus;
  const T = dict.today;
  const launcher = useFocusLauncher();
  if (!summary && !launcher) return null;

  const todayMinutes = summary?.todayMinutes ?? 0;
  const week = summary?.week ?? [];
  const full = Math.max(FULL_BAR_MINUTES, ...week.map((d) => d.minutes));
  const bars =
    week.length > 0 ? (
      <ul aria-label={F.weekLabel} className="flex h-10 shrink-0 items-end gap-1">
        {week.map((day) => {
          const isToday = day.date === summary?.today;
          const text = fmt(F.dayBar, { day: weekday(day.date, locale), time: formatDuration(day.minutes, T) });
          return (
            <li
              key={day.date}
              title={text}
              className={cn(
                "flex h-full w-2.5 flex-col justify-end overflow-hidden rounded-full bg-card",
                isToday && "ring-1 ring-lime-deep/40",
              )}
            >
              {day.minutes > 0 && (
                <span
                  aria-hidden
                  className="block w-full rounded-full bg-lime"
                  style={{ height: `${Math.max(14, Math.round((day.minutes / full) * 100))}%` }}
                />
              )}
              <span className="sr-only">{text}</span>
            </li>
          );
        })}
      </ul>
    ) : null;

  return (
    <div className={cn("flex flex-wrap items-center gap-x-4 gap-y-3 rounded-2xl bg-cloud px-4 py-3", className)}>
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-card text-ink">
          <Timer className="h-4 w-4" aria-hidden />
        </span>
        <div className="min-w-0">
          <p className="text-[15px] font-semibold leading-6 text-ink">
            {todayMinutes > 0 ? fmt(F.todayTime, { time: formatDuration(todayMinutes, T) }) : F.todayNone}
          </p>
          {summary && summary.streak >= 2 && (
            <p className="text-xs leading-5 text-ink-soft">{plural(F.streak, summary.streak)}</p>
          )}
        </div>
      </div>
      {bars && summary && launcher ? (
        // In the signed-in app the week opens the insights page.
        <Link
          href="/app/insights"
          aria-label={fmt(dict.insights.weekLink, { time: formatDuration(summary.weekMinutes, T) })}
          className="-m-1 shrink-0 rounded-xl p-1 transition hover:bg-card/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lime-deep/60"
        >
          {bars}
        </Link>
      ) : (
        bars
      )}
      {launcher && (
        <button
          type="button"
          onClick={() => launcher.open()}
          className={cn(
            "inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-full px-4 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lime-deep/60 sm:w-auto",
            quiet ? "border border-line-strong bg-card text-ink hover:bg-hover" : "bg-lime text-lime-on hover:bg-lime-hover",
          )}
        >
          <Timer className="h-4 w-4" aria-hidden />
          {F.start}
        </button>
      )}
    </div>
  );
}
