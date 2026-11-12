import type { Metadata } from "next";
import Link from "next/link";
import { auth } from "@clerk/nextjs/server";
import { UserButton } from "@clerk/nextjs";
import { Check } from "lucide-react";
import { isPro } from "@/lib/billing";
import {
  CREDIT_PACK_PRICE_USD,
  CREDIT_PACK_SIZE,
  FREE_MONTHLY_CREDITS,
  FREE_SIGNUP_CREDITS,
  getCreditBalance,
  PRO_MONTHLY_CREDITS,
} from "@/lib/credits";
import {
  CREDITS_PER_EDIT,
  CREDITS_PER_GENERATION,
  MIN_GENERATION_BALANCE,
  STUDY_KIT_CREDITS_PER_SECTION,
  STUDY_KIT_MAX_CREDITS_PER_SECTION,
  estimatedEdits,
  estimatedGenerations,
} from "@/lib/credits-info";
import { MAX_SECTIONS_PER_RUN, SECTION_TARGET_CHARS } from "@/lib/materials/limits";
import { TURN_CREDIT_CAP } from "@/lib/ai/budgets";
import { modelForPlan } from "@/lib/ai/plans";
import { USAGE_LIMITS } from "@/lib/usage-limits";
import { formatPrice, formatUsd, getProPricing, type PriceAmount } from "@/lib/plan-pricing";
import { supportEmail } from "@/lib/site";
import {
  buyCreditsAction,
  manageBillingAction,
  startCheckoutAction,
} from "@/app/app/billing-actions";
import { getI18n } from "@/lib/i18n/server";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { ThemeToggle } from "@/components/ThemeToggle";
import { ProPriceSwitch } from "@/components/pricing/ProPriceSwitch";
import {
  BillingNotice,
  parseBillingNotice,
} from "@/components/account/BillingNotice";

export async function generateMetadata(): Promise<Metadata> {
  const { dict } = await getI18n();
  return { title: dict.meta.pricingTitle, description: dict.meta.pricingDescription };
}

