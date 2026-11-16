import type { Metadata } from "next";
import { auth } from "@clerk/nextjs/server";
import Link from "next/link";
import { getDailyStudyAgentOverview } from "@/lib/agents/daily-study/store";
import { isPro, reconcileCheckoutSession } from "@/lib/billing";
import { getCreditBalance } from "@/lib/credits";
import { listTrashedWorkspaces, listWorkspaces } from "@/lib/workspace/store";
import { getI18n } from "@/lib/i18n/server";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { ThemeToggle } from "@/components/ThemeToggle";
import { AccountMenu } from "@/components/account/AccountMenu";
import { CreditChip } from "@/components/account/CreditChip";
import { LowCreditsNotice } from "@/components/account/LowCreditsNotice";
import { Toaster } from "@/components/ui/sonner";
import { TodayPlan } from "@/components/today/TodayPlan";
import { SearchButton } from "@/components/command/SearchButton";
import { loadDemoAction } from "./actions";
import { getFocusSummary } from "./focus-actions";
import { manageBillingAction } from "./billing-actions";
import { isBillingConfigured } from "@/lib/stripe";
import { isLowBalance } from "@/lib/credits-info";
import { getProPricing } from "@/lib/plan-pricing";
import { referralsEnabled } from "@/lib/referral/config";
import { DeleteWorkspaceButton } from "./DeleteWorkspaceButton";
import { LoadDemoButton } from "./LoadDemoButton";
import { NotionImportButton } from "@/components/import/NotionImportButton";
import { TrashList } from "./TrashList";
import { DailyAgentBootstrap } from "./agents/DailyAgentBootstrap";
import { BrandMark } from "@/components/BrandMark";
import { AppNav } from "@/components/AppNav";

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
  const [pro, workspaces, trash, credits, agent, focus, { dict, t, locale, dir }] = await Promise.all([
    isPro(),
    listWorkspaces(),
    listTrashedWorkspaces(),
    userId ? getCreditBalance(userId) : Promise.resolve(0),
    getDailyStudyAgentOverview(),
    // Focus minutes in the zone the daily plan uses (null if they cannot be read).
    getFocusSummary(),
    getI18n(),
  ]);
  // Without payments switched on there is nothing to upgrade to yet.
  const billing = isBillingConfigured();
  const A = dict.app;
  const promptExample = dict.generate.describe.placeholder;
  // A new student starts with the generator; everyone else starts with Today.
  const hasWorkspaces = workspaces.length > 0;
  // A low balance gets a note with the ways to get more (packs and invites on
  // the credits page, Pro for a Free student while it is on sale). Stripe's
  // price is only looked up when the note can show.
  const lowNote = isLowBalance(credits) && (billing || referralsEnabled());
  const showPro = lowNote && billing && !pro && (await getProPricing().catch(() => null))?.offered.month === true;

  return (
    <main className="min-h-screen bg-paper text-ink antialiased">
      <Toaster dir={dir} position="bottom-center" />
      <DailyAgentBootstrap
        enabled={agent.config.enabled}
        planLocalDate={agent.plan?.localDate ?? null}
        planningLabel={dict.today.planning}
      />
      <header className="sticky top-0 z-40 border-b border-line bg-paper/90 backdrop-blur-md">
        <div className="mx-auto max-w-5xl px-4 py-3.5 sm:px-7">
          <div className="flex items-center justify-between gap-3">
            <Link
              href="/"
              className="flex shrink-0 items-center gap-2 font-display text-xl"
            >
              <BrandMark />
              StudyOS
            </Link>
            <div className="flex min-w-0 items-center gap-2 sm:gap-2.5">
              <div className="hidden sm:block">
                <ThemeToggle />
              </div>
              <div className="hidden md:block">
                <LanguageSwitcher compact />
              </div>
              <div className="hidden sm:block">
                <CreditChip credits={credits} locale={locale} billing={billing} />
              </div>
              {pro ? (
                <>
                  <span className="hidden rounded-full bg-lime px-3 py-1 text-xs font-semibold text-lime-on md:inline-flex">
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
              ) : billing ? (
                <Link
                  href="/pricing"
                  className="hidden rounded-full border border-line-strong px-4 py-1.5 text-sm font-semibold text-ink transition hover:bg-hover md:inline-flex"
                >
                  {A.upgrade}
                </Link>
              ) : null}
              <SearchButton />
              <Link
                href="/generate"
                className="whitespace-nowrap rounded-full px-4 py-2 text-[13px] font-semibold sm:px-5 sm:text-sm bg-lime text-lime-on transition hover:bg-lime-hover"
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
              <CreditChip credits={credits} locale={locale} billing={billing} />
            </div>
            {pro ? (
              <span className="ml-auto rounded-full bg-lime px-3 py-1 text-xs font-semibold text-lime-on">
                {A.pro}
              </span>
            ) : billing ? (
              <Link
                href="/pricing"
                className="ml-auto rounded-full border border-line-strong px-3.5 py-1.5 text-xs font-semibold text-ink transition hover:bg-hover"
              >
                {A.upgrade}
              </Link>
            ) : null}
          </div>
          <AppNav className="mt-3" />
        </div>
      </header>

      <div className="mx-auto max-w-5xl px-4 py-8 sm:px-7 sm:py-12">
        {sp.upgraded === "1" && pro && (
          <div className="mb-6 flex items-center gap-2.5 rounded-2xl bg-matcha px-4 py-3 text-sm font-medium text-ink">
            <span className="h-1.5 w-1.5 rounded-full bg-lime" aria-hidden />
            {A.upgradedBanner}
          </div>
        )}
        {sp.credits && (
          <div className="mb-6 flex items-center gap-2.5 rounded-2xl bg-matcha px-4 py-3 text-sm font-medium text-ink">
            <span className="h-1.5 w-1.5 rounded-full bg-lime" aria-hidden />
            {t(dict.credits.addedBanner, {
              added: Number(sp.credits).toLocaleString(locale),
              total: credits.toLocaleString(locale),
            })}
          </div>
        )}

        {lowNote && <LowCreditsNotice credits={credits} showPro={showPro} />}

        {hasWorkspaces ? (
          <TodayPlan plan={agent.plan} dailyMinutes={agent.config.dailyMinutes} focus={focus} />
        ) : (
          <>
            {/* Generate prompt */}
            <section className="overflow-hidden rounded-3xl border border-line bg-card px-6 py-7 sm:px-9 sm:py-9">
              <h1 className="font-display text-4xl leading-tight sm:text-5xl">
                {dict.generate.describe.title}
              </h1>
              <Link
                href="/generate"
                className="group mt-6 flex max-w-xl items-center gap-2.5 rounded-full border border-line-strong bg-paper py-1.5 pe-1.5 ps-5 transition hover:border-ink-faint"
              >
                <span className="min-w-0 flex-1 truncate text-[15px] text-ink-faint">
                  {promptExample}
                </span>
                <span className="inline-flex min-h-11 items-center gap-1.5 whitespace-nowrap rounded-full bg-lime px-5 text-sm font-semibold text-lime-on transition group-hover:bg-lime-hover">
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
            <h2 className="font-display text-3xl">
              {A.title}
            </h2>
            <p className="mt-1 text-[13.5px] text-ink-soft">{A.subtitle}</p>
          </div>
          <span className="hidden text-sm tabular-nums text-ink-faint sm:block">
            {t(A.total, { count: workspaces.length })}
          </span>
        </div>

        {workspaces.length === 0 ? (
          <div className="rounded-3xl bg-oat p-8 text-center sm:p-14">
            <p className="font-display text-2xl text-ink">
              {A.emptyTitle}
            </p>
            <p className="mt-1 text-sm text-ink-soft">{A.emptySubtitle}</p>
            <div className="mt-6 flex flex-wrap justify-center gap-3">
              <Link
                href="/generate"
                className="rounded-full px-6 py-3 text-sm font-semibold bg-lime text-lime-on transition hover:bg-lime-hover"
              >
                {A.emptyGenerate}
              </Link>
              <form action={loadDemoAction}>
                <LoadDemoButton label={A.loadDemo} />
              </form>
              <NotionImportButton label={dict.notionImport.homeButton} className="py-3" />
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {workspaces.map((w) => (
              <div key={w.id} className="group relative">
                <Link
                  href={`/app/${w.id}`}
                  className="flex min-h-[180px] flex-col rounded-3xl border border-line bg-card p-6 transition hover:-translate-y-0.5 hover:border-line-strong"
                >
                  <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-matcha text-2xl">
                    {w.icon ?? A.fallbackIcon}
                  </span>
                  <div className="mt-4 pe-10 font-display text-xl leading-snug text-ink">
                    <bdi>{w.name}</bdi>
                  </div>
                  <div className="mt-auto pt-4 text-[13px] text-ink-faint">
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
              className="flex min-h-[180px] flex-col items-center justify-center gap-2.5 rounded-3xl border border-dashed border-line-strong bg-transparent p-6 text-ink-soft transition hover:bg-hover"
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
            className="group mt-6 flex items-center gap-2.5 rounded-full border border-line-strong bg-card py-1.5 pe-1.5 ps-5 transition hover:border-ink-faint"
          >
            <span className="min-w-0 flex-1 truncate text-[15px] text-ink-faint">{promptExample}</span>
            <span className="inline-flex min-h-10 items-center gap-1.5 whitespace-nowrap rounded-full bg-lime px-5 text-sm font-semibold text-lime-on transition group-hover:bg-lime-hover">
              {A.generate}
            </span>
          </Link>
        )}
        {hasWorkspaces && (
          <div className="mt-3 flex justify-end">
            <NotionImportButton
              label={dict.notionImport.homeButton}
              className="min-h-10 border-transparent px-3 text-[13px] text-ink-soft hover:text-ink"
            />
          </div>
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
