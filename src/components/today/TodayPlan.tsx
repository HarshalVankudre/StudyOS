"use client";

import Link from "next/link";
import { useOptimistic, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CalendarClock, CalendarDays, Check, GraduationCap, Hourglass, Settings2, Sparkles } from "lucide-react";
import { rebuildTodayAction, setTodayItemAction } from "@/app/app/agents/actions";
import { useI18n } from "@/lib/i18n/client";
import { fmt } from "@/lib/i18n/interpolate";
import type { DailyStudyPlanItem, TodayPlanView } from "@/lib/agents/daily-study/types";
import {
  examContext,
  examCountdownLabel,
  formatDuration,
  formatLongDay,
  planTotals,
  workloadText,
  type TodayCopy,
} from "@/lib/agents/daily-study/present";
import { dayDiff } from "@/lib/workspace/view-logic";
import { workspaceHref } from "@/lib/workspace/deep-link";
import { cn } from "@/lib/utils";
import { NotificationPrompt } from "@/components/notifications/NotificationPrompt";
import type { FocusSummary } from "@/lib/study/focus";
import { FocusStrip } from "./FocusStrip";
import { ProgressRing } from "./ProgressRing";
import { TodayItem } from "./TodayItem";
import { RebuildPanel } from "./RebuildPanel";

export interface TodayPlanProps {
  plan: TodayPlanView | null;
  dailyMinutes: number;
  /** "home" links to the Agent Center for settings; "center" is the Agent Center. */
  variant?: "home" | "center";
  /**
   * Focus time to show under the header, with the "Start a focus session"
   * button (undefined: no focus strip; null: it could not be loaded).
   */
  focus?: FocusSummary | null;
}

type ItemChange = { id: string; completed: boolean };

function browserTimeZone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
  } catch {
    return undefined;
  }
}

/**
 * "Today": the student's plan for their local day. A short list that fits
 * their time, each item with a time estimate, a reason, a checkbox and a link
 * to the exact page, block or row. Calm on purpose: no red, no streak guilt.
 */
export function TodayPlan({ plan, dailyMinutes, variant = "home", focus }: TodayPlanProps) {
  const { dict, locale } = useI18n();
  const T = dict.today;
  const router = useRouter();
  const [, startTransition] = useTransition();

  const [items, applyChange] = useOptimistic(
    plan?.items ?? [],
    (current: DailyStudyPlanItem[], change: ItemChange) =>
      current.map((item) => (item.id === change.id ? { ...item, completed: change.completed } : item)),
  );

  const setItem = (item: DailyStudyPlanItem, completed: boolean, finish = false) => {
    if (!plan) return;
    startTransition(async () => {
      applyChange({ id: item.id, completed });
      try {
        const result = await setTodayItemAction({ planId: plan.id, itemId: item.id, completed, finish });
        if (!result.ok) {
          toast(result.reason === "conflict" ? T.conflict : T.saveFailed);
        } else if (result.wroteThrough) {
          toast(completed ? T.doneSynced : T.reopenedSynced);
        }
      } catch {
        toast(T.saveFailed);
      }
      router.refresh();
    });
  };

  const rebuild = async (minutes?: number) => {
    try {
      const result = await rebuildTodayAction({ timeZone: browserTimeZone(), minutes });
      if (!result.ok) toast(T.saveFailed);
    } catch {
      // Offline, or the app was updated meanwhile: an error thrown inside the
      // caller's transition would replace the whole page with the error screen.
      toast(T.saveFailed);
    }
    router.refresh();
  };

  return (
    <section
      aria-labelledby="today-title"
      className="overflow-hidden rounded-3xl border border-line bg-card"
    >
      {plan ? (
        <PlanBody
          plan={plan}
          items={items}
          T={T}
          locale={locale}
          dailyMinutes={dailyMinutes}
          variant={variant}
          onSetItem={setItem}
          onRebuild={rebuild}
          focusStrip={focus !== undefined && <FocusStrip summary={focus} className="mx-5 mb-4 sm:mx-7" />}
        />
      ) : (
        <NoPlan
          T={T}
          onPlan={() => rebuild()}
          focusStrip={focus !== undefined && <FocusStrip summary={focus} quiet className="mt-8 text-start" />}
        />
      )}
      {/* Offers notifications once; renders nothing when they are on, unavailable or declined. */}
      <NotificationPrompt />
    </section>
  );
}

