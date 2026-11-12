import type { Metadata } from "next";
import { auth } from "@clerk/nextjs/server";
import Link from "next/link";
import { Bot } from "lucide-react";
import { getDailyStudyAgentOverview } from "@/lib/agents/daily-study/store";
import { isPro, reconcileCheckoutSession } from "@/lib/billing";
import { getCreditBalance } from "@/lib/credits";
import { listTrashedWorkspaces, listWorkspaces } from "@/lib/workspace/store";
import { getI18n } from "@/lib/i18n/server";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { ThemeToggle } from "@/components/ThemeToggle";
import { AccountMenu } from "@/components/account/AccountMenu";
import { CreditChip } from "@/components/account/CreditChip";
import { Toaster } from "@/components/ui/sonner";
import { TodayPlan } from "@/components/today/TodayPlan";
import { loadDemoAction } from "./actions";
import { manageBillingAction } from "./billing-actions";
import { DeleteWorkspaceButton } from "./DeleteWorkspaceButton";
import { TrashList } from "./TrashList";
import { DailyAgentBootstrap } from "./agents/DailyAgentBootstrap";

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
  const [pro, workspaces, trash, credits, agent, { dict, t, locale, dir }] = await Promise.all([
    isPro(),
    listWorkspaces(),
    listTrashedWorkspaces(),
    userId ? getCreditBalance(userId) : Promise.resolve(0),
    getDailyStudyAgentOverview(),
    getI18n(),
  ]);
  const A = dict.app;
  const Agent = dict.agentCenter;
  const promptExample = dict.generate.describe.placeholder;
  // A new student starts with the generator; everyone else starts with Today.
  const hasWorkspaces = workspaces.length > 0;

  return (
    <main className="min-h-screen bg-paper text-ink antialiased">
      <Toaster dir={dir} position="bottom-center" />
      <DailyAgentBootstrap
        enabled={agent.config.enabled}
        planLocalDate={agent.plan?.localDate ?? null}
        planningLabel={dict.today.planning}
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

        {hasWorkspaces ? (
          <TodayPlan plan={agent.plan} dailyMinutes={agent.config.dailyMinutes} />
        ) : (
          <>
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
                className="group mt-4 flex max-w-xl items-center gap-2.5 rounded-md border border-line-strong bg-surface-2 py-2 pe-2 ps-4 transition hover:border-ink/30"
              >
                <span className="font-mono text-xs text-ink-faint rtl:-scale-x-100" aria-hidden>
                  ›
                </span>
                <span className="min-w-0 flex-1 truncate text-sm text-ink-soft">
                  {promptExample}
                </span>
                <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-md bg-ink px-4 py-2.5 text-[13.5px] font-semibold text-paper transition group-hover:opacity-90">
                  {A.generate}
                  <span className="transition group-hover:translate-x-0.5 rtl:-scale-x-100 rtl:group-hover:-translate-x-0.5" aria-hidden>
                    →
                  </span>
                </span>
              </Link>
            </section>
          </>
        )}

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
                  <div className="mt-4 pe-10 font-display text-[1.05rem] font-bold text-ink">
                    <bdi>{w.name}</bdi>
                  </div>
                  <div className="mt-auto border-t border-line pt-3.5 font-mono text-[11px] text-ink-faint">
                    {t(A.updatedAt, {
                      date: new Date(w.updatedAt).toLocaleDateString(locale, { dateStyle: "medium" }),
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

        {hasWorkspaces && (
          <Link
            href="/generate"
            className="group mt-6 flex items-center gap-2.5 rounded-md border border-line-strong bg-card py-2 pe-2 ps-4 shadow-card transition hover:border-ink/30"
          >
            <span className="font-mono text-xs text-ink-faint rtl:-scale-x-100" aria-hidden>
              ›
            </span>
            <span className="min-w-0 flex-1 truncate text-sm text-ink-soft">{promptExample}</span>
            <span className="inline-flex min-h-10 items-center gap-1.5 whitespace-nowrap rounded-md bg-ink px-4 text-[13px] font-semibold text-paper transition group-hover:opacity-90">
              {A.generate}
            </span>
          </Link>
        )}

        <TrashList
          items={trash.map((item) => ({
            id: item.id,
            name: item.name,
            icon: item.icon,
            purgeAt: item.purgeAt.toISOString(),
          }))}
        />
      </div>
    </main>
  );
}
