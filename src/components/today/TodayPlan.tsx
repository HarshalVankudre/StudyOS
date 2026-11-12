"use client";

import Link from "next/link";
import { useOptimistic, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CalendarClock, Check, GraduationCap, Hourglass, Settings2, Sparkles } from "lucide-react";
import { rebuildTodayAction, setTodayItemAction } from "@/app/app/agents/actions";
import { useI18n } from "@/lib/i18n/client";
import { fmt } from "@/lib/i18n/interpolate";
import type { DailyStudyPlanItem, TodayPlanView } from "@/lib/agents/daily-study/types";
import {
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
import { TodayItem } from "./TodayItem";
import { RebuildPanel } from "./RebuildPanel";

export interface TodayPlanProps {
  plan: TodayPlanView | null;
  dailyMinutes: number;
  /** "home" links to the Agent Center for settings; "center" is the Agent Center. */
  variant?: "home" | "center";
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
export function TodayPlan({ plan, dailyMinutes, variant = "home" }: TodayPlanProps) {
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
    const result = await rebuildTodayAction({ timeZone: browserTimeZone(), minutes });
    if (!result.ok) toast(T.saveFailed);
    router.refresh();
  };

  return (
    <section
      aria-labelledby="today-title"
      className="overflow-hidden rounded-md border border-line-strong bg-card shadow-pop"
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
        />
      ) : (
        <NoPlan T={T} onPlan={() => rebuild()} />
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
}: {
  plan: TodayPlanView;
  items: DailyStudyPlanItem[];
  T: TodayCopy;
  locale: string;
  dailyMinutes: number;
  variant: "home" | "center";
  onSetItem: (item: DailyStudyPlanItem, completed: boolean, finish?: boolean) => void;
  onRebuild: (minutes?: number) => Promise<void>;
}) {
  const { dict, plural } = useI18n();
  const totals = planTotals(items);
  const { details } = plan;
  // On the home screen "Today" is the page's main heading.
  const Heading = variant === "home" ? "h1" : "h2";
  const allDone = totals.total > 0 && totals.done === totals.total;
  const missedDays = details.previousDate ? dayDiff(details.previousDate, plan.localDate) >= 2 : false;
  const carried = details.carried ?? 0;
  const workload = details.workload?.overloaded ? workloadText(details.workload, T) : null;
  const percent = totals.total ? Math.round((totals.done / totals.total) * 100) : 0;

  return (
    <>
      <header className="px-4 pb-4 pt-5 sm:px-6">
        <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-ink-faint">
          {formatLongDay(plan.localDate, locale)}
        </p>
        <div className="mt-1 flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
          <Heading id="today-title" className="font-display text-[1.75rem] font-bold leading-tight tracking-tight">
            {T.title}
          </Heading>
          {totals.total > 0 && (
            <p className="pb-1 text-sm font-medium text-ink-soft" aria-live="polite">
              {fmt(T.progress, { done: totals.done, total: totals.total })}
            </p>
          )}
        </div>
        {totals.total > 0 && (
          <>
            <p className="mt-1 text-sm text-ink-soft">
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
            <div
              className="mt-3 h-1.5 overflow-hidden rounded-full bg-surface-2"
              role="progressbar"
              aria-label={T.sectionLabel}
              aria-valuemin={0}
              aria-valuemax={totals.total}
              aria-valuenow={totals.done}
            >
              <div
                className="h-full rounded-full bg-lime transition-[width] duration-500"
                style={{ width: `${percent}%` }}
              />
            </div>
          </>
        )}
      </header>

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
        <div className="border-t border-line px-4 py-3 sm:px-6">
          <h3 className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-ink-faint">
            <GraduationCap className="h-3.5 w-3.5" aria-hidden />
            {T.examsTitle}
          </h3>
          <ul className="mt-2 flex flex-wrap gap-2">
            {details.exams.map((exam) => (
              <li key={exam.id} className="min-w-0 max-w-full">
                <Link
                  href={workspaceHref(exam.target)}
                  className="flex min-h-10 max-w-full items-center gap-2 rounded-full border border-line-strong bg-surface px-3 text-xs text-ink-soft transition hover:bg-hover hover:text-ink"
                >
                  <span dir="auto" className="min-w-0 truncate font-medium text-ink">{exam.title}</span>
                  <span
                    className={cn(
                      "shrink-0 rounded-full px-2 py-0.5 font-semibold tabular-nums",
                      exam.days <= 3 ? "bg-lime-faint text-lime-deep" : "bg-surface-2 text-ink-soft",
                    )}
                  >
                    {examCountdownLabel(exam, T)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      {totals.total === 0 ? (
        <div className="border-t border-line px-4 py-10 text-center sm:px-6">
          <span className="mx-auto grid h-11 w-11 place-items-center rounded-full bg-lime-faint text-lime-deep">
            <Sparkles className="h-5 w-5" aria-hidden />
          </span>
          <h3 className="mt-3 font-display text-lg font-bold">{T.clearTitle}</h3>
          <p className="mx-auto mt-1 max-w-sm text-sm leading-6 text-ink-soft">{T.clearBody}</p>
        </div>
      ) : (
        <>
          {allDone && (
            <div className="flex items-start gap-3 border-t border-line bg-lime-faint px-4 py-4 sm:px-6" role="status">
              <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full bg-lime text-lime-on">
                <Check className="h-4 w-4" aria-hidden />
              </span>
              <div>
                <p className="font-semibold text-ink">{T.allDoneTitle}</p>
                <p className="text-sm text-ink-soft">{T.allDoneBody}</p>
              </div>
            </div>
          )}
          <ol className="divide-y divide-line border-t border-line" aria-label={T.sectionLabel}>
            {items.map((item) => (
              <TodayItem key={item.id} item={item} T={T} locale={locale} onSet={onSetItem} />
            ))}
          </ol>
        </>
      )}

      <footer className="border-t border-line bg-surface-2 px-4 py-3 sm:px-6">
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
        "flex gap-3 border-t border-line px-4 py-3 text-sm leading-6 text-ink-soft sm:px-6",
        tone === "calm" ? "bg-lime-faint/60" : "bg-amber-400/10",
      )}
    >
      <span
        className={cn(
          "mt-1 shrink-0",
          tone === "calm" ? "text-lime-deep" : "text-amber-600 dark:text-amber-400",
        )}
      >
        {icon}
      </span>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

function NoPlan({ T, onPlan }: { T: TodayCopy; onPlan: () => Promise<void> }) {
  const [pending, startTransition] = useTransition();
  return (
    <div className="px-4 py-8 text-center sm:px-6">
      <h2 id="today-title" className="font-display text-[1.6rem] font-bold tracking-tight">
        {T.noPlanTitle}
      </h2>
      <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-ink-soft">{T.noPlanBody}</p>
      <button
        type="button"
        disabled={pending}
        onClick={() => startTransition(onPlan)}
        className="mt-5 inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-ink px-5 text-sm font-semibold text-paper shadow-card transition hover:opacity-90 disabled:opacity-60"
      >
        {pending && (
          <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-r-transparent" aria-hidden />
        )}
        {pending ? T.planning : T.planToday}
      </button>
      <p className="mt-3 text-[11px] text-ink-faint">{T.free}</p>
    </div>
  );
}