function PlanBody({
  plan,
  items,
  T,
  locale,
  dailyMinutes,
  variant,
  onSetItem,
  onRebuild,
  focusStrip,
}: {
  plan: TodayPlanView;
  items: DailyStudyPlanItem[];
  T: TodayCopy;
  locale: string;
  dailyMinutes: number;
  variant: "home" | "center";
  onSetItem: (item: DailyStudyPlanItem, completed: boolean, finish?: boolean) => void;
  onRebuild: (minutes?: number) => Promise<void>;
  focusStrip: React.ReactNode;
}) {
  const { dict, plural } = useI18n();
  const totals = planTotals(items);
  const { details } = plan;
  // On the home screen "Today" is the page's main heading.
  const Heading = variant === "home" ? "h1" : "h2";
  const allDone = totals.total > 0 && totals.done === totals.total;
  const missedDays = details.previousDate ? dayDiff(details.previousDate, plan.localDate) >= 2 : false;
  const carried = details.carried ?? 0;
  const workload = details.workload?.overloaded ? workloadText(details.workload, T, locale) : null;
  const progress = fmt(T.progress, { done: totals.done, total: totals.total });

  return (
    <>
      <header className="flex items-start justify-between gap-4 px-5 pb-5 pt-6 sm:px-7">
        <div className="min-w-0">
          <p className="inline-flex whitespace-nowrap rounded-full bg-lime px-3 py-1 text-[13px] font-semibold text-lime-on sm:text-sm">
            {formatLongDay(plan.localDate, locale)}
          </p>
          <Heading id="today-title" className="mt-3 font-display text-5xl leading-none sm:text-6xl">
            {T.title}
          </Heading>
          {totals.total > 0 && (
            <p className="mt-3 text-[15px] leading-6 text-ink-soft">
              {plural(dict.counts.planSummary, totals.total, {
                time: formatDuration(totals.minutes, T),
              })}
              <span className="text-ink-faint">
                {" · "}
                {fmt(details.budgetOverride ? T.budgetToday : T.budget, {
                  time: formatDuration(details.budgetMinutes, T),
                })}
              </span>
            </p>
          )}
        </div>
        {totals.total > 0 && (
          <div className="shrink-0 text-center">
            <ProgressRing done={totals.done} total={totals.total} label={T.sectionLabel} caption={progress} size={112} />
            <p className="mt-1.5 text-xs text-ink-faint" aria-live="polite">
              {progress}
            </p>
          </div>
        )}
      </header>

      {focusStrip}

      {(missedDays || carried > 0) && (
        <Notice tone="calm" icon={<Sparkles className="h-4 w-4" aria-hidden />}>
          {missedDays && <p className="font-medium text-ink">{T.welcomeBack}</p>}
          {carried > 0 && (
            <p className={cn(missedDays && "mt-0.5")}>
              {plural(dict.counts.carried, carried)}
            </p>
          )}
        </Notice>
      )}

      {workload && (
        <Notice tone="heads-up" icon={<Hourglass className="h-4 w-4" aria-hidden />}>
          <p className="font-medium text-ink">{workload.title}</p>
          <p className="mt-0.5">{workload.body}</p>
          {workload.start && <p className="mt-0.5">{workload.start}</p>}
          <Link
            href="/app/agents#settings"
            className="mt-1.5 inline-flex min-h-9 items-center text-xs font-semibold text-ink underline-offset-4 hover:underline"
          >
            {T.overloadSettings}
          </Link>
        </Notice>
      )}

      {details.exams.length > 0 && (
        <div className="px-5 pb-5 sm:px-7">
          <h3 className="flex items-center gap-2 font-display text-xl text-ink">
            <GraduationCap className="h-5 w-5" aria-hidden />
            {T.examsTitle}
          </h3>
          <ul className="mt-3 grid gap-2 sm:grid-cols-2">
            {details.exams.map((exam, i) => {
              const context = examContext(exam, details.exams);
              return (
              <li key={exam.id} className="min-w-0 max-w-full">
                <Link
                  href={workspaceHref(exam.target)}
                  className={cn(
                    "flex min-h-12 max-w-full items-center gap-2 rounded-2xl px-4 py-2.5 text-sm text-ink-soft transition hover:brightness-[0.97]",
                    i % 2 === 0 ? "bg-cloud" : "bg-matcha",
                  )}
                >
                  <span dir="auto" className="min-w-0 truncate font-display text-[17px] text-ink">{exam.title}</span>
                  {context && (
                    <span dir="auto" className="min-w-0 max-w-[12rem] truncate text-ink-soft">
                      <span aria-hidden>· </span>
                      {context}
                    </span>
                  )}
                  <span
                    className={cn(
                      "ms-auto shrink-0 tabular-nums",
                      exam.days <= 3 ? "font-semibold text-ink" : "text-ink-soft",
                    )}
                  >
                    {examCountdownLabel(exam, T, locale)}
                  </span>
                </Link>
              </li>
              );
            })}
          </ul>
        </div>
      )}

      {totals.total === 0 ? (
        <div className="px-5 pb-10 pt-4 text-center sm:px-7">
          <span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-matcha text-ink">
            <Sparkles className="h-5 w-5" aria-hidden />
          </span>
          <h3 className="mt-4 font-display text-2xl">{T.clearTitle}</h3>
          <p className="mx-auto mt-1 max-w-sm text-sm leading-6 text-ink-soft">{T.clearBody}</p>
        </div>
      ) : (
        <>
          {allDone && (
            <div className="mx-5 mb-3 flex items-start gap-3 rounded-2xl bg-matcha px-4 py-3.5 sm:mx-7" role="status">
              <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full bg-lime text-lime-on">
                <Check className="h-4 w-4" aria-hidden />
              </span>
              <div>
                <p className="font-semibold text-ink">{T.allDoneTitle}</p>
                <p className="text-sm text-ink-soft">{T.allDoneBody}</p>
              </div>
            </div>
          )}
          <ol className="space-y-2.5 px-5 pb-5 sm:px-7" aria-label={T.sectionLabel}>
            {items.map((item) => (
              <TodayItem key={item.id} item={item} T={T} locale={locale} onSet={onSetItem} />
            ))}
          </ol>
        </>
      )}

      <footer className="border-t border-line px-5 py-3 sm:px-7">
        <RebuildPanel
          T={T}
          dailyMinutes={dailyMinutes}
          onRebuild={onRebuild}
        />
        <div className="mt-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
          <p className="flex items-center gap-1.5 text-[11px] text-ink-faint">
            <CalendarClock className="h-3.5 w-3.5 shrink-0" aria-hidden />
            {T.free}
          </p>
          <div className="flex flex-wrap items-center gap-x-4">
            <Link
              href="/app/agenda"
              className="inline-flex min-h-9 items-center gap-1.5 text-xs font-semibold text-ink-soft transition hover:text-ink"
            >
              <CalendarDays className="h-3.5 w-3.5" aria-hidden />
              {dict.agenda.seeNext}
            </Link>
            {variant === "home" && (
              <Link
                href="/app/agents"
                className="inline-flex min-h-9 items-center gap-1.5 text-xs font-semibold text-ink-soft transition hover:text-ink"
              >
                <Settings2 className="h-3.5 w-3.5" aria-hidden />
                {T.settingsLink}
              </Link>
            )}
          </div>
        </div>
      </footer>
    </>
  );
}

