import Link from "next/link";
import { Clock, Download, Flame } from "lucide-react";
import type { Dictionary } from "@/lib/i18n/dictionaries/en";
import type { PluralForms } from "@/lib/i18n/plural";
import {
  BEST_TIME_MIN_SESSIONS,
  INSIGHT_PERIODS,
  TIMES_OF_DAY,
  activityBuckets,
  type CourseInsight,
  type InsightPeriod,
  type Insights,
} from "@/lib/study/insights";
import { cn } from "@/lib/utils";
import {
  describeChange,
  formatDay,
  formatMinutes,
  formatNumber,
  formatPercent,
  periodKey,
} from "./format";
import { StartFocusButton } from "./StartFocusButton";

export interface InsightsI18n {
  dict: Dictionary;
  locale: string;
  t: (template: string, vars?: Record<string, string | number>) => string;
  plural: (forms: PluralForms, count: number, vars?: Record<string, string | number>) => string;
}

const PILL =
  "inline-flex min-h-10 items-center justify-center gap-2 rounded-full px-5 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lime-deep/60";

/**
 * The insights page body: period switch, headline numbers with the change
 * against the period before, day-by-day activity, the streak, when the
 * student focuses, and time per course. No hooks, so it renders on the
 * server; the period switch and the CSV download are plain links.
 */
export function InsightsView({
  insights,
  period,
  i18n,
}: {
  /** null: they could not be read. */
  insights: Insights | null;
  period: InsightPeriod;
  i18n: InsightsI18n;
}) {
  const I = i18n.dict.insights;
  const empty = insights !== null && insights.totals.activeDays === 0;

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-7 sm:py-12">
      <Link href="/app" className="text-sm font-medium text-ink-soft transition hover:text-ink">
        {I.back}
      </Link>

      <div className="mt-5 flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <h1 className="font-display text-3xl leading-tight sm:text-4xl">{I.title}</h1>
          <p className="mt-2 text-[15px] text-ink-soft">{I.subtitle}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          <PeriodSwitch period={period} i18n={i18n} />
          {insights && !empty && (
            <a
              href={`/app/insights/export?period=${period}`}
              download
              aria-label={I.downloadAria}
              className={cn(PILL, "min-h-11 border border-line-strong bg-card px-4 text-ink hover:bg-hover")}
            >
              <Download className="h-4 w-4" aria-hidden />
              {I.download}
            </a>
          )}
        </div>
      </div>

      {insights === null ? (
        <p role="alert" className="mt-8 rounded-3xl bg-oat px-6 py-8 text-center text-[15px] text-ink">
          {I.loadFailed}
        </p>
      ) : empty ? (
        <EmptyState insights={insights} i18n={i18n} />
      ) : (
        <>
          <Headline insights={insights} i18n={i18n} />
          <ActivityChart insights={insights} i18n={i18n} />
          <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
            <StreakCard insights={insights} i18n={i18n} />
            <RhythmCard insights={insights} i18n={i18n} />
          </div>
          <Courses courses={insights.courses} i18n={i18n} />
        </>
      )}

      {insights && (
        <p className="mt-10 text-center text-xs text-ink-faint">
          {i18n.t(I.zoneNote, { zone: insights.timeZone })} {i18n.dict.focus.free}
        </p>
      )}
    </div>
  );
}

