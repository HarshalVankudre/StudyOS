/**
 * Static renderings of real StudyOS screens for the landing page. They use
 * the app's own dictionary strings and presenters (Today, feeds, study kits,
 * grades), so the wording shown is the wording the product produces, in the
 * visitor's language. Server components, no client JavaScript; nothing in
 * them is interactive, so controls are drawn as plain text, not buttons.
 */
import {
  CalendarClock,
  CalendarSync,
  Check,
  Clock3,
  FileQuestion,
  FileText,
  Flag,
  Hourglass,
  RotateCcw,
  ShieldCheck,
  Snowflake,
  Undo2,
} from "lucide-react";
import type { ReactNode } from "react";
import type { Dictionary } from "@/lib/i18n/dictionaries/en";
import { fmt } from "@/lib/i18n/interpolate";
import { plural } from "@/lib/i18n/plural";
import {
  examCountdownLabel,
  formatDay,
  formatDuration,
  formatLongDay,
  itemNotes,
  itemReason,
  itemTitle,
  kindLabel,
  planTotals,
  workloadText,
} from "@/lib/agents/daily-study/present";
import { TODAY_MINUTES_OPTIONS, type DailyStudyPlanItem } from "@/lib/agents/daily-study/types";
import { formatGrade, formatPercent, resolveScale } from "@/lib/grades/scales";
import { formatGermanGrade, germanAverage, neededAverage } from "@/lib/grades/german";
import { germanNeededValue, germanOutlookText, outlookText, targetText } from "@/components/workspace/grades/text";
import { ProgressRing } from "@/components/today/ProgressRing";
import { modelForPlan } from "@/lib/ai/plans";
import { isFixedPrice, studyKitPartQuote, studyKitQuote } from "@/lib/price-list";
import { cn } from "@/lib/utils";
import {
  sampleExams,
  sampleGermanModules,
  sampleGrade,
  sampleTodayItems,
  sampleWorkload,
  weekdayIn,
} from "./samples";

interface PreviewProps {
  dict: Dictionary;
  locale: string;
  /** The day the page is rendered for (YYYY-MM-DD). */
  today: string;
}

/** A pill: the shape of every tag, in one of the soft fills. */
const TAG = "inline-flex max-w-full items-center gap-1.5 rounded-full px-3 py-1 text-[13px] font-medium text-ink";
/** The fill a plan item's tag takes, by what kind of work it is. */
const KIND_TINT = {
  deadline: "bg-matcha",
  exam: "bg-cloud",
  flashcards: "bg-heather",
  quiz: "bg-oat",
  task: "bg-oat",
} as const;

/** Small "Sample" marker so nobody mistakes a rendering for real data. */
export function SampleTag({ label }: { label: string }) {
  return (
    <span className="shrink-0 rounded-full border border-line-strong px-2.5 py-0.5 text-xs font-medium text-ink-soft">
      {label}
    </span>
  );
}

function Frame({
  label,
  sample,
  children,
  className,
}: {
  label: string;
  sample: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <figure className={cn("min-w-0 overflow-hidden rounded-3xl border border-line bg-card", className)}>
      <figcaption className="flex items-center gap-2 border-b border-line px-5 py-3 text-sm font-medium text-ink-soft">
        <span className="min-w-0 flex-1 truncate">{label}</span>
        <SampleTag label={sample} />
      </figcaption>
      {children}
    </figure>
  );
}

/** The round "done" mark: an empty ring, or lime with a check. */
function CheckCircle({ done, className }: { done: boolean; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "grid h-7 w-7 shrink-0 place-items-center rounded-full border-2",
        done ? "border-lime bg-lime text-lime-on" : "border-line-strong text-transparent",
        className,
      )}
    >
      <Check className="h-4 w-4" strokeWidth={3} />
    </span>
  );
}

