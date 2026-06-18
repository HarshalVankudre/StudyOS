import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { auth, currentUser } from "@clerk/nextjs/server";
import { SignOutButton } from "@clerk/nextjs";
import { isPro } from "@/lib/billing";
import {
  CREDIT_PACK_PRICE_USD,
  CREDIT_PACK_SIZE,
  getCreditBalance,
} from "@/lib/credits";
import { getI18n } from "@/lib/i18n/server";
import { ManageAccountButton } from "@/components/account/ManageAccountButton";
import {
  buyCreditsAction,
  manageBillingAction,
  startCheckoutAction,
} from "../billing-actions";

export async function generateMetadata(): Promise<Metadata> {
  const { dict } = await getI18n();
  return { title: dict.settings.metaTitle };
}

export default async function SettingsPage() {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const [user, pro, credits, { dict, t, locale }] = await Promise.all([
    currentUser(),
    isPro(),
    getCreditBalance(userId),
    getI18n(),
  ]);
  const S = dict.settings;

  const email = user?.emailAddresses?.[0]?.emailAddress;
  const name =
    [user?.firstName, user?.lastName].filter(Boolean).join(" ") ||
    email ||
    S.yourAccount;
  const initial = (user?.firstName || name || "?").charAt(0).toUpperCase();

  return (
    <div className="min-h-screen bg-paper text-ink antialiased">
      <header className="border-b border-ink/10">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-6 py-4">
          <Link
            href="/"
            className="flex items-center gap-1.5 font-display text-lg font-extrabold tracking-tight"
          >
            StudyOS
            <span className="mb-2 h-1.5 w-1.5 rounded-full bg-lime" aria-hidden />
          </Link>
          <Link
            href="/app"
            className="text-sm text-ink-soft transition hover:text-ink"
          >
            {S.back}
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-6 py-12">
        <h1 className="font-display text-3xl font-bold tracking-tight">
          {S.title}
        </h1>
        <p className="mt-1 text-sm text-ink-soft">{S.subtitle}</p>

        {/* Profile */}
        <section className="mt-8 rounded-2xl border border-ink/10 bg-card/60 p-6">
          <h2 className="font-display text-lg font-bold">{S.profile}</h2>
          <div className="mt-4 flex items-center gap-4">
            <span className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-ink text-lg font-bold text-paper">
              {initial}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate font-semibold text-ink">{name}</p>
              {email && (
                <p className="truncate text-sm text-ink-soft">{email}</p>
              )}
            </div>
            <ManageAccountButton className="shrink-0 rounded-lg border border-ink/15 bg-card px-4 py-2 text-sm font-semibold text-ink transition hover:border-ink/40">
              {dict.account.manageAccount}
            </ManageAccountButton>
          </div>
        </section>

        {/* Plan & billing */}
        <section
          id="billing"
          className="mt-6 scroll-mt-20 rounded-2xl border border-ink/10 bg-card/60 p-6"
        >
          <div className="flex items-center justify-between">
            <h2 className="font-display text-lg font-bold">{S.subscription}</h2>
            <span
              className={`rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide ${
                pro ? "bg-ink text-paper" : "bg-ink/10 text-ink"
              }`}
            >
              {pro ? dict.account.pro : dict.account.free}
            </span>
          </div>

          <p className="mt-3 text-sm text-ink-soft">
            {pro ? S.proDesc : S.freeDesc}
          </p>

          <div className="mt-5 flex flex-wrap gap-3">
            {pro ? (
              <form action={manageBillingAction}>
                <button
                  type="submit"
                  className="rounded-lg bg-ink px-5 py-2.5 text-sm font-semibold text-paper transition hover:bg-ink/90"
                >
                  {S.manageSubscription}
                </button>
              </form>
            ) : (
              <>
                <form action={startCheckoutAction}>
                  <button
                    type="submit"
                    className="rounded-lg bg-ink px-5 py-2.5 text-sm font-semibold text-paper transition hover:bg-ink/90"
                  >
                    {S.upgrade}
                  </button>
                </form>
                <Link
                  href="/pricing"
                  className="rounded-lg border border-ink/15 bg-card px-5 py-2.5 text-sm font-semibold text-ink transition hover:border-ink/40"
                >
                  {S.comparePlans}
                </Link>
              </>
            )}
          </div>
        </section>

        {/* Credits */}
        <section className="mt-6 rounded-2xl border border-ink/10 bg-card/60 p-6">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-lg font-bold">
              {dict.credits.label}
            </h2>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-ink/5 px-3 py-1 text-sm font-semibold text-ink">
              <span className="text-lime-deep" aria-hidden>
                ●
              </span>
              {t(dict.credits.amount, { count: credits.toLocaleString(locale) })}
            </span>
          </div>
          <p className="mt-3 text-sm text-ink-soft">{S.creditsDesc}</p>
          <div className="mt-5 flex flex-wrap gap-3">
            <form action={buyCreditsAction}>
              <button
                type="submit"
                className="rounded-lg bg-ink px-5 py-2.5 text-sm font-semibold text-paper transition hover:bg-ink/90"
              >
                {t(S.buyPack, {
                  count: CREDIT_PACK_SIZE.toLocaleString(locale),
                  price: CREDIT_PACK_PRICE_USD,
                })}
              </button>
            </form>
            <Link
              href="/pricing#credits"
              className="rounded-lg border border-ink/15 bg-card px-5 py-2.5 text-sm font-semibold text-ink transition hover:border-ink/40"
            >
              {S.viewPricing}
            </Link>
          </div>
        </section>

        {/* Sign out */}
        <div className="mt-8 text-center">
          <SignOutButton redirectUrl="/">
            <button className="text-sm font-medium text-ink-soft transition hover:text-rose-600">
              {S.signOut}
            </button>
          </SignOutButton>
        </div>
      </main>
    </div>
  );
}
