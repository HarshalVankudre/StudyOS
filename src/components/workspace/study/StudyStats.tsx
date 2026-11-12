"use client";

import { useEffect, useMemo, useState } from "react";
import { Flame, Snowflake } from "lucide-react";
import { useI18n } from "@/lib/i18n/client";
import type { Flashcard } from "@/lib/workspace/types";
import { getStudyDashboardAction, type StudyDashboard } from "@/app/app/study-actions";
import { isoDay, startOfLocalDay } from "@/lib/study/days";
import { dueForecast } from "@/lib/study/stats";
import { FREEZE_EVERY, type StreakStatus } from "@/lib/study/streak";
import { STUDIED_EVENT } from "./useReviewRecorder";

type Scope = "workspace" | "all";

/**
 * Statistics for this workspace or every workspace: reviews per day (4 weeks),
 * reviews due over the next 2 weeks, retention and the streak.
 */
export function StudyStats({ workspaceId, cards }: { workspaceId: string; cards: Flashcard[] }) {
  const { dict, t, locale, plural } = useI18n();
  const T = dict.studyTools;
  const [scope, setScope] = useState<Scope>("workspace");
  const [data, setData] = useState<{ scope: Scope; value: StudyDashboard | null } | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let active = true;
    getStudyDashboardAction({
      offsetMinutes: new Date().getTimezoneOffset(),
      workspaceId: scope === "workspace" ? workspaceId : undefined,
    })
      .then((value) => active && setData({ scope, value }))
      .catch(() => active && setData({ scope, value: null }));
    return () => {
      active = false;
    };
  }, [scope, workspaceId, reload]);

  useEffect(() => {
    const onStudied = () => setReload((n) => n + 1);
    window.addEventListener(STUDIED_EVENT, onStudied);
    return () => window.removeEventListener(STUDIED_EVENT, onStudied);
  }, []);

  const today = isoDay(new Date());
  const localForecast = useMemo(() => dueForecast(cards, today, 14), [cards, today]);
  const current = data?.scope === scope ? data.value : undefined;
  const loading = data?.scope !== scope;
  const forecast = scope === "workspace" ? localForecast : current?.forecast ?? null;

  const weekday = useMemo(() => new Intl.DateTimeFormat(locale, { weekday: "narrow" }), [locale]);
  const fullDate = useMemo(() => new Intl.DateTimeFormat(locale, { weekday: "short", month: "short", day: "numeric" }), [locale]);
  const label = (day: string) => fullDate.format(startOfLocalDay(day));

  return (
    <section aria-label={T.statsTitle} className="flex flex-col gap-4">
      <div role="radiogroup" aria-label={T.statsTitle} className="grid grid-cols-2 gap-1 rounded-lg bg-hover p-1">
        {(["workspace", "all"] as Scope[]).map((s) => (
          <button
            key={s}
            role="radio"
            aria-checked={scope === s}
            onClick={() => setScope(s)}
            className={`min-h-10 rounded-md px-2 text-sm font-semibold transition ${
              scope === s ? "bg-card text-ink shadow-sm" : "text-ink-soft hover:text-ink"
            }`}
          >
            {s === "workspace" ? T.thisWorkspace : T.allWorkspaces}
          </button>
        ))}
      </div>

      {loading ? (
        <p className="py-6 text-center text-sm text-ink-soft">{T.loading}</p>
      ) : !current ? (
        <p className="py-6 text-center text-sm text-ink-soft">{T.loadFailed}</p>
      ) : (
        <>
          <StreakPanel streak={current.streak} />
          <dl className="grid grid-cols-2 gap-2">
            <Tile
              label={T.retention}
              hint={T.retentionHint}
              value={current.retention === null ? "—" : `${Math.round(current.retention * 100)}%`}
            />
            <Tile label={T.reviews30} value={String(current.reviews30)} />
          </dl>
          <Chart
            title={T.reviewsPerDay}
            points={current.perDay.map((p) => ({ day: p.day, value: p.reviews }))}
            emptyText={T.noData}
            describe={(p) => t(T.chartDay, { day: label(p.day), count: p.value })}
            firstLabel={label(current.perDay[0]?.day ?? today)}
            lastLabel={T.today}
          />
        </>
      )}

      {forecast && (
        <div className="flex flex-col gap-1">
          <Chart
            title={T.dueNext}
            points={forecast.points.map((p) => ({ day: p.day, value: p.count }))}
            emptyText={T.nothingDueSoon}
            describe={(p) => t(T.chartDay, { day: label(p.day), count: p.value })}
            tickLabel={(p) => weekday.format(startOfLocalDay(p.day))}
            tone="sky"
          />
          {forecast.newWaiting > 0 && (
            <p className="text-xs text-ink-soft">{plural(dict.counts.newCardsWaiting, forecast.newWaiting)}</p>
          )}
        </div>
      )}
    </section>
  );
}