/** The Today plan the morning after two missed days. */
export function TodayPreview({ dict, locale, today }: PreviewProps) {
  const T = dict.today;
  const S = dict.landing.samples;
  const items = sampleTodayItems(S, today);
  const totals = planTotals(items);
  const carried = items.filter((i) => i.carry).length;
  const progress = fmt(T.progress, { done: totals.done, total: totals.total });

  return (
    <Frame label={S.workspace} sample={S.tag}>
      <div className="p-5 sm:p-8">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="inline-flex whitespace-nowrap rounded-full bg-lime px-3 py-1 text-[13px] font-semibold text-lime-on sm:text-sm">
              {formatLongDay(today, locale)}
            </p>
            <p className="mt-4 font-display text-5xl leading-none text-ink sm:text-7xl">{T.title}</p>
            <p className="mt-4 text-[15px] leading-6 text-ink-soft sm:text-[17px]">
              {plural(locale, dict.counts.planSummary, totals.total, { time: formatDuration(totals.minutes, T) })}
              <span className="text-ink-faint">
                {" · "}
                {fmt(T.budget, { time: formatDuration(120, T) })}
              </span>
            </p>
          </div>
          <div className="shrink-0 text-center">
            <ProgressRing done={totals.done} total={totals.total} label={T.sectionLabel} caption={progress} size={132} />
            <p className="mt-2 text-[13px] text-ink-faint">{progress}</p>
          </div>
        </div>

        <div className="mt-6 flex items-center gap-3.5 rounded-2xl bg-matcha px-5 py-4 text-[15px] leading-6">
          <CheckCircle done />
          <div className="min-w-0">
            <p className="font-medium text-ink">{T.welcomeBack}</p>
            <p className="text-ink-soft">{plural(locale, dict.counts.carried, carried)}</p>
          </div>
        </div>

        <ol className="mt-3 space-y-3">
          {items.map((item) => (
            <TodayRow key={item.id} item={item} dict={dict} locale={locale} />
          ))}
        </ol>

        <p className="mt-4 flex items-center gap-1.5 text-xs text-ink-faint">
          <CalendarClock className="h-3.5 w-3.5 shrink-0" aria-hidden />
          {T.free}
        </p>
      </div>
    </Frame>
  );
}

function TodayRow({ item, dict, locale }: { item: DailyStudyPlanItem; dict: Dictionary; locale: string }) {
  const T = dict.today;
  const done = item.completed;
  const notes = itemNotes(item, T, locale);
  return (
    <li className="flex items-start gap-4 rounded-2xl border border-line bg-paper px-5 py-4">
      <CheckCircle done={done} className="mt-0.5 h-8 w-8" />
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span
            className={cn(
              "min-w-0 break-words font-display text-[19px] leading-7",
              done ? "text-ink-faint line-through decoration-ink-faint/60" : "text-ink",
            )}
          >
            {itemTitle(item, T)}
          </span>
          {item.startHere && !done && (
            <span className="rounded-full bg-lime px-2.5 py-0.5 text-xs font-semibold text-lime-on">{T.startHere}</span>
          )}
        </p>
        {!done && <p className="mt-0.5 text-[15px] leading-6 text-ink-soft">{itemReason(item, T, locale)}</p>}
        {!done && notes.length > 0 && <p className="text-xs leading-5 text-ink-faint">{notes.join(" ")}</p>}
        <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm text-ink-faint">
          <span className="inline-flex items-center gap-1.5">
            <Clock3 className="h-3.5 w-3.5" aria-hidden />
            {formatDuration(item.minutes, T)}
          </span>
          <span aria-hidden>·</span>
          <span>{kindLabel(item, T)}</span>
          {item.dueDate && item.kind === "deadline" && (
            <>
              <span aria-hidden>·</span>
              <span>{fmt(T.due, { date: formatDay(item.dueDate, locale) })}</span>
            </>
          )}
          {item.dueCount ? (
            <>
              <span aria-hidden>·</span>
              <span className="tabular-nums">{fmt(T.cardsProgress, { done: 0, total: item.dueCount })}</span>
            </>
          ) : null}
        </p>
      </div>
      {item.section && (
        <span className={cn(TAG, KIND_TINT[item.kind], "mt-0.5 hidden shrink-0 sm:inline-flex")}>
          <span className="max-w-[9rem] truncate">{item.section}</span>
        </span>
      )}
    </li>
  );
}

