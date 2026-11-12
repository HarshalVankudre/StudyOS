/**
 * Static renderings of real StudyOS screens for the landing page. They use
 * the app's own dictionary strings and presenters (Today, feeds, study kits,
 * grades), so the wording shown is the wording the product produces, in the
 * visitor's language. Server components, no client JavaScript; nothing in
 * them is interactive, so controls are drawn as plain text, not buttons.
 */
import {
  ArrowUpRight,
  BookOpenCheck,
  CalendarClock,
  CalendarSync,
  Check,
  Clock3,
  FileQuestion,
  FileText,
  Flag,
  GraduationCap,
  Hourglass,
  Layers,
  ListTodo,
  NotebookPen,
  RotateCcw,
  ShieldCheck,
  Snowflake,
  Sparkles,
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
  itemSource,
  itemTitle,
  kindLabel,
  planTotals,
  workloadText,
} from "@/lib/agents/daily-study/present";
import { TODAY_MINUTES_OPTIONS, type DailyStudyPlanItem } from "@/lib/agents/daily-study/types";
import { formatGrade, formatPercent, resolveScale } from "@/lib/grades/scales";
import { outlookText, targetText } from "@/components/workspace/grades/text";
import { studyKitCost } from "@/lib/credits-info";
import { cn } from "@/lib/utils";
import {
  sampleExams,
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

/** Small "Sample" marker so nobody mistakes a rendering for real data. */
export function SampleTag({ label }: { label: string }) {
  return (
    <span className="shrink-0 rounded-full border border-line-strong bg-surface-2 px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.12em] text-ink-soft">
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
    <figure
      className={cn(
        "min-w-0 overflow-hidden rounded-xl border border-line-strong bg-card shadow-pop",
        className,
      )}
    >
      <figcaption className="flex items-center gap-2 border-b border-line bg-surface px-4 py-2.5 text-xs font-semibold text-ink-soft">
        <span className="min-w-0 flex-1 truncate">{label}</span>
        <SampleTag label={sample} />
      </figcaption>
      {children}
    </figure>
  );
}

const KIND_ICON = {
  deadline: NotebookPen,
  exam: GraduationCap,
  flashcards: Layers,
  quiz: FileQuestion,
  task: ListTodo,
} as const;

/** The Today plan the morning after two missed days. */
export function TodayPreview({ dict, locale, today }: PreviewProps) {
  const T = dict.today;
  const S = dict.landing.samples;
  const items = sampleTodayItems(S, today);
  const totals = planTotals(items);
  const carried = items.filter((i) => i.carry).length;
  const percent = Math.round((totals.done / totals.total) * 100);

  return (
    <Frame label={S.workspace} sample={S.tag}>
      <div className="px-4 pb-4 pt-4 sm:px-5">
        <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-ink-faint">
          {formatLongDay(today, locale)}
        </p>
        <div className="mt-1 flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
          <p className="font-display text-[1.6rem] font-bold leading-tight tracking-tight text-ink">
            {T.title}
          </p>
          <p className="pb-1 text-sm font-medium text-ink-soft">
            {fmt(T.progress, { done: totals.done, total: totals.total })}
          </p>
        </div>
        <p className="mt-1 text-sm text-ink-soft">
          {plural(locale, dict.counts.planSummary, totals.total, { time: formatDuration(totals.minutes, T) })}
          <span className="text-ink-faint">
            {" · "}
            {fmt(T.budget, { time: formatDuration(120, T) })}
          </span>
        </p>
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-surface-2" aria-hidden>
          <div className="h-full rounded-full bg-lime" style={{ width: `${percent}%` }} />
        </div>
      </div>

      <div className="flex gap-3 border-t border-line bg-lime-faint/60 px-4 py-3 text-sm leading-6 text-ink-soft sm:px-5">
        <Sparkles className="mt-1 h-4 w-4 shrink-0 text-lime-deep" aria-hidden />
        <div className="min-w-0">
          <p className="font-medium text-ink">{T.welcomeBack}</p>
          <p className="mt-0.5">{plural(locale, dict.counts.carried, carried)}</p>
        </div>
      </div>

      <ol className="divide-y divide-line border-t border-line">
        {items.map((item) => (
          <TodayRow key={item.id} item={item} dict={dict} locale={locale} />
        ))}
      </ol>

      <p className="flex items-center gap-1.5 border-t border-line bg-surface-2 px-4 py-3 text-[11px] text-ink-soft sm:px-5">
        <CalendarClock className="h-3.5 w-3.5 shrink-0" aria-hidden />
        {T.free}
      </p>
    </Frame>
  );
}

function TodayRow({ item, dict, locale }: { item: DailyStudyPlanItem; dict: Dictionary; locale: string }) {
  const T = dict.today;
  const Icon = KIND_ICON[item.kind];
  const done = item.completed;
  const notes = itemNotes(item, T, locale);
  return (
    <li className={cn("flex gap-3 px-4 py-3 sm:px-5", done && "bg-surface-2/60")}>
      <span
        className={cn(
          "mt-1 grid h-6 w-6 shrink-0 place-items-center rounded-full border-2",
          done ? "border-lime bg-lime text-lime-on" : "border-line-strong bg-surface text-transparent",
        )}
        aria-hidden
      >
        <Check className="h-3.5 w-3.5" strokeWidth={3} />
      </span>
      <div className="min-w-0 flex-1">
        {item.startHere && !done && (
          <span className="mb-1 inline-flex items-center rounded-full bg-lime-faint px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-lime-deep">
            {T.startHere}
          </span>
        )}
        <p
          className={cn(
            "flex items-start gap-1 text-[15px] font-semibold leading-6",
            done ? "text-ink-faint line-through decoration-ink-faint/60" : "text-ink",
          )}
        >
          <span className="min-w-0 break-words">{itemTitle(item, T)}</span>
          <ArrowUpRight className="mt-1 h-4 w-4 shrink-0 text-ink-faint rtl:-scale-x-100" aria-hidden />
        </p>
        {!done && <p className="mt-0.5 text-sm leading-6 text-ink-soft">{itemReason(item, T, locale)}</p>}
        {!done && notes.length > 0 && (
          <p className="mt-0.5 text-xs leading-5 text-ink-faint">{notes.join(" ")}</p>
        )}
        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-faint">
          <span className="inline-flex items-center gap-1 font-medium text-ink-soft">
            <Clock3 className="h-3.5 w-3.5" aria-hidden />
            {formatDuration(item.minutes, T)}
          </span>
          <span className="inline-flex items-center gap-1">
            <Icon className="h-3.5 w-3.5" aria-hidden />
            {kindLabel(item, T)}
          </span>
          {item.dueDate && item.kind === "deadline" && (
            <span>{fmt(T.due, { date: formatDay(item.dueDate, locale) })}</span>
          )}
          {item.dueCount ? (
            <span className="inline-flex items-center gap-1 tabular-nums">
              <BookOpenCheck className="h-3.5 w-3.5" aria-hidden />
              {fmt(T.cardsProgress, { done: 0, total: item.dueCount })}
            </span>
          ) : null}
          <span className="min-w-0 max-w-full truncate">{itemSource(item)}</span>
        </div>
      </div>
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
      <div className="flex gap-3 bg-amber-400/10 px-4 py-3 text-sm leading-6 text-ink-soft sm:px-5">
        <Hourglass className="mt-1 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden />
        <div className="min-w-0">
          <p className="font-medium text-ink">{workload.title}</p>
          <p className="mt-0.5">{workload.body}</p>
          {workload.start && <p className="mt-0.5">{workload.start}</p>}
        </div>
      </div>
      <div className="border-t border-line px-4 py-3 sm:px-5">
        <p className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-ink-faint">
          <GraduationCap className="h-3.5 w-3.5" aria-hidden />
          {T.examsTitle}
        </p>
        <ul className="mt-2 flex flex-wrap gap-2">
          {exams.map((exam) => (
            <li
              key={exam.id}
              className="flex min-h-10 max-w-full items-center gap-2 rounded-full border border-line-strong bg-surface px-3 text-xs text-ink-soft"
            >
              <span className="min-w-0 truncate font-medium text-ink">{exam.title}</span>
              <span className="shrink-0 rounded-full bg-surface-2 px-2 py-0.5 font-semibold tabular-nums text-ink-soft">
                {examCountdownLabel(exam, T, locale)}
              </span>
              <span className="sr-only">{formatDay(exam.date, locale)}</span>
            </li>
          ))}
        </ul>
      </div>
      <div className="border-t border-line bg-surface-2 px-4 py-3 sm:px-5">
        <p className="inline-flex items-center gap-2 text-sm font-semibold text-ink">
          <RotateCcw className="h-4 w-4 rtl:-scale-x-100" aria-hidden />
          {T.rebuildTitle}
        </p>
        <p className="mt-1 text-sm text-ink-soft">{T.rebuildQuestion}</p>
        <ul className="mt-2 flex flex-wrap gap-2">
          {choices.map((label, i) => (
            <li
              key={label}
              className={cn(
                "flex min-h-9 items-center rounded-full border px-3.5 text-sm",
                i === 1
                  ? "border-lime bg-lime-faint font-semibold text-ink"
                  : "border-line-strong bg-surface text-ink-soft",
              )}
            >
              {label}
            </li>
          ))}
        </ul>
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
  const rows = [
    { name: F.platform.canvas, when: rtf.format(-2, "hour"), changes: fmt(F.lastChanges, { summary }) },
    { name: F.platform.moodle, when: rtf.format(-1, "day"), changes: fmt(F.lastChanges, { summary: F.noChanges }) },
  ];
  const platforms = [
    F.platform.canvas,
    F.platform.moodle,
    F.platform.blackboard,
    F.platform.brightspace,
    F.platform.google,
  ];

  return (
    <Frame label={F.connectedTitle} sample={S.tag}>
      <ul className="divide-y divide-line">
        {rows.map((row) => (
          <li key={row.name} className="flex items-start gap-3 px-4 py-3 sm:px-5">
            <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-lime-faint text-lime-deep">
              <CalendarSync className="h-4 w-4" aria-hidden />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-ink">{row.name}</p>
              <p className="text-xs text-ink-faint">{fmt(F.lastSynced, { when: row.when })}</p>
              <p className="mt-0.5 text-xs text-ink-soft">{row.changes}</p>
            </div>
          </li>
        ))}
      </ul>
      <div className="border-t border-line bg-amber-400/10 px-4 py-3 sm:px-5">
        <p className="flex items-center gap-1.5 text-sm font-semibold text-ink">
          <Flag className="h-4 w-4 text-amber-600 dark:text-amber-400" aria-hidden />
          {F.flaggedTitle}
        </p>
        <p className="mt-0.5 text-xs leading-5 text-ink-soft">{F.flaggedHint}</p>
        <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg border border-line bg-card px-3 py-2">
          <span className="min-w-0 flex-1 truncate text-sm text-ink">{S.items.reading}</span>
          <span className="rounded-md border border-line-strong px-2.5 py-1 text-xs font-semibold text-ink">
            {F.keep}
          </span>
          <span className="rounded-md px-2.5 py-1 text-xs font-semibold text-ink-soft">{F.remove}</span>
        </div>
      </div>
      <p className="border-t border-line px-4 py-3 text-[11px] leading-5 text-ink-faint sm:px-5">
        {platforms.join(" · ")}
      </p>
    </Frame>
  );
}

/** A study-kit flashcard with its page label and the checked quote. */
export function StudyKitPreview({ dict, locale }: Omit<PreviewProps, "today">) {
  const M = dict.materials;
  const S = dict.landing.samples;
  const page = (n: number) => fmt(dict.quiz.sourcePage, { page: n });
  const cost = studyKitCost(3);

  return (
    <Frame label={fmt(M.kitPageTitle, { title: S.card.material })} sample={S.tag}>
      <div className="space-y-3 p-4 sm:p-5">
        <div className="rounded-lg border border-line-strong bg-surface p-4">
          <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-faint">{M.kitFlashcards}</p>
          <p className="mt-2 text-[15px] font-semibold leading-6 text-ink">{S.card.front}</p>
          <p className="mt-2 border-t border-line pt-2 text-sm leading-6 text-ink-soft">{S.card.back}</p>
          <span className="mt-3 inline-flex max-w-full items-center gap-1 rounded-full border border-line bg-card px-2 py-0.5 text-[11px] font-medium text-ink-soft">
            <FileText className="size-3 shrink-0" aria-hidden />
            <span className="truncate">{page(14)}</span>
          </span>
        </div>

        <div className="rounded-lg border border-line bg-surface-2 p-4">
          <p className="text-xs font-semibold text-ink-soft">
            {S.card.material} · {fmt(M.viewerPage, { page: 14, count: 38 })}
          </p>
          <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.12em] text-ink-soft">{M.viewerQuote}</p>
          <p className="mt-1 text-sm leading-6 text-ink">
            <mark className="rounded bg-lime-faint px-0.5 text-ink">{S.card.quote}</mark>
          </p>
        </div>

        <div className="flex items-start gap-2 rounded-lg border border-line bg-surface p-3 text-sm text-ink">
          <FileQuestion className="mt-0.5 h-4 w-4 shrink-0 text-ink-faint" aria-hidden />
          <span className="min-w-0 flex-1">{S.card.question}</span>
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-line bg-card px-2 py-0.5 text-[11px] font-medium text-ink-soft">
            <FileText className="size-3" aria-hidden />
            {page(15)}
          </span>
        </div>

        <div className="space-y-1.5 text-xs leading-5 text-ink-soft">
          <p className="flex items-start gap-1.5">
            <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-lime-deep" aria-hidden />
            {plural(locale, M.doneDropped, 3)}
          </p>
          <p className="flex items-start gap-1.5">
            <Clock3 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ink-faint" aria-hidden />
            {plural(locale, M.cost, cost.estimate, { max: cost.max.toLocaleString(locale) })}{" "}
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
      <div className="space-y-3 p-4 sm:p-5">
        <p className="flex items-start gap-2 text-sm leading-6 text-ink">
          <Snowflake className="mt-1 h-4 w-4 shrink-0 text-lime-deep" aria-hidden />
          {fmt(ST.freezeUsed, { day: weekdayIn(today, -2, locale) })}
        </p>
        <div className="flex flex-wrap gap-2 text-xs">
          <span className="rounded-full border border-line-strong bg-surface px-3 py-1 font-semibold text-ink">
            {fmt(ST.freezes, { count: 1 })}
          </span>
          <span className="rounded-full border border-line bg-surface-2 px-3 py-1 text-ink-soft">
            {fmt(ST.towardFreeze, { count: 4, total: 7 })}
          </span>
        </div>
        <p className="rounded-lg bg-surface-2 px-3 py-2 text-xs text-ink-soft">{ST.practiceBanner}</p>
      </div>
    </Frame>
  );
}

/** A course with three of four grades in, computed with the real grade math. */
export function GradesPreview({ dict, locale }: Omit<PreviewProps, "today">) {
  const G = dict.grades;
  const S = dict.landing.samples;
  const { rows, grade, target } = sampleGrade(S);
  const us = resolveScale("us_letter");
  const scales = [
    { label: G.presets.us_letter, value: formatGrade(grade.current ?? 0, resolveScale("us_letter"), locale) },
    { label: G.presets.uk_degree, value: formatGrade(grade.current ?? 0, resolveScale("uk_degree", undefined, G.uk), locale) },
    { label: G.presets.de_grade, value: formatGrade(grade.current ?? 0, resolveScale("de_grade"), locale) },
  ];

  return (
    <Frame label={`${G.defaultTitle} · ${S.grades.course}`} sample={S.tag}>
      <div className="p-4 sm:p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="font-display text-lg font-bold text-ink">{S.grades.course}</p>
          <p className="text-sm text-ink-soft">
            {G.target}: <span className="font-semibold text-ink">{targetText(target, us, locale)}</span>
          </p>
        </div>
        <table className="mt-3 w-full border-collapse text-sm">
          <tbody>
            {rows.map((row) => (
              <tr key={row.name} className="border-t border-line">
                <td className="py-2 pe-2 text-ink">{row.name}</td>
                <td className="py-2 pe-2 text-end text-xs text-ink-faint">
                  {fmt(G.weightOf, { weight: formatPercent(row.weight, locale) })}
                </td>
                <td className="w-16 py-2 text-end font-semibold tabular-nums text-ink">
                  {row.score === null ? "—" : formatPercent(row.score, locale)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-3 rounded-lg bg-lime-faint px-3 py-2.5 text-sm font-medium leading-6 text-ink">
          {outlookText(grade, target, us, locale, G, fmt)}
        </p>
        <p className="mt-4 font-mono text-[10px] uppercase tracking-[0.12em] text-ink-faint">{S.grades.scales}</p>
        <ul className="mt-2 grid gap-2 sm:grid-cols-3">
          {scales.map((s) => (
            <li key={s.label} className="rounded-lg border border-line bg-surface px-3 py-2">
              <p className="truncate text-[11px] text-ink-faint">{s.label}</p>
              <p className="font-display text-xl font-bold text-ink">{s.value}</p>
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
      <div className="space-y-4 p-4 sm:p-5">
        <div className="ms-auto max-w-[85%] rounded-2xl rounded-ee-sm bg-lime px-4 py-3 text-sm leading-6 text-lime-on">
          {fmt(S.agent.ask, days)}
        </div>
        <div className="max-w-[90%] rounded-2xl rounded-es-sm border border-line bg-surface px-4 py-3 text-sm leading-6 text-ink-soft">
          {fmt(S.agent.reply, days)}
        </div>
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-line bg-surface-2 px-3 py-2 text-xs text-ink-soft">
          <span className="h-1.5 w-1.5 rounded-full bg-lime" aria-hidden />
          <span className="min-w-0 flex-1">{S.agent.status}</span>
          <span className="inline-flex items-center gap-1 rounded-md border border-line-strong bg-card px-2.5 py-1 font-semibold text-ink">
            <Undo2 className="h-3.5 w-3.5 rtl:-scale-x-100" aria-hidden />
            {dict.agentChat.undo}
          </span>
        </div>
      </div>
      <p className="mx-4 mb-4 rounded-xl border border-line-strong bg-surface px-3 py-2.5 text-xs text-ink-faint sm:mx-5">
        {S.agent.placeholder}
      </p>
    </Frame>
  );
}
