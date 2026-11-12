import { UserButton } from "@clerk/nextjs";
import { auth } from "@clerk/nextjs/server";
import Form from "next/form";
import Link from "next/link";
import { Check, CircleCheck } from "lucide-react";
import type { ReactNode } from "react";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { ThemeToggle } from "@/components/ThemeToggle";
import {
  AssistantPreview,
  FeedPreview,
  GradesPreview,
  PlanToolsPreview,
  StreakPreview,
  StudyKitPreview,
  TodayPreview,
} from "@/components/landing/Previews";
import { renderDay } from "@/components/landing/samples";
import { modelForPlan } from "@/lib/ai/plans";
import { PRO_MONTHLY_CREDITS, publicQuotes, TRIAL_CREDITS, TURN_CREDIT_CAP } from "@/lib/price-list";
import type { Dictionary } from "@/lib/i18n/dictionaries/en";
import { getI18n } from "@/lib/i18n/server";
import { formatPrice, getProPricing } from "@/lib/plan-pricing";
import { supportEmail } from "@/lib/site";
import { cn } from "@/lib/utils";

type Landing = Dictionary["landing"];

export default async function Home() {
  const { userId } = await auth();
  const { dict, locale, t } = await getI18n();
  const L = dict.landing;
  const today = renderDay();
  // The same source as the pricing page and checkout: Stripe's price when
  // billing is configured, the configured fallback otherwise (lib/plan-pricing).
  const { monthly } = await getProPricing();
  const price = formatPrice(monthly.amount, monthly.currency, locale);
  const n = (value: number) => value.toLocaleString(locale);
  const email = supportEmail();
  const start = userId ? "/generate" : "/sign-up";
  // A message's price on the configured models (lib/price-list.ts).
  const message = publicQuotes({ free: modelForPlan("free"), pro: modelForPlan("pro") }).message.price;

  const chapters: {
    id: string;
    copy: Landing["chapters"]["deadlines"];
    preview: ReactNode;
  }[] = [
    { id: "deadlines", copy: L.chapters.deadlines, preview: <FeedPreview dict={dict} locale={locale} /> },
    { id: "today", copy: L.chapters.today, preview: <PlanToolsPreview dict={dict} locale={locale} today={today} /> },
    { id: "material", copy: L.chapters.material, preview: <StudyKitPreview dict={dict} locale={locale} /> },
    { id: "flashcards", copy: L.chapters.flashcards, preview: <StreakPreview dict={dict} locale={locale} today={today} /> },
    { id: "grades", copy: L.chapters.grades, preview: <GradesPreview dict={dict} locale={locale} /> },
    {
      id: "assistant",
      copy: {
        ...L.chapters.assistant,
        points: L.chapters.assistant.points.map((p) =>
          t(p, { message: n(message), free: n(TURN_CREDIT_CAP.free), pro: n(TURN_CREDIT_CAP.pro) }),
        ),
      },
      preview: <AssistantPreview dict={dict} locale={locale} today={today} />,
    },
  ];

  return (
    <div className="min-h-screen overflow-x-clip bg-paper text-ink antialiased">
      <header className="sticky top-0 z-40 border-b border-line bg-paper/85 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3 sm:px-7">
          <Brand />
          <nav aria-label={L.nav.sections} className="hidden items-center gap-8 text-sm text-ink-soft md:flex">
            <a href="#how" className="transition-colors hover:text-ink">{L.nav.howItWorks}</a>
            <a href="#product" className="transition-colors hover:text-ink">{L.nav.features}</a>
            <Link href="/pricing" className="transition-colors hover:text-ink">{L.nav.pricing}</Link>
          </nav>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <LanguageSwitcher compact />
            {userId ? (
              <>
                <Link
                  href="/app"
                  className="hidden min-h-10 items-center rounded-lg bg-lime px-4 text-[13px] font-semibold text-lime-on transition hover:bg-lime-deep sm:inline-flex"
                >
                  {L.nav.openApp}
                </Link>
                <UserButton />
              </>
            ) : (
              <>
                <Link
                  href="/sign-in"
                  className="hidden min-h-10 items-center px-3 text-[13px] font-medium text-ink-soft transition hover:text-ink sm:inline-flex"
                >
                  {L.nav.signIn}
                </Link>
                <Link
                  href="/sign-up"
                  className="inline-flex min-h-10 items-center whitespace-nowrap rounded-lg bg-lime px-3 text-xs font-semibold text-lime-on transition hover:bg-lime-deep sm:px-4 sm:text-[13px]"
                >
                  {L.nav.getStarted}
                </Link>
              </>
            )}
          </div>
        </div>
        <nav aria-label={L.nav.sections} className="border-t border-line md:hidden">
          <div className="mx-auto flex max-w-6xl items-center gap-5 overflow-x-auto px-4 text-sm whitespace-nowrap text-ink-soft">
            <a href="#how" className="flex min-h-11 items-center hover:text-ink">{L.nav.howItWorks}</a>
            <a href="#product" className="flex min-h-11 items-center hover:text-ink">{L.nav.features}</a>
            <Link href="/pricing" className="flex min-h-11 items-center hover:text-ink">{L.nav.pricing}</Link>
            <Link href={userId ? "/app" : "/sign-in"} className="ms-auto flex min-h-11 items-center hover:text-ink">
              {userId ? L.nav.openApp : L.nav.signIn}
            </Link>
          </div>
        </nav>
      </header>

      <main id="main-content">
        {/* Hero */}
        <section className="border-b border-line">
          <div className="mx-auto grid max-w-6xl items-start gap-12 px-4 py-14 sm:px-7 sm:py-20 lg:grid-cols-[1fr_0.95fr] lg:gap-14">
            <div className="min-w-0">
              <p className="reveal flex items-center gap-2.5 font-mono text-[11px] uppercase tracking-[0.14em] text-ink-faint">
                <span className="h-2 w-2 shrink-0 rounded-full bg-lime" aria-hidden />
                {L.hero.badge}
              </p>
              <h1
                className="reveal mt-5 font-display text-[2.6rem] font-bold leading-[1.02] tracking-[-0.03em] text-balance sm:text-[3.6rem]"
                style={{ animationDelay: "0.06s" }}
              >
                {L.hero.titleLine1}{" "}
                <span className="font-medium italic text-lime">{L.hero.titleLine2}</span>
              </h1>
              <p
                className="reveal mt-6 max-w-[46ch] text-[17px] leading-7 text-ink-soft"
                style={{ animationDelay: "0.12s" }}
              >
                {L.hero.subtitle}
              </p>
              <div className="reveal mt-8" style={{ animationDelay: "0.18s" }}>
                <PromptCard
                  title={L.hero.promptTitle}
                  example={dict.generate.examples[1].text}
                  placeholder={dict.generate.describe.placeholder}
                  build={L.hero.build}
                  finePrint={L.hero.finePrint}
                  seeIt={L.hero.seeIt}
                />
              </div>
            </div>
            <div className="reveal min-w-0" style={{ animationDelay: "0.14s" }}>
              <TodayPreview dict={dict} locale={locale} today={today} />
              <p className="mt-3 text-center text-xs text-ink-faint">{L.hero.sampleNote}</p>
            </div>
          </div>
        </section>

        {/* Promises */}
        <section aria-label={L.promises.label} className="border-b border-line bg-surface">
          <ul className="mx-auto grid max-w-6xl gap-x-6 gap-y-3 px-4 py-5 text-sm text-ink-soft sm:grid-cols-2 sm:px-7 lg:grid-cols-4">
            {L.promises.items.map((item) => (
              <li key={item} className="flex items-start gap-2">
                <CircleCheck className="mt-0.5 h-4 w-4 shrink-0 text-lime-deep" aria-hidden />
                {item}
              </li>
            ))}
          </ul>
        </section>

        {/* How it works */}
        <section id="how" className="scroll-mt-28 border-b border-line md:scroll-mt-20">
          <div className="mx-auto max-w-6xl px-4 py-16 sm:px-7 sm:py-24">
            <SectionHeader eyebrow={L.how.eyebrow} title={L.how.title} subtitle={L.how.subtitle} />
            <ol className="mt-10 grid gap-4 md:grid-cols-3">
              {L.how.steps.map((step, i) => (
                <li key={step.title} className="rounded-xl border border-line bg-card p-5 shadow-card">
                  <span className="grid h-8 w-8 place-items-center rounded-full bg-lime-faint font-mono text-sm font-semibold text-lime-deep" aria-hidden>
                    {i + 1}
                  </span>
                  <h3 className="mt-4 font-display text-lg font-semibold text-ink">{step.title}</h3>
                  <p className="mt-2 text-sm leading-6 text-ink-soft">{step.body}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* What it does */}
        <section id="product" className="scroll-mt-28 border-b border-line md:scroll-mt-20">
          <div className="mx-auto max-w-6xl space-y-20 px-4 py-16 sm:px-7 sm:py-24">
            {chapters.map((chapter, i) => (
              <Chapter
                key={chapter.id}
                id={chapter.id}
                number={String(i + 1).padStart(2, "0")}
                copy={chapter.copy}
                flip={i % 2 === 1}
              >
                {chapter.preview}
              </Chapter>
            ))}
          </div>
        </section>

        {/* Also */}
        <section className="border-b border-line">
          <div className="mx-auto max-w-6xl px-4 py-16 sm:px-7 sm:py-20">
            <h2 className="font-display text-3xl font-semibold tracking-[-0.02em] sm:text-4xl">{L.also.title}</h2>
            <ul className="mt-8 grid gap-px overflow-hidden rounded-xl border border-line bg-line sm:grid-cols-2 lg:grid-cols-4">
              {L.also.items.map((item) => (
                <li key={item.title} className="bg-card p-5">
                  <h3 className="text-sm font-semibold text-ink">{item.title}</h3>
                  <p className="mt-1.5 text-sm leading-6 text-ink-soft">{item.body}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* Trust */}
        <section className="border-b border-line bg-surface">
          <div className="mx-auto max-w-6xl px-4 py-16 sm:px-7 sm:py-20">
            <h2 className="max-w-2xl font-display text-3xl font-semibold tracking-[-0.02em] sm:text-4xl">{L.trust.title}</h2>
            <ul className="mt-8 grid gap-4 sm:grid-cols-2">
              {L.trust.items.map((item) => (
                // An odd last card spans both columns instead of leaving a gap.
                <li key={item.title} className="rounded-xl border border-line bg-card p-5 sm:last:odd:col-span-2">
                  <h3 className="flex items-center gap-2 font-semibold text-ink">
                    <Check className="h-4 w-4 shrink-0 text-lime-deep" aria-hidden />
                    {item.title}
                  </h3>
                  <p className="mt-2 text-sm leading-6 text-ink-soft">{t(item.body, { price, trial: n(TRIAL_CREDITS) })}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* Plans */}
        <section className="border-b border-line">
          <div className="mx-auto max-w-6xl px-4 py-16 sm:px-7 sm:py-20">
            <h2 className="font-display text-3xl font-semibold tracking-[-0.02em] sm:text-4xl">
              {t(L.plans.title, { price })}
            </h2>
            <div className="mt-8 grid gap-4 md:grid-cols-2">
              <PlanSummary
                name={L.plans.free}
                price={formatPrice(0, monthly.currency, locale)}
                per={L.plans.perMonth}
                bullets={L.plans.freeBullets.map((b) =>
                  t(b, { trial: n(TRIAL_CREDITS) }),
                )}
              />
              <PlanSummary
                name={L.plans.pro}
                price={price}
                per={L.plans.perMonth}
                bullets={L.plans.proBullets.map((b) => t(b, { count: n(PRO_MONTHLY_CREDITS) }))}
                highlight
              />
            </div>
            <Link
              href="/pricing"
              className="mt-6 inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-ink underline-offset-4 hover:underline"
            >
              {L.plans.seeAll}
              <span aria-hidden className="rtl:-scale-x-100">→</span>
            </Link>
          </div>
        </section>

        {/* Closing */}
        <section className="px-4 sm:px-7">
          <div className="mx-auto max-w-6xl py-20 text-center sm:py-24">
            <h2 className="font-display text-4xl font-bold leading-[1.05] tracking-[-0.03em] sm:text-5xl">
              {L.closing.titleLine1}
              <br />
              <span className="font-medium italic text-ink-soft">{L.closing.titleLine2}</span>
            </h2>
            <p className="mx-auto mt-5 max-w-md text-[17px] text-ink-soft">{L.closing.subtitle}</p>
            <Link
              href={start}
              className="mt-8 inline-flex min-h-12 items-center gap-2 rounded-xl bg-lime px-7 text-sm font-bold text-lime-on transition hover:bg-lime-deep"
            >
              {L.closing.cta}
              <span aria-hidden className="rtl:-scale-x-100">→</span>
            </Link>
          </div>
        </section>
      </main>

      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-4 py-8 sm:flex-row sm:px-7">
          <Brand />
          <nav aria-label={dict.legal.contact} className="flex flex-wrap items-center justify-center gap-x-5 gap-y-1 text-sm text-ink-faint">
            <Link href="/pricing" className="flex min-h-10 items-center transition hover:text-ink">{L.nav.pricing}</Link>
            <Link href="/terms" className="flex min-h-10 items-center transition hover:text-ink">{dict.legal.terms}</Link>
            <Link href="/privacy" className="flex min-h-10 items-center transition hover:text-ink">{dict.legal.privacy}</Link>
            <a href={`mailto:${email}`} className="flex min-h-10 items-center transition hover:text-ink">{L.footer.support}</a>
          </nav>
          <span className="text-center text-sm text-ink-faint">
            {t(L.footer.tagline, { year: new Date().getFullYear() })}
          </span>
        </div>
      </footer>
    </div>
  );
}

function Brand() {
  return (
    <Link href="/" className="flex min-h-10 items-center gap-1.5 font-display text-xl font-bold tracking-[-0.02em]">
      StudyOS
      <span className="mb-2 h-1.5 w-1.5 rounded-full bg-lime" aria-hidden />
    </Link>
  );
}

function PromptCard({
  title,
  example,
  placeholder,
  build,
  finePrint,
  seeIt,
}: {
  title: string;
  example: string;
  placeholder: string;
  build: string;
  finePrint: string;
  seeIt: string;
}) {
  return (
    <div className="max-w-[480px] rounded-2xl border border-line-strong bg-surface p-4 shadow-pop">
      <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-faint">{title}</p>
      <p className="mt-2 font-display text-lg italic leading-7 text-ink">“{example}”</p>
      <Form action="/generate" className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center">
        <label htmlFor="landing-prompt" className="sr-only">
          {placeholder}
        </label>
        <input
          id="landing-prompt"
          name="prompt"
          type="text"
          required
          maxLength={2000}
          placeholder={placeholder}
          className="min-h-11 min-w-0 flex-1 rounded-lg border border-line bg-card px-3 text-sm text-ink outline-none transition placeholder:text-ink-faint focus:border-lime/50 focus:ring-2 focus:ring-lime/10"
        />
        <button
          type="submit"
          className="inline-flex min-h-11 shrink-0 items-center justify-center gap-1 rounded-lg bg-lime px-5 text-sm font-semibold text-lime-on transition hover:bg-lime-deep"
        >
          {build}
          <span aria-hidden className="rtl:-scale-x-100">→</span>
        </button>
      </Form>
      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-faint">
        <span>{finePrint}</span>
        <a href="#product" className="text-ink-soft underline underline-offset-4 hover:text-ink">
          {seeIt}
        </a>
      </div>
    </div>
  );
}

function SectionHeader({ eyebrow, title, subtitle }: { eyebrow: string; title: string; subtitle: string }) {
  return (
    <div className="max-w-3xl">
      <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-lime-deep">{eyebrow}</p>
      <h2 className="mt-3 font-display text-3xl font-semibold leading-[1.08] tracking-[-0.02em] sm:text-[2.6rem]">{title}</h2>
      <p className="mt-4 max-w-[60ch] text-[16px] leading-7 text-ink-soft">{subtitle}</p>
    </div>
  );
}

function Chapter({
  id,
  number,
  copy,
  flip,
  children,
}: {
  id: string;
  number: string;
  copy: { label: string; title: string; body: string; points: string[] };
  flip: boolean;
  children: ReactNode;
}) {
  return (
    <article
      id={id}
      aria-labelledby={`${id}-title`}
      className="grid scroll-mt-28 items-start gap-8 md:scroll-mt-20 lg:grid-cols-2 lg:gap-14"
    >
      <div className={cn("min-w-0", flip && "lg:order-2")}>
        <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-lime-deep">
          {number} · {copy.label}
        </p>
        <h2 id={`${id}-title`} className="mt-3 font-display text-3xl font-semibold leading-[1.1] tracking-[-0.02em] sm:text-[2.3rem]">
          {copy.title}
        </h2>
        <p className="mt-4 text-[16px] leading-7 text-ink-soft">{copy.body}</p>
        <ul className="mt-5 space-y-2.5">
          {copy.points.map((point) => (
            <li key={point} className="flex gap-2.5 text-sm leading-6 text-ink-soft">
              <Check className="mt-1 h-4 w-4 shrink-0 text-lime-deep" aria-hidden />
              <span>{point}</span>
            </li>
          ))}
        </ul>
      </div>
      <div className={cn("min-w-0", flip && "lg:order-1")}>{children}</div>
    </article>
  );
}

function PlanSummary({
  name,
  price,
  per,
  bullets,
  highlight = false,
}: {
  name: string;
  price: string;
  per: string;
  bullets: string[];
  highlight?: boolean;
}) {
  return (
    <div className={cn("rounded-xl border bg-card p-6", highlight ? "border-lime shadow-pop" : "border-line shadow-card")}>
      <p className="font-mono text-xs uppercase tracking-wide text-ink-soft">{name}</p>
      <p className="mt-2 font-display text-4xl font-bold tracking-tight">
        {price}
        <span className="text-base font-medium text-ink-faint">{per}</span>
      </p>
      <ul className="mt-4 space-y-2 text-sm text-ink-soft">
        {bullets.map((b) => (
          <li key={b} className="flex gap-2">
            <Check className={cn("mt-0.5 h-4 w-4 shrink-0", highlight ? "text-lime-deep" : "text-ink-faint")} aria-hidden />
            {b}
          </li>
        ))}
      </ul>
    </div>
  );
}