function Notice({
  tone,
  icon,
  children,
}: {
  tone: "calm" | "heads-up";
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "mx-5 mb-3 flex gap-3 rounded-2xl px-4 py-3 text-sm leading-6 text-ink-soft sm:mx-7",
        tone === "calm" ? "bg-matcha" : "bg-oat",
      )}
    >
      <span
        className={cn(
          "grid h-7 w-7 shrink-0 place-items-center rounded-full",
          tone === "calm" ? "bg-lime text-lime-on" : "bg-card text-ink",
        )}
      >
        {icon}
      </span>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

function NoPlan({
  T,
  onPlan,
  focusStrip,
}: {
  T: TodayCopy;
  onPlan: () => Promise<void>;
  focusStrip: React.ReactNode;
}) {
  const [pending, startTransition] = useTransition();
  return (
    <div className="px-5 py-10 text-center sm:px-7">
      <h2 id="today-title" className="font-display text-4xl">
        {T.noPlanTitle}
      </h2>
      <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-ink-soft">{T.noPlanBody}</p>
      <button
        type="button"
        disabled={pending}
        onClick={() => startTransition(onPlan)}
        className="mt-6 inline-flex min-h-12 items-center justify-center gap-2 rounded-full bg-lime px-6 text-[15px] font-semibold text-lime-on transition hover:bg-lime-hover disabled:opacity-60"
      >
        {pending && (
          <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-r-transparent" aria-hidden />
        )}
        {pending ? T.planning : T.planToday}
      </button>
      <p className="mt-3 text-[11px] text-ink-faint">{T.free}</p>
      {focusStrip}
    </div>
  );
}