function PeriodSwitch({ period, i18n }: { period: InsightPeriod; i18n: InsightsI18n }) {
  const I = i18n.dict.insights;
  return (
    <nav aria-label={I.periodLabel}>
      <ul className="inline-flex rounded-full border border-line bg-card p-1">
        {INSIGHT_PERIODS.map((p) => {
          const active = p === period;
          const key = periodKey(p);
          return (
            <li key={p}>
              <Link
                href={`/app/insights?period=${p}`}
                scroll={false}
                aria-current={active ? "page" : undefined}
                title={I.periodAria[key]}
                className={cn(
                  "inline-flex min-h-9 items-center whitespace-nowrap rounded-full px-3.5 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lime-deep/60 sm:px-4",
                  active ? "bg-ink text-paper" : "text-ink-soft hover:text-ink",
                )}
              >
                {I.periods[key]}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

function Headline({ insights, i18n }: { insights: Insights; i18n: InsightsI18n }) {
  const { dict, locale, t, plural } = i18n;
  const I = dict.insights;
  const { totals, comparison, period } = insights;
  const base = { hasPrevious: comparison.hasPrevious, period, copy: dict };
  const count = (n: number) => formatNumber(n, locale);
  const percent = (r: number) => formatPercent(r, locale);

  // Each tile: the number, what it is made of (note), and how it compares
  // with the period before (change).
  const tiles: {
    key: string;
    label: string;
    value: string;
    note?: string;
    change: string;
    tint: string;
    wide?: boolean;
  }[] = [
    {
      key: "focus",
      label: I.focusTime,
      value: formatMinutes(totals.focusMinutes, dict, locale),
      change: describeChange(comparison.focusMinutes, { ...base, show: (m) => formatMinutes(m, dict, locale) }),
      tint: "bg-matcha",
      wide: true,
    },
    {
      key: "days",
      label: I.activeDays,
      value: t(I.activeOf, { active: count(totals.activeDays), total: count(insights.current.days) }),
      note: I.activeHint,
      change: describeChange(comparison.activeDays, { ...base, show: count }),
      tint: "bg-cloud",
    },
    {
      key: "cards",
      label: I.cardsReviewed,
      value: count(totals.cards),
      note: totals.newCards > 0 ? plural(I.newCards, totals.newCards) : undefined,
      change: describeChange(comparison.cards, { ...base, show: count }),
      tint: "bg-heather",
    },
    {
      key: "recall",
      label: I.recallRate,
      value: totals.recallRate === null ? I.noValue : percent(totals.recallRate),
      note: totals.recallRate === null ? undefined : I.recallHint,
      change:
        totals.recallRate === null
          ? I.recallNone
          : describeChange(comparison.recallRate, { ...base, show: percent, rate: true }),
      tint: "bg-oat",
    },
    {
      key: "quiz",
      label: I.quizAccuracy,
      value: totals.quizAccuracy === null ? I.noValue : percent(totals.quizAccuracy),
      note: totals.quizAccuracy === null ? undefined : plural(I.quizFrom, totals.quizAnswers),
      change:
        totals.quizAccuracy === null
          ? I.quizNone
          : describeChange(comparison.quizAccuracy, { ...base, show: percent, rate: true }),
      tint: "border border-line bg-card",
    },
  ];

  return (
    <dl className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      {tiles.map((tile) => (
        <div
          key={tile.key}
          data-tile={tile.key}
          className={cn("flex min-w-0 flex-col rounded-3xl p-4 sm:p-5", tile.tint, tile.wide && "col-span-2 sm:col-span-1")}
        >
          <dt className="text-[13px] font-medium text-ink-soft">{tile.label}</dt>
          <dd className="mt-1 font-display text-2xl leading-tight text-ink tabular-nums sm:text-3xl">{tile.value}</dd>
          {tile.note && <dd className="mt-1 text-xs leading-snug text-ink-faint">{tile.note}</dd>}
          <dd className="mt-auto pt-2 text-xs leading-snug text-ink-soft">{tile.change}</dd>
        </div>
      ))}
    </dl>
  );
}

function ActivityChart({ insights, i18n }: { insights: Insights; i18n: InsightsI18n }) {
  const { dict, locale, t, plural } = i18n;
  const I = dict.insights;
  const weekly = insights.period === "90d";
  const buckets = activityBuckets(insights.perDay, insights.period);
  const dense = buckets.length > 14;
  const maxFocus = Math.max(1, ...buckets.map((b) => b.focusMinutes));
  const maxCards = Math.max(1, ...buckets.map((b) => b.cards));
  const height = (value: number, max: number) => (value > 0 ? `${Math.max(4, Math.round((value / max) * 100))}%` : "0%");
  const short = (day: string) => formatDay(day, locale, { month: "short", day: "numeric" });
  const label = (b: { from: string; to: string }) =>
    weekly
      ? t(I.weekRange, { from: short(b.from), to: short(b.to) })
      : formatDay(b.from, locale, { weekday: "short", month: "short", day: "numeric" });
  const tick = (day: string) => formatDay(day, locale, { weekday: "narrow" });
  const title = weekly ? I.chartWeekly : I.chartDaily;

  return (
    <section aria-labelledby="insights-chart" className="mt-4 rounded-3xl border border-line bg-card p-5 sm:p-7">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
        <h2 id="insights-chart" className="font-display text-2xl">
          {title}
        </h2>
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-soft" aria-hidden>
          <li className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-lime" />
            {I.legendFocus}
          </li>
          <li className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-sky-500/80" />
            {I.legendCards}
          </li>
        </ul>
      </div>

      <div
        aria-hidden
        className={cn(
          "mt-6 flex h-40 items-end border-b border-line sm:h-48",
          // 30 paired columns still fit a phone with hairline gaps.
          dense ? "gap-[2px] sm:gap-1" : "gap-2 sm:gap-3",
        )}
      >
        {buckets.map((b) => (
          <div
            key={b.from}
            title={t(I.barLabel, {
              day: label(b),
              focus: formatMinutes(b.focusMinutes, dict, locale),
              cards: plural(dict.counts.cards, b.cards),
            })}
            className={cn("flex h-full min-w-0 flex-1 items-end justify-center", dense ? "gap-px sm:gap-[2px]" : "gap-1")}
          >
            <span className="w-full max-w-4 rounded-t-full bg-lime" style={{ height: height(b.focusMinutes, maxFocus) }} />
            <span className="w-full max-w-4 rounded-t-full bg-sky-500/80" style={{ height: height(b.cards, maxCards) }} />
          </div>
        ))}
      </div>
      {insights.period === "7d" ? (
        <div aria-hidden className="mt-2 flex gap-2 text-center text-[11px] text-ink-faint sm:gap-3">
          {buckets.map((b) => (
            <span key={b.from} className={cn("min-w-0 flex-1", b.to === insights.today && "font-semibold text-ink")}>
              {tick(b.from)}
            </span>
          ))}
        </div>
      ) : (
        <div aria-hidden className="mt-2 flex justify-between text-[11px] text-ink-faint">
          <span>{short(buckets[0]?.from ?? insights.current.from)}</span>
          <span>{I.today}</span>
        </div>
      )}

      <table className="sr-only">
        <caption>{title}</caption>
        <thead>
          <tr>
            <th scope="col">{weekly ? I.tableWeek : I.tableDay}</th>
            <th scope="col">{I.tableFocus}</th>
            <th scope="col">{I.tableCards}</th>
          </tr>
        </thead>
        <tbody>
          {buckets.map((b) => (
            <tr key={b.from}>
              <th scope="row">{label(b)}</th>
              <td>{formatMinutes(b.focusMinutes, dict, locale)}</td>
              <td>{formatNumber(b.cards, locale)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function StreakCard({ insights, i18n }: { insights: Insights; i18n: InsightsI18n }) {
  const { dict, plural } = i18n;
  const I = dict.insights;
  const { streak } = insights;
  const message = streak.current === 0 ? I.streakStart : streak.studiedToday ? I.streakToday : I.streakKeep;
  return (
    <section aria-labelledby="insights-streak" className="flex flex-col rounded-3xl bg-oat p-5 sm:p-6">
      <h2 id="insights-streak" className="flex items-center gap-2 font-display text-xl">
        <Flame className="h-5 w-5 text-ink-soft" aria-hidden />
        {I.streakTitle}
      </h2>
      <p className="mt-3 font-display text-3xl text-ink">
        {streak.current > 0 ? plural(dict.counts.streak, streak.current) : I.streakNone}
      </p>
      {streak.longest > 0 && <p className="mt-1 text-sm text-ink-soft">{plural(dict.counts.bestStreak, streak.longest)}</p>}
      <p className="mt-3 text-sm text-ink">{message}</p>
      <p className="mt-auto pt-3 text-xs text-ink-soft">{I.streakHint}</p>
    </section>
  );
}

function RhythmCard({ insights, i18n }: { insights: Insights; i18n: InsightsI18n }) {
  const { dict, locale, plural } = i18n;
  const I = dict.insights;
  const { rhythm } = insights;
  const enough = rhythm.sessions >= BEST_TIME_MIN_SESSIONS;
  const max = Math.max(1, ...TIMES_OF_DAY.map((p) => rhythm.parts[p]));
  const headline = rhythm.best ? I.bestTime[rhythm.best] : enough ? I.bestTimeEven : I.bestTimeNotYet;
  return (
    <section aria-labelledby="insights-rhythm" className="flex flex-col rounded-3xl bg-cloud p-5 sm:p-6">
      <h2 id="insights-rhythm" className="flex items-center gap-2 font-display text-xl">
        <Clock className="h-5 w-5 text-ink-soft" aria-hidden />
        {I.rhythmTitle}
      </h2>
      <p className="mt-3 text-[15px] font-semibold text-ink">{headline}</p>
      {rhythm.sessions > 0 && (
        <>
          <ul className="mt-4 flex flex-col gap-2.5">
            {TIMES_OF_DAY.map((part) => (
              <li key={part} className="grid grid-cols-[6.5rem_1fr_auto] items-center gap-3 text-sm">
                <span className="truncate text-ink-soft">{I.parts[part]}</span>
                <span className="h-2 overflow-hidden rounded-full bg-card" aria-hidden>
                  <span
                    className="block h-full rounded-full bg-lime"
                    style={{ width: rhythm.parts[part] > 0 ? `${Math.max(3, Math.round((rhythm.parts[part] / max) * 100))}%` : "0%" }}
                  />
                </span>
                <span className="text-end tabular-nums text-ink">{formatMinutes(rhythm.parts[part], dict, locale)}</span>
              </li>
            ))}
          </ul>
          <p className="mt-auto pt-3 text-xs text-ink-soft">{plural(I.sessions, rhythm.sessions)}</p>
        </>
      )}
    </section>
  );
}

function Courses({ courses, i18n }: { courses: CourseInsight[]; i18n: InsightsI18n }) {
  const { dict, locale, t, plural } = i18n;
  const I = dict.insights;
  if (courses.length === 0) return null;
  return (
    <section aria-labelledby="insights-courses" className="mt-10">
      <h2 id="insights-courses" className="font-display text-2xl">
        {I.coursesTitle}
      </h2>
      <ul className="mt-4 divide-y divide-line overflow-hidden rounded-3xl border border-line bg-card">
        {courses.map((course) => {
          const details = [
            course.cards > 0 ? plural(dict.counts.cards, course.cards) : null,
            course.quizAccuracy !== null ? t(I.quizShare, { value: formatPercent(course.quizAccuracy, locale) }) : null,
          ].filter(Boolean);
          const body = (
            <>
              <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-matcha text-xl" aria-hidden>
                {course.id === null ? "…" : (course.icon ?? dict.app.fallbackIcon)}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-semibold text-ink">
                  {course.id === null ? I.other : <bdi>{course.name}</bdi>}
                </span>
                <span className="block truncate text-xs text-ink-soft">
                  {course.id === null && details.length === 0 ? I.otherHint : details.join(" · ")}
                </span>
                {course.focusMinutes > 0 && (
                  <span className="mt-2 block h-1.5 overflow-hidden rounded-full bg-hover" aria-hidden>
                    <span
                      className="block h-full rounded-full bg-lime"
                      style={{ width: `${Math.max(3, Math.round(course.focusShare * 100))}%` }}
                    />
                  </span>
                )}
              </span>
              <span className="shrink-0 text-sm font-semibold tabular-nums text-ink">
                {formatMinutes(course.focusMinutes, dict, locale)}
              </span>
            </>
          );
          return (
            <li key={course.id ?? "other"}>
              {course.id === null ? (
                <div className="flex items-center gap-3 px-4 py-4 sm:px-5" title={I.otherHint}>
                  {body}
                </div>
              ) : (
                <Link
                  href={`/app/${encodeURIComponent(course.id)}`}
                  title={t(I.openCourse, { name: course.name ?? "" })}
                  className="flex items-center gap-3 px-4 py-4 transition hover:bg-hover focus-visible:bg-hover focus-visible:outline-none sm:px-5"
                >
                  {body}
                </Link>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function EmptyState({ insights, i18n }: { insights: Insights; i18n: InsightsI18n }) {
  const I = i18n.dict.insights;
  const returning = insights.everStudied;
  return (
    <>
      <section className="mt-8 rounded-3xl bg-oat px-6 py-10 text-center sm:px-14 sm:py-14">
        <h2 className="font-display text-2xl text-ink sm:text-3xl">{returning ? I.quietTitle : I.emptyTitle}</h2>
        <p className="mx-auto mt-2 max-w-md text-[15px] text-ink-soft">{returning ? I.quietBody : I.emptyBody}</p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <StartFocusButton label={I.startFocus} className={cn(PILL, "min-h-11 bg-lime text-lime-on hover:bg-lime-hover")} />
          <Link href="/app" className={cn(PILL, "min-h-11 border border-line-strong bg-card text-ink hover:bg-hover")}>
            {I.reviewCards}
          </Link>
        </div>
      </section>
      {insights.streak.longest > 0 && (
        <div className="mt-4">
          <StreakCard insights={insights} i18n={i18n} />
        </div>
      )}
    </>
  );
}