/** Streak, banked freezes and the one message that matters right now. */
export function StreakPanel({ streak }: { streak: StreakStatus }) {
  const { dict, t, locale, plural } = useI18n();
  const T = dict.studyTools;
  const fmtDay = (day: string) =>
    new Intl.DateTimeFormat(locale, { weekday: "long" }).format(startOfLocalDay(day));
  const lastFrozen = streak.frozenDays[streak.frozenDays.length - 1];
  const recentFreeze = lastFrozen && streak.current > 0 && !streak.studiedToday ? lastFrozen : null;

  let message: string;
  let tone = "text-ink-soft";
  if (streak.ended && streak.current === 0) {
    message = t(T.streakEnded, { count: streak.ended.length });
  } else if (recentFreeze) {
    message = t(T.freezeUsed, { day: fmtDay(recentFreeze) });
    tone = "text-sky-700 dark:text-sky-300";
  } else if (streak.atRisk) {
    message = t(T.atRisk, { count: streak.current });
    tone = "text-amber-700 dark:text-amber-300";
  } else {
    message = T.freezeExplainer;
  }

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-line bg-card p-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <span className="flex items-center gap-2">
          <Flame className="size-5 text-amber-500" aria-hidden />
          <span className="font-display text-lg font-bold text-ink">{plural(dict.counts.streak, streak.current)}</span>
        </span>
        <span className="flex items-center gap-1.5 text-sm text-ink-soft">
          <Snowflake className="size-4 text-sky-500" aria-hidden />
          {t(T.freezes, { count: streak.freezes })}
        </span>
        {streak.longest > streak.current && (
          <span className="text-xs text-ink-soft">{plural(dict.counts.bestStreak, streak.longest)}</span>
        )}
      </div>
      <p className={`text-sm ${tone}`}>{message}</p>
      <p className="text-xs text-ink-soft">
        {t(T.towardFreeze, { count: streak.towardFreeze, total: FREEZE_EVERY })}
      </p>
    </div>
  );
}

function Tile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-line bg-card px-3 py-2.5">
      <dt className="text-xs font-medium text-ink-soft">{label}</dt>
      <dd className="font-display text-2xl font-bold text-ink">{value}</dd>
      {hint && <p className="text-[11px] leading-snug text-ink-soft">{hint}</p>}
    </div>
  );
}

interface Point {
  day: string;
  value: number;
}

function Chart({
  title,
  points,
  emptyText,
  describe,
  tickLabel,
  firstLabel,
  lastLabel,
  tone = "lime",
}: {
  title: string;
  points: Point[];
  emptyText: string;
  describe: (p: Point) => string;
  tickLabel?: (p: Point) => string;
  firstLabel?: string;
  lastLabel?: string;
  tone?: "lime" | "sky";
}) {
  const max = Math.max(0, ...points.map((p) => p.value));
  const total = points.reduce((n, p) => n + p.value, 0);
  const bar = tone === "sky" ? "bg-sky-500/80" : "bg-lime";
  return (
    <figure className="flex flex-col gap-2">
      <figcaption className="flex items-baseline justify-between gap-2 text-sm font-semibold text-ink">
        {title}
        <span className="font-mono text-xs font-normal text-ink-soft">{total}</span>
      </figcaption>
      {total === 0 ? (
        <p className="rounded-lg bg-hover px-3 py-4 text-center text-xs text-ink-soft">{emptyText}</p>
      ) : (
        <>
          <ul className="flex h-24 items-end gap-0.5" aria-label={title}>
            {points.map((p) => (
              <li key={p.day} className="flex h-full flex-1 flex-col justify-end" title={describe(p)}>
                <span className="sr-only">{describe(p)}</span>
                <span
                  aria-hidden
                  className={`block w-full rounded-t-sm ${p.value > 0 ? bar : "bg-line"}`}
                  style={{ height: p.value > 0 ? `${Math.max(6, (p.value / max) * 100)}%` : "2px" }}
                />
              </li>
            ))}
          </ul>
          {tickLabel ? (
            <div className="flex gap-0.5" aria-hidden>
              {points.map((p) => (
                <span key={p.day} className="flex-1 text-center font-mono text-[10px] text-ink-soft">
                  {tickLabel(p)}
                </span>
              ))}
            </div>
          ) : (
            <div className="flex justify-between font-mono text-[10px] text-ink-soft" aria-hidden>
              <span>{firstLabel}</span>
              <span>{lastLabel}</span>
            </div>
          )}
        </>
      )}
    </figure>
  );
}
