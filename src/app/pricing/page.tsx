import type { Metadata } from "next";
import Link from "next/link";
import { auth } from "@clerk/nextjs/server";
import { UserButton } from "@clerk/nextjs";
import { isPro } from "@/lib/billing";
import {
  CREDIT_PACK_PRICE_USD,
  CREDIT_PACK_SIZE,
  FREE_SIGNUP_CREDITS,
  getCreditBalance,
  PRO_SIGNUP_CREDITS,
} from "@/lib/credits";
import {
  buyCreditsAction,
  manageBillingAction,
  startCheckoutAction,
} from "@/app/app/billing-actions";
import { getI18n } from "@/lib/i18n/server";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { ThemeToggle } from "@/components/ThemeToggle";

export async function generateMetadata(): Promise<Metadata> {
  const { dict } = await getI18n();
  return { title: dict.meta.pricingTitle, description: dict.meta.pricingDescription };
}

type Cell = boolean | string;

export default async function PricingPage() {
  const { dict, t, locale } = await getI18n();
  const { userId } = await auth();
  const signedIn = Boolean(userId);
  const pro = signedIn ? await isPro() : false;
  const credits = userId ? await getCreditBalance(userId) : 0;

  const FREE_BULLETS = [
    t(dict.pricing.free.bulletCredits, { count: FREE_SIGNUP_CREDITS }),
    dict.pricing.free.bullets[0],
    dict.pricing.free.bullets[1],
    dict.pricing.free.bullets[2],
    dict.pricing.free.bullets[3],
  ];

  const PRO_BULLETS = [
    dict.pricing.pro.bullets[0],
    t(dict.pricing.pro.bulletCredits, {
      count: PRO_SIGNUP_CREDITS.toLocaleString(locale),
    }),
    dict.pricing.pro.bullets[2],
    dict.pricing.pro.bullets[3],
  ];

  const COMPARISON: { feature: string; free: Cell; pro: Cell }[] = [
    { feature: dict.pricing.comparison.features.aiWorkspaces, free: true, pro: true },
    { feature: dict.pricing.comparison.features.onboarding, free: true, pro: true },
    { feature: dict.pricing.comparison.features.editing, free: true, pro: true },
    { feature: dict.pricing.comparison.features.databases, free: true, pro: true },
    { feature: dict.pricing.comparison.features.dragDrop, free: true, pro: true },
    { feature: dict.pricing.comparison.features.agentChat, free: true, pro: true },
    {
      feature: dict.pricing.comparison.features.model,
      free: dict.pricing.comparison.values.standard,
      pro: dict.pricing.comparison.values.mostCapable,
    },
    {
      feature: dict.pricing.comparison.features.credits,
      free: String(FREE_SIGNUP_CREDITS),
      pro: PRO_SIGNUP_CREDITS.toLocaleString(locale),
    },
    {
      feature: dict.pricing.comparison.features.buyMore,
      free: true,
      pro: true,
    },
    {
      feature: dict.pricing.comparison.features.support,
      free: dict.pricing.comparison.values.community,
      pro: dict.pricing.comparison.values.priority,
    },
    { feature: dict.pricing.comparison.features.earlyAccess, free: false, pro: true },
  ];

  const FAQ = dict.pricing.faq;

  return (
    <div className="min-h-screen bg-paper text-ink antialiased">
      {/* Nav */}
      <header className="border-b border-line bg-paper/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-7 py-4">
          <Link
            href="/"
            className="flex items-center gap-1.5 font-display text-lg font-extrabold tracking-tight"
          >
            StudyOS
            <span className="mb-2 h-1.5 w-1.5 rounded-full bg-lime" aria-hidden />
          </Link>
          <div className="flex items-center gap-3">
            <ThemeToggle />
            <LanguageSwitcher compact />
            {signedIn ? (
              <>
                <Link
                  href="/app"
                  className="text-sm text-ink-soft transition hover:text-ink"
                >
                  {dict.common.openApp}
                </Link>
                <UserButton />
              </>
            ) : (
              <>
                <Link
                  href="/sign-in"
                  className="text-sm text-ink-soft transition hover:text-ink"
                >
                  {dict.common.signIn}
                </Link>
                <Link
                  href="/sign-up"
                  className="rounded-md bg-ink px-4 py-2 text-sm font-semibold text-paper shadow-card transition hover:opacity-90"
                >
                  {dict.common.getStarted}
                </Link>
              </>
            )}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-7 py-16 sm:py-20">
        {/* Heading */}
        <div className="text-center">
          <p className="flex items-center justify-center gap-3 font-mono text-[11.5px] uppercase tracking-[0.18em] text-ink-faint">
            <span className="h-px w-6 bg-line-strong" aria-hidden />
            {dict.pricing.badge}
          </p>
          <h1 className="mt-5 font-display text-4xl font-extrabold tracking-tight sm:text-5xl">
            {dict.pricing.title}
          </h1>
          <p className="mx-auto mt-4 max-w-xl text-lg leading-relaxed text-ink-soft">
            {dict.pricing.subtitle}
          </p>
        </div>

        {/* Plan cards */}
        <div className="mt-12 grid items-start gap-5 sm:grid-cols-2">
          {/* Free */}
          <div className="flex flex-col rounded-md border border-line bg-card p-8 shadow-card">
            <span className="font-mono text-[12px] uppercase tracking-wide text-ink-soft">
              {dict.pricing.free.name}
            </span>
            <div className="mt-3.5 flex items-baseline gap-1 font-display text-5xl font-extrabold tracking-tight">
              {dict.pricing.free.price}
              <span className="text-base font-medium text-ink-faint">/∞</span>
            </div>
            <p className="mt-1.5 text-sm text-ink-soft">{dict.pricing.free.tagline}</p>
            <div className="my-6 h-px bg-line" />
            <ul className="space-y-3 text-sm">
              {FREE_BULLETS.map((b) => (
                <Feature key={b}>{b}</Feature>
              ))}
            </ul>
            <div className="mt-8">
              {signedIn ? (
                <Link
                  href="/app"
                  className="block rounded-md border border-line-strong bg-surface-2 px-5 py-3 text-center text-sm font-semibold text-ink transition hover:bg-hover"
                >
                  {dict.pricing.free.ctaSignedIn}
                </Link>
              ) : (
                <Link
                  href="/sign-up"
                  className="block rounded-md border border-line-strong bg-surface-2 px-5 py-3 text-center text-sm font-semibold text-ink transition hover:bg-hover"
                >
                  {dict.pricing.free.ctaSignedOut}
                </Link>
              )}
            </div>
          </div>

          {/* Pro */}
          <div className="relative flex flex-col rounded-md border-[1.5px] border-lime bg-card p-8 shadow-pop">
            <span className="absolute right-6 top-7 inline-flex items-center gap-1.5 rounded-full bg-lime px-2.5 py-1 font-mono text-[10.5px] font-semibold text-lime-on">
              ★ {dict.pricing.pro.badge}
            </span>
            <span className="font-mono text-[12px] uppercase tracking-wide text-ink-soft">
              {dict.pricing.pro.name}
            </span>
            <div className="mt-3.5 flex items-baseline gap-1 font-display text-5xl font-extrabold tracking-tight">
              {dict.pricing.pro.price}
              <span className="text-base font-medium text-ink-faint">
                {dict.pricing.pro.perMonth}
              </span>
            </div>
            <p className="mt-1.5 text-sm text-ink-soft">{dict.pricing.pro.billed}</p>
            <div className="my-6 h-px bg-line" />
            <ul className="space-y-3 text-sm">
              {PRO_BULLETS.map((b) => (
                <Feature key={b} strong>
                  {b}
                </Feature>
              ))}
            </ul>
            <div className="mt-8">
              {pro ? (
                <div className="space-y-3">
                  <div className="rounded-md bg-lime-faint px-4 py-3 text-center text-sm font-semibold text-ink ring-1 ring-inset ring-lime/30">
                    {dict.pricing.pro.currentPlan}
                  </div>
                  <form action={manageBillingAction}>
                    <button
                      type="submit"
                      className="w-full rounded-md border border-line-strong bg-surface-2 px-5 py-3 text-sm font-semibold text-ink transition hover:bg-hover"
                    >
                      {dict.pricing.pro.manageBilling}
                    </button>
                  </form>
                </div>
              ) : signedIn ? (
                <form action={startCheckoutAction}>
                  <button
                    type="submit"
                    className="w-full rounded-md bg-ink px-5 py-3 text-sm font-semibold text-paper transition hover:opacity-90"
                  >
                    {dict.pricing.pro.upgrade}
                  </button>
                </form>
              ) : (
                <Link
                  href="/sign-up"
                  className="block rounded-md bg-ink px-5 py-3 text-center text-sm font-semibold text-paper transition hover:opacity-90"
                >
                  {dict.pricing.pro.ctaSignedOut}
                </Link>
              )}
            </div>
          </div>
        </div>

        {/* Credits */}
        <section id="credits" className="mt-20 scroll-mt-20">
          <div className="rounded-md border border-line bg-card p-8 shadow-card sm:p-10">
            <div className="grid gap-8 sm:grid-cols-[1.3fr_1fr] sm:items-center">
              <div>
                <h2 className="font-display text-2xl font-bold tracking-tight sm:text-3xl">
                  {dict.pricing.credits.heading}
                </h2>
                <p className="mt-3 text-ink-soft">
                  {dict.pricing.credits.intro}
                </p>
                <ul className="mt-4 space-y-2 text-sm">
                  <Feature>
                    {t(dict.pricing.credits.freeIncludes, {
                      count: FREE_SIGNUP_CREDITS,
                    })}
                  </Feature>
                  <Feature>
                    {t(dict.pricing.credits.proIncludes, {
                      count: PRO_SIGNUP_CREDITS.toLocaleString(locale),
                    })}
                  </Feature>
                  <Feature>{dict.pricing.credits.neverExpire}</Feature>
                </ul>
                {signedIn && (
                  <p className="mt-5 inline-flex items-center gap-2 rounded-full bg-hover px-3.5 py-1.5 text-sm font-semibold text-ink">
                    <span className="text-lime-deep" aria-hidden>
                      ●
                    </span>
                    {t(dict.pricing.credits.balance, {
                      count: credits.toLocaleString(locale),
                    })}
                  </p>
                )}
              </div>

              {/* Buy a credit pack */}
              <div className="rounded-md border border-line-strong bg-surface-2 p-6 text-center shadow-card">
                <p className="font-mono text-[11px] uppercase tracking-wide text-ink-soft">
                  {dict.pricing.credits.pack}
                </p>
                <div className="mt-2 font-display text-4xl font-extrabold">
                  {CREDIT_PACK_SIZE.toLocaleString(locale)}
                </div>
                <p className="text-sm text-ink-soft">
                  {dict.pricing.credits.unit}
                </p>
                <div className="mt-3 font-display text-2xl font-bold">
                  ${CREDIT_PACK_PRICE_USD}
                </div>
                <div className="mt-5">
                  {signedIn ? (
                    <form action={buyCreditsAction}>
                      <button
                        type="submit"
                        className="w-full rounded-md bg-ink px-5 py-3 text-sm font-semibold text-paper transition hover:opacity-90"
                      >
                        {t(dict.pricing.credits.buy, {
                          count: CREDIT_PACK_SIZE.toLocaleString(locale),
                        })}
                      </button>
                    </form>
                  ) : (
                    <Link
                      href="/sign-up"
                      className="block rounded-md bg-ink px-5 py-3 text-sm font-semibold text-paper transition hover:opacity-90"
                    >
                      {dict.pricing.credits.signUpToBuy}
                    </Link>
                  )}
                </div>
                <p className="mt-3 text-xs text-ink-faint">
                  {dict.pricing.credits.oneTime}
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* Comparison table */}
        <section className="mt-20">
          <h2 className="text-center font-display text-2xl font-bold tracking-tight sm:text-3xl">
            {dict.pricing.comparison.title}
          </h2>
          <div className="mx-auto mt-8 max-w-3xl overflow-hidden rounded-md border border-line bg-card">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-line bg-surface text-left">
                  <th className="px-5 py-4 font-display text-base font-bold">
                    {dict.pricing.comparison.featuresHeader}
                  </th>
                  <th className="w-28 px-3 py-4 text-center font-semibold text-ink-soft">
                    {dict.pricing.comparison.freeHeader}
                  </th>
                  <th className="w-28 px-3 py-4 text-center font-semibold text-ink">
                    {dict.pricing.comparison.proHeader}
                  </th>
                </tr>
              </thead>
              <tbody>
                {COMPARISON.map((row, i) => (
                  <tr
                    key={row.feature}
                    className={i % 2 === 1 ? "bg-surface" : ""}
                  >
                    <td className="px-5 py-3.5 text-ink">{row.feature}</td>
                    <td className="px-3 py-3.5 text-center">
                      <Mark
                        value={row.free}
                        includedLabel={dict.pricing.comparison.included}
                        notIncludedLabel={dict.pricing.comparison.notIncluded}
                      />
                    </td>
                    <td className="bg-lime-faint px-3 py-3.5 text-center font-medium">
                      <Mark
                        value={row.pro}
                        strong
                        includedLabel={dict.pricing.comparison.included}
                        notIncludedLabel={dict.pricing.comparison.notIncluded}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* FAQ */}
        <section className="mt-20">
          <h2 className="text-center font-display text-2xl font-bold tracking-tight sm:text-3xl">
            {dict.pricing.faqTitle}
          </h2>
          <div className="mx-auto mt-8 grid max-w-3xl gap-4 sm:grid-cols-2">
            {FAQ.map((item) => (
              <div
                key={item.q}
                className="rounded-md border border-line bg-card p-5"
              >
                <h3 className="font-display text-base font-bold text-ink">
                  {item.q}
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-ink-soft">
                  {item.a}
                </p>
              </div>
            ))}
          </div>
        </section>

        {/* Bottom CTA */}
        <section className="mt-20 rounded-md bg-primary px-6 py-14 text-center text-primary-foreground">
          <h2 className="font-display text-3xl font-extrabold tracking-tight">
            {dict.pricing.ctaTitle}
          </h2>
          <p className="mx-auto mt-3 max-w-md text-primary-foreground/60">
            {dict.pricing.ctaSubtitle}
          </p>
          <Link
            href={signedIn ? "/generate" : "/sign-up"}
            className="mt-8 inline-flex items-center gap-2 rounded-md bg-lime px-8 py-3.5 text-sm font-bold text-lime-on transition hover:opacity-90"
          >
            {signedIn ? dict.pricing.ctaSignedIn : dict.pricing.ctaSignedOut}
            <span aria-hidden>→</span>
          </Link>
        </section>
      </main>

      <footer>
        <div className="mx-auto flex max-w-5xl flex-col items-center justify-between gap-3 px-7 py-8 sm:flex-row">
          <Link
            href="/"
            className="flex items-center gap-1.5 font-display font-bold text-ink"
          >
            StudyOS
            <span className="mb-2 h-1 w-1 rounded-full bg-lime" aria-hidden />
          </Link>
          <span className="text-sm text-ink-soft">
            {dict.pricing.footerTagline}
          </span>
        </div>
      </footer>
    </div>
  );
}

function Feature({
  children,
  strong,
}: {
  children: React.ReactNode;
  strong?: boolean;
}) {
  return (
    <li className="flex items-start gap-2.5">
      <span
        className={`mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full text-[10px] ${
          strong ? "bg-lime text-lime-on" : "bg-hover text-ink-faint"
        }`}
        aria-hidden
      >
        ✓
      </span>
      <span className="text-ink-soft">{children}</span>
    </li>
  );
}

function Mark({
  value,
  strong,
  includedLabel,
  notIncludedLabel,
}: {
  value: Cell;
  strong?: boolean;
  includedLabel: string;
  notIncludedLabel: string;
}) {
  if (typeof value === "string") {
    return <span className={strong ? "text-ink" : "text-ink-soft"}>{value}</span>;
  }
  if (value) {
    return (
      <span
        className={`inline-grid h-5 w-5 place-items-center rounded-full text-xs ${
          strong ? "bg-lime text-lime-on" : "bg-hover text-ink"
        }`}
        aria-label={includedLabel}
      >
        ✓
      </span>
    );
  }
  return (
    <span className="text-ink-faint/60" aria-label={notIncludedLabel}>
      —
    </span>
  );
}
