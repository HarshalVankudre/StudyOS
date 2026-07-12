import type { Metadata } from "next";
import { auth } from "@clerk/nextjs/server";
import Link from "next/link";
import { ArrowRight, Bot, Check, Clock3 } from "lucide-react";
import { getDailyStudyAgentOverview } from "@/lib/agents/daily-study/store";
import { isPro, reconcileCheckoutSession } from "@/lib/billing";
import { getCreditBalance } from "@/lib/credits";
import { listWorkspaces } from "@/lib/workspace/store";
import { getI18n } from "@/lib/i18n/server";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { ThemeToggle } from "@/components/ThemeToggle";
import { AccountMenu } from "@/components/account/AccountMenu";
import { CreditChip } from "@/components/account/CreditChip";
import { loadDemoAction } from "./actions";
import { manageBillingAction } from "./billing-actions";
import { DeleteWorkspaceButton } from "./DeleteWorkspaceButton";
import { DailyAgentBootstrap } from "./agents/DailyAgentBootstrap";
import { PendingButton } from "./agents/PendingButton";
import { TimezoneInput } from "./agents/TimezoneInput";
import { runDailyStudyAgentAction } from "./agents/actions";

export async function generateMetadata(): Promise<Metadata> {
  const { dict } = await getI18n();
  return { title: dict.meta.appTitle };
}

