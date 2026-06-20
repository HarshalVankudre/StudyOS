import type { Metadata } from "next";
import { auth } from "@clerk/nextjs/server";
import Link from "next/link";
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
  const [pro, workspaces, credits, { dict, t, locale }] = await Promise.all([
    isPro(),
    listWorkspaces(),
    userId ? getCreditBalance(userId) : Promise.resolve(0),
    getI18n(),
  ]);
  const A = dict.app;
  const promptExample = dict.generate.describe.placeholder;

  return (
    <main className="min-h-screen bg-paper text-ink antialiased">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-7 py-3.5">
          <Link
            href="/"
            className="flex items-center gap-1.5 font-display text-lg font-extrabold tracking-tight"
          >
            StudyOS
            <span className="mb-2 h-1.5 w-1.5 rounded-full bg-lime" aria-hidden />
          </Link>
          <div className="flex items-center gap-2.5">
            <ThemeToggle />
            <LanguageSwitcher compact />
            <CreditChip credits={credits} locale={locale} />
            {pro ? (
              <>
                <span className="rounded-full bg-ink px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-paper">
                  {A.pro}
                </span>
                <form action={manageBillingAction}>
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
                className="rounded-md border border-line-strong px-3.5 py-1.5 text-sm font-semibold text-ink transition hover:bg-hover"
              >
                {A.upgrade}
              </Link>
            )}
            <Link
              href="/generate"
              className="rounded-md bg-ink px-4 py-2 text-sm font-semibold text-paper shadow-card transition hover:opacity-90"
            >
              {A.generate}
            </Link>
            <AccountMenu variant="header" />
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-5xl px-7 py-12">
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
        <section className="overflow-hidden rounded-md border border-line-strong bg-card px-7 py-6 shadow-pop">
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

        <div className="mb-5 mt-11 flex items-end justify-between">
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
          <div className="rounded-md border border-dashed border-line-strong bg-surface-2 p-12 text-center">
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
