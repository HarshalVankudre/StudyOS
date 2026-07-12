import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import {
  Activity,
  ArrowUpRight,
  Bot,
  Check,
  Clock3,
  Eye,
  FileCheck2,
  History,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { AccountMenu } from "@/components/account/AccountMenu";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { getAgentCenterSnapshot } from "@/lib/agents/daily-study/store";
import { DAILY_MINUTES_OPTIONS } from "@/lib/agents/daily-study/types";
import type {
  AgentRunData,
  DailyStudyPlanItem,
} from "@/lib/agents/daily-study/types";
import type { Dictionary } from "@/lib/i18n/dictionaries/en";
import { getI18n } from "@/lib/i18n/server";
import { DailyAgentBootstrap } from "./DailyAgentBootstrap";
import { PendingButton } from "./PendingButton";
import { TimezoneInput } from "./TimezoneInput";
import {
  runDailyStudyAgentAction,
  saveDailyStudyAgentConfigAction,
  toggleDailyStudyItemAction,
} from "./actions";

export async function generateMetadata(): Promise<Metadata> {
  const { dict } = await getI18n();
  return { title: dict.agentCenter.metaTitle };
}

export default async function AgentCenterPage() {
  const [snapshot, { dict, t, locale }] = await Promise.all([
    getAgentCenterSnapshot(),
    getI18n(),
  ]);
  const A = dict.agentCenter;
  const { config, plan, runs } = snapshot;
  const totalMinutes = plan?.items.reduce(
    (sum, item) => sum + item.durationMinutes,
    0,
  );
  const completedCount = plan?.items.filter((item) => item.completed).length ?? 0;
  const allDone = Boolean(plan?.items.length) && completedCount === plan?.items.length;

  return (
    <main className="min-h-screen bg-paper text-ink antialiased">
      <DailyAgentBootstrap
        enabled={config.enabled}
        planLocalDate={plan?.localDate ?? null}
        planningLabel={A.running}
      />

      <header className="sticky top-0 z-40 border-b border-line bg-surface/95 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3.5 sm:px-7">
          <Link
            href="/app"
            className="flex shrink-0 items-center gap-1.5 font-display text-lg font-extrabold tracking-tight"
          >
            StudyOS
            <span className="mb-2 h-1.5 w-1.5 rounded-full bg-lime" aria-hidden />
          </Link>
          <div className="flex items-center gap-2">
            <div className="hidden sm:block">
              <ThemeToggle />
            </div>
            <div className="hidden md:block">
              <LanguageSwitcher compact />
            </div>
            <AccountMenu variant="header" />
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-7 sm:py-12">
        <Link
          href="/app"
          className="text-sm font-medium text-ink-soft transition hover:text-ink"
        >
          {A.back}
        </Link>

        <section className="mt-6 flex flex-col gap-6 border-b border-line pb-8 sm:flex-row sm:items-end sm:justify-between">
          <div className="max-w-3xl">
            <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.16em] text-ink-faint">
              <Bot className="h-3.5 w-3.5" aria-hidden />
              {A.eyebrow}
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <h1 className="font-display text-3xl font-bold tracking-tight sm:text-4xl">
                {A.title}
              </h1>
              <Badge variant={config.enabled ? "teal" : "outline"}>
                <span
                  className={`h-1.5 w-1.5 rounded-full ${config.enabled ? "bg-lime-deep" : "bg-ink-faint"}`}
                  aria-hidden
                />
                {config.enabled ? A.enabled : A.paused}
              </Badge>
            </div>
            <p className="mt-3 max-w-2xl text-[15px] leading-7 text-ink-soft">
              {A.subtitle}
            </p>
          </div>
          <form action={runDailyStudyAgentAction}>
            <TimezoneInput initialValue={config.timeZone} />
            <PendingButton
              idleLabel={A.runNow}
              pendingLabel={A.running}
              className="w-full sm:w-auto"
            />
          </form>
        </section>

        <div className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,1.65fr)_minmax(300px,0.8fr)]">
          <Card className="gap-0 overflow-hidden border-line-strong py-0">
            <CardHeader className="border-b border-line px-5 py-5 sm:px-6">
              <CardTitle className="font-display text-xl font-bold">
                {A.todayTitle}
              </CardTitle>
              <CardDescription className="leading-6 text-ink-soft">
                {A.todaySubtitle}
              </CardDescription>
              {plan && (
                <CardAction className="hidden gap-2 sm:flex">
                  <Badge variant="outline">
                    <Clock3 aria-hidden />
                    {t(A.minutes, { count: totalMinutes ?? 0 })}
                  </Badge>
                  <Badge variant="outline">
                    {t(A.sessions, { count: plan.items.length })}
                  </Badge>
                </CardAction>
              )}
            </CardHeader>

            <CardContent className="px-0">
              {!plan ? (
                <EmptyPlan
                  title={A.noPlanTitle}
                  body={A.noPlanBody}
                  runLabel={A.runNow}
                  runningLabel={A.running}
                  timeZone={config.timeZone}
                />
              ) : plan.items.length === 0 ? (
                <div className="px-6 py-14 text-center">
                  <span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-lime-faint text-lime-deep">
                    <Sparkles className="h-5 w-5" aria-hidden />
                  </span>
                  <h2 className="mt-4 font-display text-lg font-bold">
                    {A.clearTitle}
                  </h2>
                  <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-ink-soft">
                    {plan.summary}
                  </p>
                </div>
              ) : (
                <>
                  {allDone && (
                    <div className="mx-5 mt-5 flex items-center gap-2 rounded-md border border-lime/30 bg-lime-faint px-4 py-3 text-sm font-medium sm:mx-6">
                      <Check className="h-4 w-4 text-lime-deep" aria-hidden />
                      {A.allDone}
                    </div>
                  )}
                  <ol className="divide-y divide-line">
                    {plan.items.map((item, index) => (
                      <PlanItem
                        key={item.id}
                        item={item}
                        index={index}
                        planId={plan.id}
                        locale={locale}
                        copy={A}
                      />
                    ))}
                  </ol>
                </>
              )}
            </CardContent>

            {plan && (
              <div className="border-t border-line bg-surface-2 px-5 py-3 font-mono text-[10px] leading-5 text-ink-faint sm:px-6">
                {t(A.scanned, {
                  sources: plan.sourceCount,
                  candidates: plan.candidateCount,
                })}
              </div>
            )}
          </Card>

          <div className="space-y-6">
            <Card className="gap-5 border-line-strong">
              <CardHeader>
                <CardTitle className="font-display text-lg font-bold">
                  {A.settingsTitle}
                </CardTitle>
                <CardDescription className="leading-6 text-ink-soft">
                  {A.settingsSubtitle}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <form action={saveDailyStudyAgentConfigAction} className="space-y-5">
                  <TimezoneInput initialValue={config.timeZone} />
                  <label className="flex cursor-pointer items-start gap-3">
                    <input
                      type="checkbox"
                      name="enabled"
                      defaultChecked={config.enabled}
                      className="mt-0.5 h-4 w-4 rounded border-line-strong accent-lime-deep"
                    />
                    <span>
                      <span className="block text-sm font-semibold text-ink">
                        {A.autoLabel}
                      </span>
                      <span className="mt-1 block text-xs leading-5 text-ink-soft">
                        {A.autoHint}
                      </span>
                    </span>
                  </label>

                  <label className="block">
                    <span className="mb-2 block text-sm font-semibold text-ink">
                      {A.budgetLabel}
                    </span>
                    <select
                      name="dailyMinutes"
                      defaultValue={config.dailyMinutes}
                      className="h-10 w-full rounded-md border border-line-strong bg-surface px-3 text-sm text-ink outline-none transition focus:border-lime-deep focus:ring-2 focus:ring-lime/20"
                    >
                      {DAILY_MINUTES_OPTIONS.map((minutes) => (
                        <option key={minutes} value={minutes}>
                          {t(A.minutes, { count: minutes })}
                        </option>
                      ))}
                    </select>
                  </label>

                  <PendingButton
                    idleLabel={A.save}
                    pendingLabel={A.saving}
                    variant="outline"
                    className="w-full"
                  />
                </form>
              </CardContent>
            </Card>

            <Card className="gap-5 border-line-strong">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 font-display text-lg font-bold">
                  <ShieldCheck className="h-4 w-4 text-lime-deep" aria-hidden />
                  {A.safetyTitle}
                </CardTitle>
                <CardDescription className="leading-6 text-ink-soft">
                  {A.safetySubtitle}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <Boundary icon={<Eye aria-hidden />} label={A.readsLabel} body={A.readsBody} />
                <Boundary
                  icon={<FileCheck2 aria-hidden />}
                  label={A.writesLabel}
                  body={A.writesBody}
                />
                <Boundary
                  icon={<ShieldCheck aria-hidden />}
                  label={A.neverLabel}
                  body={A.neverBody}
                />
              </CardContent>
            </Card>
          </div>
        </div>

        <Card className="mt-6 gap-0 border-line-strong py-0">
          <CardHeader className="border-b border-line px-5 py-5 sm:px-6">
            <CardTitle className="flex items-center gap-2 font-display text-lg font-bold">
              <History className="h-4 w-4" aria-hidden />
              {A.activityTitle}
            </CardTitle>
            <CardDescription className="leading-6 text-ink-soft">
              {A.activitySubtitle}
            </CardDescription>
          </CardHeader>
          <CardContent className="px-0">
            {runs.length === 0 ? (
              <p className="px-6 py-10 text-center text-sm text-ink-soft">
                {A.noActivity}
              </p>
            ) : (
              <ul className="divide-y divide-line">
                {runs.map((run) => (
                  <ActivityRow
                    key={run.id}
                    run={run}
                    locale={locale}
                    timeZone={config.timeZone}
                    copy={A}
                  />
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </main>
  );
}

function EmptyPlan({
  title,
  body,
  runLabel,
  runningLabel,
  timeZone,
}: {
  title: string;
  body: string;
  runLabel: string;
  runningLabel: string;
  timeZone: string;
}) {
  return (
    <div className="px-6 py-14 text-center">
      <span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-surface-2 text-ink-soft">
        <Bot className="h-5 w-5" aria-hidden />
      </span>
      <h2 className="mt-4 font-display text-lg font-bold">{title}</h2>
      <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-ink-soft">{body}</p>
      <form action={runDailyStudyAgentAction} className="mt-5">
        <TimezoneInput initialValue={timeZone} />
        <PendingButton idleLabel={runLabel} pendingLabel={runningLabel} />
      </form>
    </div>
  );
}

function PlanItem({
  item,
  index,
  planId,
  locale,
  copy,
}: {
  item: DailyStudyPlanItem;
  index: number;
  planId: string;
  locale: string;
  copy: Dictionary["agentCenter"];
}) {
  return (
    <li className={`px-5 py-5 sm:px-6 ${item.completed ? "bg-surface-2/70" : ""}`}>
      <div className="flex gap-3 sm:gap-4">
        <span
          className={`mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full border text-[11px] font-bold ${
            item.completed
              ? "border-lime/40 bg-lime-faint text-lime-deep"
              : "border-line-strong bg-surface text-ink-soft"
          }`}
          aria-hidden
        >
          {item.completed ? <Check className="h-3.5 w-3.5" /> : index + 1}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h3
                className={`font-semibold leading-6 ${item.completed ? "text-ink-faint line-through" : "text-ink"}`}
              >
                {item.title}
              </h3>
              <p className="mt-1 text-xs text-ink-faint">{item.source}</p>
            </div>
            <div className="flex shrink-0 flex-wrap gap-1.5">
              <Badge variant="outline">
                <Clock3 aria-hidden />
                {copy.minutes.replace("{count}", String(item.durationMinutes))}
              </Badge>
              {item.dueDate && (
                <Badge variant="outline">
                  {copy.due.replace("{date}", formatDay(item.dueDate, locale))}
                </Badge>
              )}
              {item.dueCount && (
                <Badge variant="outline">
                  {copy.cardsDue.replace("{count}", String(item.dueCount))}
                </Badge>
              )}
            </div>
          </div>
          <p className="mt-3 text-sm leading-6 text-ink-soft">{item.reason}</p>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Button asChild variant="ghost" size="sm">
              <Link href={item.href}>
                {copy.openWorkspace}
                <ArrowUpRight aria-hidden />
              </Link>
            </Button>
            <form action={toggleDailyStudyItemAction}>
              <input type="hidden" name="planId" value={planId} />
              <input type="hidden" name="itemId" value={item.id} />
              <input type="hidden" name="completed" value={String(!item.completed)} />
              <PendingButton
                idleLabel={item.completed ? copy.undoDone : copy.markDone}
                pendingLabel="…"
                variant="outline"
                size="sm"
              />
            </form>
          </div>
        </div>
      </div>
    </li>
  );
}

function Boundary({
  icon,
  label,
  body,
}: {
  icon: ReactNode;
  label: string;
  body: string;
}) {
  return (
    <div className="flex gap-3">
      <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-surface-2 text-ink-soft [&_svg]:h-3.5 [&_svg]:w-3.5">
        {icon}
      </span>
      <div>
        <p className="text-sm font-semibold text-ink">{label}</p>
        <p className="mt-0.5 text-xs leading-5 text-ink-soft">{body}</p>
      </div>
    </div>
  );
}

function ActivityRow({
  run,
  locale,
  timeZone,
  copy,
}: {
  run: AgentRunData;
  locale: string;
  timeZone: string;
  copy: Dictionary["agentCenter"];
}) {
  const statusLabel =
    run.status === "completed"
      ? copy.completedStatus
      : run.status === "failed"
        ? copy.failedStatus
        : copy.runningStatus;

  return (
    <li className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-start sm:justify-between sm:px-6">
      <div className="flex min-w-0 gap-3">
        <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-md bg-surface-2 text-ink-soft">
          <Activity className="h-4 w-4" aria-hidden />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-ink">
            {run.trigger === "auto" ? copy.autoTrigger : copy.manualTrigger}
          </p>
          <p className="mt-1 text-xs leading-5 text-ink-soft">
            {run.summary || run.error || statusLabel}
          </p>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2 pl-11 sm:pl-0">
        <Badge variant={run.status === "failed" ? "destructive" : "outline"}>
          {statusLabel}
        </Badge>
        <time
          dateTime={run.startedAt.toISOString()}
          className="font-mono text-[10px] text-ink-faint"
        >
          {run.startedAt.toLocaleString(locale, {
            dateStyle: "medium",
            timeStyle: "short",
            timeZone,
          })}
        </time>
      </div>
    </li>
  );
}

function formatDay(day: string, locale: string): string {
  return new Date(`${day}T12:00:00.000Z`).toLocaleDateString(locale, {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}