export default async function PricingPage({
  searchParams,
}: {
  searchParams: Promise<{ billing?: string | string[] }>;
}) {
  const billingNotice = parseBillingNotice((await searchParams).billing);
  const { dict, t, locale, plural } = await getI18n();
  const P = dict.pricing;
  const { userId } = await auth();
  const signedIn = Boolean(userId);
  const pro = signedIn ? await isPro() : false;
  const credits = userId ? await getCreditBalance(userId) : 0;

  const n = (value: number) => value.toLocaleString(locale);
  // What Stripe charges, in its currency (lib/plan-pricing.ts).
  const pricing = await getProPricing();
  const price = (p: PriceAmount) => formatPrice(p.amount, p.currency, locale);
  const monthlyPrice = price(pricing.monthly);
  const annual = pricing.annual;
  const email = supportEmail();
  const sameModel = modelForPlan("free") === modelForPlan("pro");
  const signUpForPro = `/sign-up?redirect_url=${encodeURIComponent("/pricing")}`;

  const freeBullets = P.free.bullets.map((b) =>
    t(b, { signup: n(FREE_SIGNUP_CREDITS), monthly: n(FREE_MONTHLY_CREDITS) }),
  );
  const proBullets = P.pro.bullets.map((b) => t(b, { count: n(PRO_MONTHLY_CREDITS) }));

  const costRows = [
    {
      action: P.costs.rows.build.action,
      cost: t(P.costs.about, { count: n(CREDITS_PER_GENERATION) }),
      details: t(P.costs.rows.build.details, { min: n(MIN_GENERATION_BALANCE) }),
    },
    {
      action: P.costs.rows.questions.action,
      cost: P.costs.few,
      details: P.costs.rows.questions.details,
    },
    {
      action: P.costs.rows.assistant.action,
      cost: t(P.costs.about, { count: n(CREDITS_PER_EDIT) }),
      details: t(P.costs.rows.assistant.details, {
        free: n(TURN_CREDIT_CAP.free),
        pro: n(TURN_CREDIT_CAP.pro),
      }),
    },
    {
      action: P.costs.rows.studyKit.action,
      cost: t(P.costs.perPart, { count: n(STUDY_KIT_CREDITS_PER_SECTION) }),
      details: t(P.costs.rows.studyKit.details, {
        chars: n(SECTION_TARGET_CHARS),
        parts: n(MAX_SECTIONS_PER_RUN),
        max: n(STUDY_KIT_MAX_CREDITS_PER_SECTION),
      }),
    },
    {
      action: P.costs.rows.studying.action,
      cost: P.costs.zero,
      details: P.costs.rows.studying.details,
    },
  ];

  const limitRows: { label: string; free: string; pro: string }[] = [
    { label: P.limits.signup, free: n(FREE_SIGNUP_CREDITS), pro: n(FREE_SIGNUP_CREDITS) },
    {
      label: P.limits.monthly,
      free: t(P.limits.monthlyFree, { count: n(FREE_MONTHLY_CREDITS) }),
      pro: t(P.limits.monthlyPro, { count: n(PRO_MONTHLY_CREDITS) }),
    },
    { label: P.limits.rollover, free: P.limits.yes, pro: P.limits.yes },
    { label: P.limits.builds, free: n(USAGE_LIMITS.generate.free), pro: n(USAGE_LIMITS.generate.pro) },
    { label: P.limits.messages, free: n(USAGE_LIMITS.agent.free), pro: n(USAGE_LIMITS.agent.pro) },
    { label: P.limits.kits, free: n(USAGE_LIMITS.study_kit.free), pro: n(USAGE_LIMITS.study_kit.pro) },
    { label: P.limits.messageCap, free: n(TURN_CREDIT_CAP.free), pro: n(TURN_CREDIT_CAP.pro) },
    ...(sameModel ? [{ label: P.limits.model, free: P.limits.sameModel, pro: P.limits.sameModel }] : []),
    { label: P.limits.studying, free: P.limits.unlimited, pro: P.limits.unlimited },
  ];

  const faq = [
    ...P.faq,
    ...(annual ? [P.faqAnnual] : []),
  ].map((item) => ({
    q: item.q,
    a: t(item.a, {
      monthly: n(FREE_MONTHLY_CREDITS),
      email,
      count: n(PRO_MONTHLY_CREDITS),
      total: annual ? price(annual.total) : "",
      perMonth: annual ? price(annual.perMonth) : "",
    }),
  }));

  return (
    <div className="min-h-screen overflow-x-clip bg-paper text-ink antialiased">
      <header className="border-b border-line bg-paper/85 backdrop-blur-md">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-3 sm:px-7">
          <Link
            href="/"
            className="flex min-h-10 items-center gap-1.5 font-display text-lg font-extrabold tracking-tight"
          >
            StudyOS
            <span className="mb-2 h-1.5 w-1.5 rounded-full bg-lime" aria-hidden />
          </Link>
          <div className="flex items-center gap-2 sm:gap-3">
            <ThemeToggle />
            <LanguageSwitcher compact />
            {signedIn ? (
              <>
                <Link href="/app" className="hidden min-h-10 items-center text-sm text-ink-soft transition hover:text-ink sm:flex">
                  {dict.common.openApp}
                </Link>
                <UserButton />
              </>
            ) : (
              <>
                <Link href="/sign-in" className="hidden min-h-10 items-center text-sm text-ink-soft transition hover:text-ink sm:flex">
                  {dict.common.signIn}
                </Link>
                <Link
                  href="/sign-up"
                  className="flex min-h-10 items-center rounded-md bg-ink px-4 text-sm font-semibold text-paper shadow-card transition hover:opacity-90"
                >
                  {P.free.ctaSignedOut}
                </Link>
              </>
            )}
          </div>
        </div>
      </header>

      <main id="main-content" className="mx-auto max-w-5xl px-4 py-14 sm:px-7 sm:py-20">
        <div className="text-center">
          <p className="font-mono text-[11.5px] uppercase tracking-[0.18em] text-ink-faint">{P.badge}</p>
          <h1 className="mt-4 font-display text-4xl font-extrabold tracking-tight text-balance sm:text-5xl">
            {P.title}
          </h1>
          <p className="mx-auto mt-4 max-w-2xl text-lg leading-relaxed text-ink-soft">{P.subtitle}</p>
        </div>

        <BillingNotice code={billingNotice} messages={dict.billingNotice} className="mx-auto mt-8 max-w-xl" />

        {/* Plans */}
        <div className="mt-12 grid items-start gap-5 md:grid-cols-2">
          <section aria-labelledby="plan-free" className="flex flex-col rounded-md border border-line bg-card p-6 shadow-card sm:p-8">
            <h2 id="plan-free" className="font-mono text-[12px] uppercase tracking-wide text-ink-soft">
              {P.free.name}
            </h2>
            <p className="mt-3.5 flex items-baseline gap-1 font-display text-5xl font-extrabold tracking-tight">
              {formatPrice(0, pricing.monthly.currency, locale)}
              <span className="text-base font-medium text-ink-faint">{P.free.perMonth}</span>
            </p>
            <p className="mt-1.5 text-sm text-ink-soft">{P.free.tagline}</p>
            <div className="mt-6">
              <Link
                href={signedIn ? "/app" : "/sign-up"}
                className="flex min-h-12 items-center justify-center rounded-md border border-line-strong bg-surface-2 px-5 text-center text-sm font-semibold text-ink transition hover:bg-hover"
              >
                {signedIn ? P.free.ctaSignedIn : P.free.ctaSignedOut}
              </Link>
            </div>
            <div className="my-6 h-px bg-line" />
            <BulletList items={freeBullets} />
          </section>

          <section aria-labelledby="plan-pro" className="relative flex flex-col rounded-md border-[1.5px] border-lime bg-card p-6 shadow-pop sm:p-8">
            <h2 id="plan-pro" className="mb-3.5 font-mono text-[12px] uppercase tracking-wide text-ink-soft">
              {P.pro.name}
            </h2>
            {pro ? (
              <div className="space-y-3">
                <p className="font-display text-5xl font-extrabold tracking-tight">
                  {monthlyPrice}
                  <span className="text-base font-medium text-ink-faint">{P.pro.perMonth}</span>
                </p>
                <p className="rounded-md bg-lime-faint px-4 py-3 text-center text-sm font-semibold text-ink ring-1 ring-inset ring-lime/30">
                  {P.pro.currentPlan}
                </p>
                <form action={manageBillingAction}>
                  <button
                    type="submit"
                    className="min-h-12 w-full rounded-md border border-line-strong bg-surface-2 px-5 text-sm font-semibold text-ink transition hover:bg-hover"
                  >
                    {P.pro.manageBilling}
                  </button>
                </form>
              </div>
            ) : (
              <ProPriceSwitch
                labels={{
                  billingPeriod: P.billingPeriod,
                  monthly: P.monthly,
                  yearly: P.yearly,
                  save: annual && annual.savingsPercent > 0 ? t(P.save, { percent: annual.savingsPercent }) : "",
                  perMonth: P.pro.perMonth,
                  perYear: P.pro.perYear,
                  billedMonthly: P.pro.billedMonthly,
                  billedYearly: annual
                    ? t(P.pro.billedYearly, {
                        total: price(annual.total),
                        perMonth: price(annual.perMonth),
                      })
                    : "",
                  upgrade: P.pro.upgrade,
                  signedOut: P.pro.ctaSignedOut,
                }}
                monthlyPrice={monthlyPrice}
                annualPrice={annual ? price(annual.total) : null}
                checkout={signedIn ? startCheckoutAction : null}
                signUpHref={signUpForPro}
              />
            )}
            <div className="my-6 h-px bg-line" />
            <BulletList items={proBullets} strong />
          </section>
        </div>
        {sameModel && <p className="mt-4 text-center text-sm text-ink-soft">{P.sameModel}</p>}

        {/* What AI actions cost */}
        <section aria-labelledby="costs" className="mt-20">
          <h2 id="costs" className="font-display text-2xl font-bold tracking-tight sm:text-3xl">{P.costs.title}</h2>
          <p className="mt-3 max-w-3xl text-ink-soft">{P.costs.intro}</p>
          <div className="mt-6 overflow-hidden rounded-md border border-line bg-card">
            <table className="w-full border-collapse text-start text-sm">
              <thead className="hidden sm:table-header-group">
                <tr className="border-b border-line bg-surface text-start">
                  <th scope="col" className="px-5 py-3 text-start font-semibold">{P.costs.action}</th>
                  <th scope="col" className="w-32 px-3 py-3 text-start font-semibold">{P.costs.cost}</th>
                  <th scope="col" className="px-5 py-3 text-start font-semibold">{P.costs.details}</th>
                </tr>
              </thead>
              <tbody>
                {costRows.map((row) => (
                  <tr key={row.action} className="block border-b border-line last:border-0 sm:table-row">
                    <th scope="row" className="block px-5 pt-4 text-start font-semibold text-ink sm:table-cell sm:py-4">
                      {row.action}
                    </th>
                    <td className="block px-5 pt-1 font-mono text-sm text-lime-deep sm:table-cell sm:px-3 sm:py-4">
                      <span className="sr-only sm:hidden">{P.costs.cost}: </span>
                      {row.cost}
                    </td>
                    <td className="block px-5 pb-4 pt-1 leading-6 text-ink-soft sm:table-cell sm:py-4">{row.details}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* Free and Pro side by side */}
        <section aria-labelledby="limits" className="mt-20">
          <h2 id="limits" className="font-display text-2xl font-bold tracking-tight sm:text-3xl">{P.limits.title}</h2>
          <div className="mt-6 overflow-hidden rounded-md border border-line bg-card">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-line bg-surface">
                  <th scope="col" className="px-4 py-3 text-start font-semibold sm:px-5">
                    <span className="sr-only">{P.limits.feature}</span>
                  </th>
                  <th scope="col" className="w-24 px-2 py-3 text-center font-semibold text-ink-soft sm:w-40">{P.free.name}</th>
                  <th scope="col" className="w-24 px-2 py-3 text-center font-semibold text-ink sm:w-40">{P.pro.name}</th>
                </tr>
              </thead>
              <tbody>
                {limitRows.map((row, i) => (
                  <tr key={row.label} className={i % 2 === 1 ? "bg-surface" : ""}>
                    <th scope="row" className="px-4 py-3 text-start font-normal text-ink sm:px-5">{row.label}</th>
                    <td className="px-2 py-3 text-center text-ink-soft">{row.free}</td>
                    <td className="bg-lime-faint px-2 py-3 text-center font-medium text-ink">{row.pro}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* Credit pack */}
        <section id="credits" aria-labelledby="credits-title" className="mt-20 scroll-mt-20">
          <div className="grid gap-8 rounded-md border border-line bg-card p-6 shadow-card sm:grid-cols-[1.3fr_1fr] sm:items-center sm:p-10">
            <div>
              <h2 id="credits-title" className="font-display text-2xl font-bold tracking-tight sm:text-3xl">{P.credits.heading}</h2>
              <p className="mt-3 text-ink-soft">{P.credits.intro}</p>
              {signedIn && (
                <p className="mt-5 inline-flex items-center gap-2 rounded-full bg-hover px-3.5 py-1.5 text-sm font-semibold text-ink">
                  <span className="text-lime-deep" aria-hidden>●</span>
                  {plural(dict.counts.balance, credits)}
                </p>
              )}
            </div>
            <div className="rounded-md border border-line-strong bg-surface-2 p-6 text-center shadow-card">
              <p className="font-mono text-[11px] uppercase tracking-wide text-ink-soft">{P.credits.pack}</p>
              <p className="mt-2 font-display text-4xl font-extrabold">{n(CREDIT_PACK_SIZE)}</p>
              <p className="text-sm text-ink-soft">{P.credits.unit}</p>
              <p className="mt-3 font-display text-2xl font-bold">{formatUsd(CREDIT_PACK_PRICE_USD, locale)}</p>
              <p className="mt-1 text-xs text-ink-soft">
                {t(dict.credits.buysApprox, {
                  gens: estimatedGenerations(CREDIT_PACK_SIZE),
                  edits: estimatedEdits(CREDIT_PACK_SIZE),
                })}
              </p>
              <div className="mt-5">
                {signedIn ? (
                  <form action={buyCreditsAction}>
                    <button type="submit" className="min-h-12 w-full rounded-md bg-ink px-5 text-sm font-semibold text-paper transition hover:opacity-90">
                      {t(P.credits.buy, { count: n(CREDIT_PACK_SIZE) })}
                    </button>
                  </form>
                ) : (
                  <Link
                    href="/sign-up"
                    className="flex min-h-12 items-center justify-center rounded-md bg-ink px-5 text-sm font-semibold text-paper transition hover:opacity-90"
                  >
                    {P.credits.signUpToBuy}
                  </Link>
                )}
              </div>
              <p className="mt-3 text-xs text-ink-faint">{P.credits.oneTime}</p>
            </div>
          </div>
        </section>

        {/* FAQ */}
        <section aria-labelledby="faq" className="mt-20">
          <h2 id="faq" className="text-center font-display text-2xl font-bold tracking-tight sm:text-3xl">{P.faqTitle}</h2>
          <div className="mx-auto mt-8 grid max-w-4xl gap-4 md:grid-cols-2">
            {faq.map((item) => (
              <div key={item.q} className="rounded-md border border-line bg-card p-5">
                <h3 className="font-display text-base font-bold text-ink">{item.q}</h3>
                <p className="mt-2 text-sm leading-relaxed text-ink-soft">{item.a}</p>
              </div>
            ))}
          </div>
          <p className="mt-8 text-center text-sm text-ink-soft">
            {withLink(P.support, "{email}", (
              <a key="email" href={`mailto:${email}`} className="font-semibold text-ink underline underline-offset-4">
                {email}
              </a>
            ))}
          </p>
        </section>

        <section className="mt-20 rounded-md bg-primary px-6 py-14 text-center text-primary-foreground">
          <h2 className="font-display text-3xl font-extrabold tracking-tight">{P.ctaTitle}</h2>
          <p className="mx-auto mt-3 max-w-md text-primary-foreground/70">{P.ctaSubtitle}</p>
          <Link
            href={signedIn ? "/generate" : "/sign-up"}
            className="mt-8 inline-flex min-h-12 items-center gap-2 rounded-md bg-paper px-8 text-sm font-bold text-ink transition hover:opacity-90"
          >
            {signedIn ? P.ctaSignedIn : P.ctaSignedOut}
            <span aria-hidden className="rtl:-scale-x-100">→</span>
          </Link>
        </section>
      </main>

      <footer>
        <div className="mx-auto flex max-w-5xl flex-col items-center justify-between gap-3 px-4 py-8 sm:flex-row sm:px-7">
          <Link href="/" className="flex min-h-10 items-center gap-1.5 font-display font-bold text-ink">
            StudyOS
            <span className="mb-2 h-1 w-1 rounded-full bg-lime" aria-hidden />
          </Link>
          <nav aria-label={dict.legal.contact} className="flex flex-wrap items-center justify-center gap-x-5 text-sm text-ink-faint">
            <Link href="/terms" className="flex min-h-10 items-center transition hover:text-ink">{dict.legal.terms}</Link>
            <Link href="/privacy" className="flex min-h-10 items-center transition hover:text-ink">{dict.legal.privacy}</Link>
            <a href={`mailto:${email}`} className="flex min-h-10 items-center transition hover:text-ink">{dict.landing.footer.support}</a>
          </nav>
          <span className="text-center text-sm text-ink-soft">{t(P.footerTagline, { year: new Date().getFullYear() })}</span>
        </div>
      </footer>
    </div>
  );
}

/** Puts `node` where `token` appears in a translated sentence. */
function withLink(template: string, token: string, node: React.ReactNode): React.ReactNode[] {
  const [before, ...rest] = template.split(token);
  return rest.length === 0 ? [template] : [before, node, rest.join(token)];
}

function BulletList({ items, strong = false }: { items: string[]; strong?: boolean }) {
  return (
    <ul className="space-y-3 text-sm">
      {items.map((item) => (
        <li key={item} className="flex items-start gap-2.5">
          <span
            className={`mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full ${
              strong ? "bg-lime text-lime-on" : "bg-hover text-ink-faint"
            }`}
            aria-hidden
          >
            <Check className="h-3 w-3" strokeWidth={3} />
          </span>
          <span className="text-ink-soft">{item}</span>
        </li>
      ))}
    </ul>
  );
}