export default async function AppHome({
  searchParams,
}: {
  searchParams: Promise<{
    session_id?: string;
    upgraded?: string;
    credits?: string;
  }>;
}) {
  const sp = await searchParams;
  if (sp.session_id) await reconcileCheckoutSession(sp.session_id);

  const { userId } = await auth();
  const [pro, workspaces, credits, agent, { dict, t, locale }] = await Promise.all([
    isPro(),
    listWorkspaces(),
    userId ? getCreditBalance(userId) : Promise.resolve(0),
    getDailyStudyAgentOverview(),
    getI18n(),
  ]);
  const A = dict.app;
  const Agent = dict.agentCenter;
  const promptExample = dict.generate.describe.placeholder;
  const nextAgentItems = agent.plan?.items
    .filter((item) => !item.completed)
    .slice(0, 3) ?? [];
  const planMinutes = agent.plan?.items.reduce(
    (total, item) => total + item.durationMinutes,
    0,
  ) ?? 0;

  return (
    <main className="min-h-screen bg-paper text-ink antialiased">
      <DailyAgentBootstrap
        enabled={agent.config.enabled}
        planLocalDate={agent.plan?.localDate ?? null}
        planningLabel={Agent.running}
      />
      <header className="sticky top-0 z-40 border-b border-line bg-surface/95 backdrop-blur-md">
        <div className="mx-auto max-w-5xl px-4 py-3.5 sm:px-7">
          <div className="flex items-center justify-between gap-3">
            <Link
              href="/"
              className="flex shrink-0 items-center gap-1.5 font-display text-lg font-extrabold tracking-tight"
            >
              StudyOS
              <span className="mb-2 h-1.5 w-1.5 rounded-full bg-lime" aria-hidden />
            </Link>
            <div className="flex min-w-0 items-center gap-2 sm:gap-2.5">
              <div className="hidden sm:block">
                <ThemeToggle />
              </div>
              <div className="hidden md:block">
                <LanguageSwitcher compact />
              </div>
              <div className="hidden sm:block">
                <CreditChip credits={credits} locale={locale} />
              </div>
              {pro ? (
                <>
                  <span className="hidden rounded-full bg-ink px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-paper md:inline-flex">
                    {A.pro}
                  </span>
                  <form action={manageBillingAction} className="hidden lg:block">
                    <button
                      type="submit"
                      className="text-sm text-ink-soft transition hover:text-ink"
                    >
                      {A.manage}
                    </button>
                  </form>
                </>
              ) : (
                <Link
                  href="/pricing"
                  className="hidden rounded-md border border-line-strong px-3.5 py-1.5 text-sm font-semibold text-ink transition hover:bg-hover md:inline-flex"
                >
                  {A.upgrade}
                </Link>
              )}
              <Link
                href="/app/agents"
                className="hidden items-center gap-1.5 rounded-md px-2.5 py-2 text-sm font-semibold text-ink-soft transition hover:bg-hover hover:text-ink lg:inline-flex"
              >
                <Bot className="h-4 w-4" aria-hidden />
                {Agent.label}
              </Link>
              <Link
                href="/generate"
                className="whitespace-nowrap rounded-md bg-ink px-3 py-2 text-[13px] font-semibold text-paper shadow-card transition hover:opacity-90 sm:px-4 sm:text-sm"
              >
                {A.generate}
              </Link>
              <AccountMenu variant="header" />
            </div>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-line pt-3 md:hidden">
            <div className="sm:hidden">
              <ThemeToggle />
            </div>
            <LanguageSwitcher compact />
            <div className="sm:hidden">
              <CreditChip credits={credits} locale={locale} />
            </div>
            {pro ? (
              <span className="ml-auto rounded-full bg-ink px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-paper">
                {A.pro}
              </span>
            ) : (
              <Link
                href="/pricing"
                className="ml-auto rounded-md border border-line-strong px-3 py-1.5 text-xs font-semibold text-ink transition hover:bg-hover"
              >
                {A.upgrade}
              </Link>
            )}
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-5xl px-4 py-8 sm:px-7 sm:py-12">
        {sp.upgraded === "1" && pro && (
          <div className="mb-6 flex items-center gap-2 rounded-md border border-line-strong bg-lime-faint px-4 py-3 text-sm font-medium text-ink">
            <span className="h-1.5 w-1.5 rounded-full bg-lime" aria-hidden />
            {A.upgradedBanner}
          </div>
        )}
        {sp.credits && (
          <div className="mb-6 flex items-center gap-2 rounded-md border border-line-strong bg-lime-faint px-4 py-3 text-sm font-medium text-ink">
            <span className="h-1.5 w-1.5 rounded-full bg-lime" aria-hidden />
            {t(dict.credits.addedBanner, {
              added: Number(sp.credits).toLocaleString(locale),
              total: credits.toLocaleString(locale),
            })}
          </div>
        )}

        {/* Generate prompt */}
        <section className="overflow-hidden rounded-md border border-line-strong bg-card px-5 py-5 shadow-pop sm:px-7 sm:py-6">
          <div className="flex items-center gap-3 font-mono text-[11px] uppercase tracking-[0.16em] text-ink-faint">
            <span className="h-px w-6 bg-line-strong" aria-hidden />
            {A.generate}
          </div>
          <h1 className="mt-3 font-display text-[1.7rem] font-bold leading-tight tracking-tight">
            {dict.generate.describe.title}
          </h1>
          <Link
            href="/generate"
            className="group mt-4 flex max-w-xl items-center gap-2.5 rounded-md border border-line-strong bg-surface-2 py-2 pl-4 pr-2 transition hover:border-ink/30"
          >
            <span className="font-mono text-xs text-ink-faint" aria-hidden>
              ›
            </span>
            <span className="min-w-0 flex-1 truncate text-sm text-ink-soft">
              {promptExample}
            </span>
            <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-md bg-ink px-4 py-2.5 text-[13.5px] font-semibold text-paper transition group-hover:opacity-90">
              {A.generate}
              <span className="transition group-hover:translate-x-0.5" aria-hidden>
                →
              </span>
            </span>
          </Link>
        </section>

        <section className="mt-6 overflow-hidden rounded-md border border-line-strong bg-card shadow-card">
          <div className="flex flex-col gap-4 border-b border-line px-5 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-7">
            <div className="flex min-w-0 items-start gap-3.5">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-md bg-lime-faint text-lime-deep">
                <Bot className="h-5 w-5" aria-hidden />
              </span>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="font-display text-lg font-bold tracking-tight">
                    {Agent.dashboardTitle}
                  </h2>
                  <span className="inline-flex items-center gap-1 rounded-full border border-lime/30 bg-lime-faint px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-lime-deep">
                    <span className="h-1.5 w-1.5 rounded-full bg-lime-deep" aria-hidden />
                    {agent.config.enabled ? Agent.enabled : Agent.paused}
                  </span>
                </div>
                <p className="mt-1 text-sm text-ink-soft">{Agent.dashboardSubtitle}</p>
              </div>
            </div>
            <Link
              href="/app/agents"
              className="inline-flex shrink-0 items-center gap-1.5 self-start text-sm font-semibold text-ink transition hover:text-lime-deep sm:self-auto"
            >
              {Agent.openCenter}
              <ArrowRight className="h-4 w-4" aria-hidden />
            </Link>
          </div>

          {agent.plan ? (
            <div className="grid gap-px bg-line sm:grid-cols-3">
              {nextAgentItems.length > 0 ? (
                nextAgentItems.map((item) => (
                  <Link
                    key={item.id}
                    href={item.href}
                    className="group bg-card px-5 py-4 transition hover:bg-hover sm:px-6"
                  >
                    <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-wide text-ink-faint">
                      <Clock3 className="h-3 w-3" aria-hidden />
                      {t(Agent.minutes, { count: item.durationMinutes })}
                    </div>
                    <p className="mt-2 truncate text-sm font-semibold text-ink group-hover:text-lime-deep">
                      {item.title}
                    </p>
                    <p className="mt-1 truncate text-xs text-ink-soft">{item.source}</p>
                  </Link>
                ))
              ) : (
                <div className="flex items-center gap-2 bg-card px-5 py-5 text-sm font-medium text-ink sm:col-span-3 sm:px-7">
                  <Check className="h-4 w-4 text-lime-deep" aria-hidden />
                  {agent.plan.items.length === 0 ? Agent.clearTitle : Agent.allDone}
                </div>
              )}
            </div>
          ) : (
            <div className="flex flex-col gap-4 px-5 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-7">
              <p className="text-sm leading-6 text-ink-soft">{Agent.noPlanBody}</p>
              <form action={runDailyStudyAgentAction} className="shrink-0">
                <TimezoneInput initialValue={agent.config.timeZone} />
                <PendingButton
                  idleLabel={Agent.planToday}
                  pendingLabel={Agent.running}
                  size="sm"
                />
              </form>
            </div>
          )}

          {agent.plan && (
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line bg-surface-2 px-5 py-2.5 font-mono text-[10px] text-ink-faint sm:px-7">
              <span>{agent.plan.summary}</span>
              <span>{t(Agent.minutes, { count: planMinutes })}</span>
            </div>
          )}
        </section>

        <div className="mb-5 mt-9 flex items-end justify-between sm:mt-11">
          <div>
            <h2 className="font-display text-[1.4rem] font-bold tracking-tight">
              {A.title}
            </h2>
            <p className="mt-1 text-[13.5px] text-ink-soft">{A.subtitle}</p>
          </div>
          <span className="hidden font-mono text-[11px] text-ink-faint sm:block">
            {t(A.total, { count: workspaces.length })}
          </span>
        </div>

        {workspaces.length === 0 ? (
          <div className="rounded-md border border-dashed border-line-strong bg-surface-2 p-7 text-center sm:p-12">
            <p className="font-display text-lg font-bold text-ink">
              {A.emptyTitle}
            </p>
            <p className="mt-1 text-sm text-ink-soft">{A.emptySubtitle}</p>
            <div className="mt-6 flex flex-wrap justify-center gap-3">
              <Link
                href="/generate"
                className="rounded-md bg-ink px-5 py-2.5 text-sm font-semibold text-paper shadow-card transition hover:opacity-90"
              >
                {A.emptyGenerate}
              </Link>
              <form action={loadDemoAction}>
                <button
                  type="submit"
                  className="rounded-md border border-line-strong bg-card px-5 py-2.5 text-sm font-medium text-ink transition hover:bg-hover"
                >
                  {A.loadDemo}
                </button>
              </form>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {workspaces.map((w) => (
              <div key={w.id} className="group relative">
                <Link
                  href={`/app/${w.id}`}
                  className="flex min-h-[172px] flex-col rounded-md border border-line bg-card p-5 shadow-card transition hover:-translate-y-0.5 hover:border-lime/40 hover:shadow-pop"
                >
                  <span className="flex h-[42px] w-[42px] items-center justify-center rounded-md border border-line bg-surface-2 text-xl">
                    {w.icon ?? A.fallbackIcon}
                  </span>
                  <div className="mt-4 pr-8 font-display text-[1.05rem] font-bold text-ink">
                    {w.name}
                  </div>
                  <div className="mt-auto border-t border-line pt-3.5 font-mono text-[11px] text-ink-faint">
                    {t(A.updatedAt, {
                      date: new Date(w.updatedAt).toLocaleDateString(locale),
                    })}
                  </div>
                </Link>
                <DeleteWorkspaceButton id={w.id} name={w.name} />
              </div>
            ))}
            <Link
              href="/generate"
              className="flex min-h-[172px] flex-col items-center justify-center gap-2.5 rounded-md border border-dashed border-line-strong bg-transparent p-5 text-ink-soft transition hover:bg-hover"
            >
              <span className="flex h-9 w-9 items-center justify-center rounded-full border border-line-strong text-xl font-light">
                +
              </span>
              <span className="text-[13px] font-medium">{A.emptyGenerate}</span>
            </Link>
          </div>
        )}
      </div>
    </main>
  );
}
