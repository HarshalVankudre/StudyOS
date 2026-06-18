import type { Metadata } from "next";
import { auth } from "@clerk/nextjs/server";
import Link from "next/link";
import { isPro, reconcileCheckoutSession } from "@/lib/billing";
import { getCreditBalance } from "@/lib/credits";
import { listWorkspaces } from "@/lib/workspace/store";
import { getI18n } from "@/lib/i18n/server";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
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

  return (
    <main className="min-h-screen bg-paper text-ink antialiased">
      <header className="border-b border-ink/10">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <Link
            href="/"
            className="flex items-center gap-1.5 font-display text-lg font-extrabold tracking-tight"
          >
            StudyOS
            <span className="mb-2 h-1.5 w-1.5 rounded-full bg-lime" aria-hidden />
          </Link>
          <div className="flex items-center gap-3">
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
                className="rounded-lg border border-ink/15 px-3.5 py-1.5 text-sm font-semibold text-ink transition hover:border-ink/40 hover:bg-white"
              >
                {A.upgrade}
              </Link>
            )}
            <Link
              href="/generate"
              className="rounded-lg bg-ink px-4 py-2 text-sm font-semibold text-paper shadow-sm transition hover:bg-ink/90"
            >
              {A.generate}
            </Link>
            <AccountMenu variant="header" />
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-5xl px-6 py-12">
        {sp.upgraded === "1" && pro && (
          <div className="mb-6 flex items-center gap-2 rounded-lg border border-ink/15 bg-lime/10 px-4 py-3 text-sm font-medium text-ink">
            <span className="h-1.5 w-1.5 rounded-full bg-lime" aria-hidden />
            {A.upgradedBanner}
          </div>
        )}
        {sp.credits && (
          <div className="mb-6 flex items-center gap-2 rounded-lg border border-ink/15 bg-lime/10 px-4 py-3 text-sm font-medium text-ink">
            <span className="h-1.5 w-1.5 rounded-full bg-lime" aria-hidden />
            {t(dict.credits.addedBanner, {
              added: Number(sp.credits).toLocaleString(locale),
              total: credits.toLocaleString(locale),
            })}
          </div>
        )}

        <div className="mb-8 flex items-end justify-between">
          <div>
            <h1 className="font-display text-3xl font-bold tracking-tight">
              {A.title}
            </h1>
            <p className="mt-1 text-sm text-ink-soft">{A.subtitle}</p>
          </div>
          <span className="hidden text-sm text-ink-soft sm:block">
            {t(A.total, { count: workspaces.length })}
          </span>
        </div>

        {workspaces.length === 0 ? (
          <div className="rounded-xl border border-dashed border-ink/20 bg-white/50 p-12 text-center">
            <p className="text-lg font-medium text-ink">{A.emptyTitle}</p>
            <p className="mt-1 text-sm text-ink-soft">{A.emptySubtitle}</p>
            <div className="mt-6 flex flex-wrap justify-center gap-3">
              <Link
                href="/generate"
                className="rounded-lg bg-ink px-5 py-2.5 text-sm font-semibold text-paper shadow-sm transition hover:bg-ink/90"
              >
                {A.emptyGenerate}
              </Link>
              <form action={loadDemoAction}>
                <button
                  type="submit"
                  className="rounded-lg border border-ink/15 bg-white px-5 py-2.5 text-sm font-medium text-ink transition hover:border-ink/40"
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
                  className="block rounded-xl border border-ink/10 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:border-ink/25 hover:shadow-[0_16px_40px_-24px_rgba(26,23,18,0.4)]"
                >
                  <div className="mb-3 text-3xl">{w.icon ?? A.fallbackIcon}</div>
                  <div className="pr-8 font-display font-bold text-ink">
                    {w.name}
                  </div>
                  <div className="mt-1 text-xs text-ink-soft">
                    {t(A.updatedAt, {
                      date: new Date(w.updatedAt).toLocaleDateString(locale),
                    })}
                  </div>
                </Link>
                <DeleteWorkspaceButton id={w.id} name={w.name} />
              </div>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