/** Overload heads-up, exam countdown and "how much time do you have today?". */
export function PlanToolsPreview({ dict, locale, today }: PreviewProps) {
  const T = dict.today;
  const S = dict.landing.samples;
  const workload = workloadText(sampleWorkload(S), T, locale);
  const exams = sampleExams(S, today);
  const choices = TODAY_MINUTES_OPTIONS.map((m) => formatDuration(m, T));

  return (
    <Frame label={T.sectionLabel} sample={S.tag}>
      <div className="space-y-5 p-5 sm:p-6">
        <div className="flex gap-3 rounded-2xl bg-oat px-4 py-3.5 text-sm leading-6 text-ink-soft">
          <Hourglass className="mt-1 h-4 w-4 shrink-0 text-ink" aria-hidden />
          <div className="min-w-0">
            <p className="font-medium text-ink">{workload.title}</p>
            <p className="mt-0.5">{workload.body}</p>
            {workload.start && <p className="mt-0.5">{workload.start}</p>}
          </div>
        </div>

        <div>
          <p className="font-display text-xl text-ink">{T.examsTitle}</p>
          <ul className="mt-3 space-y-2">
            {exams.map((exam, i) => (
              <li
                key={exam.id}
                className={cn(
                  "flex items-center justify-between gap-4 rounded-2xl px-4 py-3",
                  i % 2 === 0 ? "bg-cloud" : "bg-matcha",
                )}
              >
                <span className="min-w-0 truncate font-display text-[17px] text-ink">{exam.title}</span>
                <span className="shrink-0 text-sm tabular-nums text-ink-soft">{examCountdownLabel(exam, T, locale)}</span>
                <span className="sr-only">{formatDay(exam.date, locale)}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="border-t border-line pt-5">
          <p className="inline-flex items-center gap-2 text-sm font-semibold text-ink">
            <RotateCcw className="h-4 w-4 rtl:-scale-x-100" aria-hidden />
            {T.rebuildTitle}
          </p>
          <p className="mt-1 text-sm text-ink-soft">{T.rebuildQuestion}</p>
          <ul className="mt-3 flex flex-wrap gap-2">
            {choices.map((label, i) => (
              <li
                key={label}
                className={cn(
                  "flex min-h-9 items-center rounded-full px-4 text-sm",
                  i === 1 ? "bg-lime font-semibold text-lime-on" : "border border-line-strong text-ink-soft",
                )}
              >
                {label}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </Frame>
  );
}

/** Connected school calendars after a sync, with one flagged deadline. */
export function FeedPreview({ dict, locale }: Omit<PreviewProps, "today">) {
  const F = dict.feeds;
  const S = dict.landing.samples;
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  const summary = [
    fmt(F.summaryAdded, { count: 2 }),
    fmt(F.summaryUpdated, { count: 1 }),
    fmt(F.summaryKept, { count: 1 }),
  ].join(dict.today.listSeparator);
  // A German visitor sees the platforms German universities run (Moodle,
  // ILIAS, Stud.IP), as in the import dialog's own help (feeds/FeedHelp).
  const german = locale === "de";
  const rows = [
    {
      name: german ? F.platform.moodle : F.platform.canvas,
      when: rtf.format(-2, "hour"),
      changes: fmt(F.lastChanges, { summary }),
    },
    {
      name: german ? F.platform.ilias : F.platform.moodle,
      when: rtf.format(-1, "day"),
      changes: fmt(F.lastChanges, { summary: F.noChanges }),
    },
  ];
  const platforms = german
    ? [F.platform.moodle, F.platform.ilias, F.platform.studip, F.platform.google]
    : [F.platform.canvas, F.platform.moodle, F.platform.blackboard, F.platform.brightspace, F.platform.google];

  return (
    <Frame label={F.connectedTitle} sample={S.tag}>
      <div className="space-y-3 p-5 sm:p-6">
        <ul className="space-y-2.5">
          {rows.map((row) => (
            <li key={row.name} className="flex items-start gap-3.5 rounded-2xl border border-line bg-paper px-4 py-3.5">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-matcha text-ink">
                <CalendarSync className="h-4 w-4" aria-hidden />
              </span>
              <div className="min-w-0 flex-1">
                <p className="font-display text-[17px] leading-6 text-ink">{row.name}</p>
                <p className="text-[13px] text-ink-faint">{fmt(F.lastSynced, { when: row.when })}</p>
                <p className="mt-0.5 text-[13px] text-ink-soft">{row.changes}</p>
              </div>
            </li>
          ))}
        </ul>
        <div className="rounded-2xl bg-oat px-4 py-3.5">
          <p className="flex items-center gap-2 text-sm font-semibold text-ink">
            <Flag className="h-4 w-4" aria-hidden />
            {F.flaggedTitle}
          </p>
          <p className="mt-0.5 text-[13px] leading-5 text-ink-soft">{F.flaggedHint}</p>
          <div className="mt-3 flex flex-wrap items-center gap-2 rounded-2xl bg-card px-4 py-2.5">
            <span className="min-w-0 flex-1 truncate text-sm text-ink">{S.items.reading}</span>
            <span className="rounded-full border border-line-strong px-3 py-1 text-[13px] font-medium text-ink">
              {F.keep}
            </span>
            <span className="px-2 py-1 text-[13px] font-medium text-ink-soft">{F.remove}</span>
          </div>
        </div>
        <ul className="flex flex-wrap gap-1.5 pt-1">
          {platforms.map((name) => (
            <li key={name} className="rounded-full border border-line-strong px-2.5 py-0.5 text-xs text-ink-soft">
              {name}
            </li>
          ))}
        </ul>
      </div>
    </Frame>
  );
}

/** A study-kit flashcard with its page label and the checked quote. */
export function StudyKitPreview({ dict, locale }: Omit<PreviewProps, "today">) {
  const M = dict.materials;
  const S = dict.landing.samples;
  const page = (n: number) => fmt(dict.quiz.sourcePage, { page: n });
  // Three parts at the price the configured model is charged (lib/price-list.ts).
  const part = studyKitPartQuote(modelForPlan("free"));
  const cost = studyKitQuote(3, part);

  return (
    <Frame label={fmt(M.kitPageTitle, { title: S.card.material })} sample={S.tag}>
      <div className="space-y-3 p-5 sm:p-6">
        <div className="rounded-2xl border border-line bg-paper p-4">
          <p className="text-[13px] font-medium text-ink-faint">{M.kitFlashcards}</p>
          <p className="mt-1.5 font-display text-[17px] leading-6 text-ink">{S.card.front}</p>
          <p className="mt-2 border-t border-line pt-2 text-sm leading-6 text-ink-soft">{S.card.back}</p>
          <span className="mt-3 inline-flex max-w-full items-center gap-1.5 rounded-full border border-line-strong px-2.5 py-0.5 text-xs font-medium text-ink-soft">
            <FileText className="size-3 shrink-0" aria-hidden />
            <span className="truncate">{page(14)}</span>
          </span>
        </div>

        <div className="rounded-2xl bg-heather p-4">
          <p className="text-[13px] font-medium text-ink-soft">
            {S.card.material} · {fmt(M.viewerPage, { page: 14, count: 38 })}
          </p>
          <p className="mt-2 text-[13px] font-medium text-ink-soft">{M.viewerQuote}</p>
          <p className="mt-1 text-sm leading-6 text-ink">
            <mark className="rounded bg-lime px-1 text-lime-on">{S.card.quote}</mark>
          </p>
        </div>

        <div className="flex items-start gap-2.5 rounded-2xl border border-line bg-paper p-4 text-sm text-ink">
          <FileQuestion className="mt-0.5 h-4 w-4 shrink-0 text-ink-faint" aria-hidden />
          <span className="min-w-0 flex-1">{S.card.question}</span>
          <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-line-strong px-2.5 py-0.5 text-xs font-medium text-ink-soft">
            <FileText className="size-3" aria-hidden />
            {page(15)}
          </span>
        </div>

        <div className="space-y-1.5 pt-1 text-[13px] leading-5 text-ink-soft">
          <p className="flex items-start gap-2">
            <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-lime-deep" aria-hidden />
            {plural(locale, M.doneDropped, 3)}
          </p>
          <p className="flex items-start gap-2">
            <Clock3 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ink-faint" aria-hidden />
            {isFixedPrice(part)
              ? plural(locale, M.costFixed, cost.list, { each: part.list.toLocaleString(locale) })
              : plural(locale, M.costRange, cost.price, { max: cost.max.toLocaleString(locale) })}{" "}
            {M.costNote}
          </p>
        </div>
      </div>
    </Frame>
  );
}

/** Streak with a freeze that covered a missed day. */
export function StreakPreview({ dict, locale, today }: PreviewProps) {
  const ST = dict.studyTools;
  const S = dict.landing.samples;
  return (
    <Frame label={ST.statsTitle} sample={S.tag}>
      <div className="space-y-3 p-5 sm:p-6">
        <div className="flex items-start gap-3 rounded-2xl bg-oat px-4 py-3.5 text-sm leading-6 text-ink">
          <Snowflake className="mt-1 h-4 w-4 shrink-0" aria-hidden />
          {fmt(ST.freezeUsed, { day: weekdayIn(today, -2, locale) })}
        </div>
        <div className="flex flex-wrap gap-2">
          <span className={cn(TAG, "bg-matcha")}>{fmt(ST.freezes, { count: 1 })}</span>
          <span className={cn(TAG, "border border-line-strong font-normal text-ink-soft")}>
            {fmt(ST.towardFreeze, { count: 4, total: 7 })}
          </span>
        </div>
        <p className="rounded-2xl border border-line bg-paper px-4 py-3 text-[13px] text-ink-soft">{ST.practiceBanner}</p>
      </div>
    </Frame>
  );
}

/** A course with three of four grades in, computed with the real grade math. */
/**
 * The grades sample a German visitor sees: module grades with their credits
 * and the Notenschnitt, computed with the tracker's own German maths
 * (lib/grades/german). One exam per module makes the weighted-coursework
 * sample below beside the point for them.
 */
function GermanGradesPreview({ dict, locale }: Omit<PreviewProps, "today">) {
  const G = dict.grades;
  const S = dict.landing.samples;
  const calc = dict.tools.gradeCalculator;
  const E = calc.ects;
  const { modules, target } = sampleGermanModules(S);
  const average = germanAverage(modules);
  const needed = neededAverage(modules, target);
  const grade = (n: number | null) => (n === null ? "—" : formatGermanGrade(n, locale));
  const credits = (n: number) => n.toLocaleString(locale);

  return (
    <Frame label={`${G.defaultTitle} · ${S.workspace}`} sample={S.tag}>
      <div className="p-5 sm:p-6">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="font-display text-2xl text-ink">{E.average}</p>
          <p className="text-sm text-ink-soft">
            {E.targetLabel}: <span className="font-semibold text-ink">{grade(target)}</span>
          </p>
        </div>
        <table className="mt-4 w-full border-collapse text-sm">
          <thead>
            <tr className="text-[13px] text-ink-faint">
              <th scope="col" className="pb-2 pe-2 text-start font-medium">{E.moduleColumn}</th>
              <th scope="col" className="pb-2 pe-2 text-end font-medium">{E.ectsColumn}</th>
              <th scope="col" className="w-16 pb-2 text-end font-medium">{E.gradeColumn}</th>
            </tr>
          </thead>
          <tbody>
            {modules.map((m) => (
              <tr key={m.name} className="border-t border-line">
                <td className="py-2.5 pe-2 text-ink">{m.name}</td>
                <td className="py-2.5 pe-2 text-end tabular-nums text-ink-soft">{m.ects === null ? "—" : credits(m.ects)}</td>
                <td className="w-16 py-2.5 text-end font-semibold tabular-nums text-ink">{grade(m.grade)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-4 rounded-2xl bg-matcha px-4 py-3 text-sm font-medium leading-6 text-ink">
          {germanOutlookText(average, needed, target, modules.length, locale, E, fmt)}
        </p>
        <ul className="mt-5 grid gap-2 sm:grid-cols-2">
          <li className="rounded-2xl bg-cloud px-4 py-3">
            <p className="truncate text-xs text-ink-soft">{E.average}</p>
            <p className="mt-0.5 font-display text-2xl text-ink">{grade(average.shown)}</p>
            <p className="text-xs text-ink-soft">{fmt(E.unrounded, { value: average.unrounded === null ? "—" : formatGermanGrade(average.unrounded, locale, 2) })}</p>
          </li>
          <li className="rounded-2xl bg-oat px-4 py-3">
            <p className="truncate text-xs text-ink-soft">{E.neededLabel}</p>
            <p className="mt-0.5 font-display text-2xl text-ink">{germanNeededValue(needed, modules.length, locale, calc)}</p>
            <p className="text-xs text-ink-soft">
              {fmt(E.ectsDone, { earned: credits(average.earnedEcts), open: credits(average.openEcts) })}
            </p>
          </li>
        </ul>
      </div>
    </Frame>
  );
}

export function GradesPreview({ dict, locale }: Omit<PreviewProps, "today">) {
  if (locale === "de") return <GermanGradesPreview dict={dict} locale={locale} />;
  const G = dict.grades;
  const S = dict.landing.samples;
  const { rows, grade, target } = sampleGrade(S);
  const us = resolveScale("us_letter");
  const ukValue = formatGrade(grade.current ?? 0, resolveScale("uk_degree", undefined, G.uk), locale);
  const scales = [
    { label: G.presets.us_letter, value: formatGrade(grade.current ?? 0, resolveScale("us_letter"), locale) },
    {
      label: G.presets.uk_degree,
      value: ukValue,
      // UK degree classes ("First", "Third") stay in English in other
      // languages: a proper noun, marked as English (and set in italics).
      foreign: locale !== "en" && /[A-Za-z]/.test(ukValue) ? "en" : undefined,
    },
    { label: G.presets.de_grade, value: formatGrade(grade.current ?? 0, resolveScale("de_grade"), locale) },
  ];
  const tints = ["bg-cloud", "bg-heather", "bg-oat"];

  return (
    <Frame label={`${G.defaultTitle} · ${S.grades.course}`} sample={S.tag}>
      <div className="p-5 sm:p-6">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="font-display text-2xl text-ink">{S.grades.course}</p>
          <p className="text-sm text-ink-soft">
            {G.target}: <span className="font-semibold text-ink">{targetText(target, us, locale)}</span>
          </p>
        </div>
        <table className="mt-4 w-full border-collapse text-sm">
          <tbody>
            {rows.map((row) => (
              <tr key={row.name} className="border-t border-line">
                <td className="py-2.5 pe-2 text-ink">{row.name}</td>
                <td className="py-2.5 pe-2 text-end text-[13px] text-ink-faint">
                  {fmt(G.weightOf, { weight: formatPercent(row.weight, locale) })}
                </td>
                <td className="w-16 py-2.5 text-end font-semibold tabular-nums text-ink">
                  {row.score === null ? "—" : formatPercent(row.score, locale)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-4 rounded-2xl bg-matcha px-4 py-3 text-sm font-medium leading-6 text-ink">
          {outlookText(grade, target, us, locale, G, fmt)}
        </p>
        <p className="mt-5 text-[13px] font-medium text-ink-faint">{S.grades.scales}</p>
        <ul className="mt-2 grid gap-2 sm:grid-cols-3">
          {scales.map((s, i) => (
            <li key={s.label} className={cn("rounded-2xl px-4 py-3", tints[i % tints.length])}>
              <p className="truncate text-xs text-ink-soft">{s.label}</p>
              <p
                lang={"foreign" in s ? s.foreign : undefined}
                className={cn("mt-0.5 font-display text-2xl text-ink", "foreign" in s && s.foreign && "italic")}
              >
                {s.value}
              </p>
            </li>
          ))}
        </ul>
      </div>
    </Frame>
  );
}

/** One assistant exchange with its Undo button. */
export function AssistantPreview({ dict, locale, today }: PreviewProps) {
  const S = dict.landing.samples;
  const days = { day: weekdayIn(today, 5, locale), day2: weekdayIn(today, 6, locale) };
  return (
    <Frame label={dict.agentChat.title} sample={S.tag}>
      <div className="space-y-3 p-5 sm:p-6">
        <div className="ms-auto max-w-[85%] rounded-3xl rounded-ee-lg bg-lime px-4 py-3 text-sm leading-6 text-lime-on">
          {fmt(S.agent.ask, days)}
        </div>
        <div className="max-w-[90%] rounded-3xl rounded-es-lg border border-line bg-paper px-4 py-3 text-sm leading-6 text-ink-soft">
          {fmt(S.agent.reply, days)}
        </div>
        <div className="flex flex-wrap items-center gap-2.5 rounded-2xl bg-matcha px-3 py-2.5 text-[13px] text-ink">
          <CheckCircle done className="h-6 w-6" />
          <span className="min-w-0 flex-1">{S.agent.status}</span>
          <span className="inline-flex items-center gap-1.5 font-semibold underline underline-offset-4">
            <Undo2 className="h-3.5 w-3.5 rtl:-scale-x-100" aria-hidden />
            {dict.agentChat.undo}
          </span>
        </div>
        <p className="rounded-full border border-line-strong px-4 py-2.5 text-sm text-ink-faint">{S.agent.placeholder}</p>
      </div>
    </Frame>
  );
}
