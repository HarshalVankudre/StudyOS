import { UserButton } from "@clerk/nextjs";
import { auth } from "@clerk/nextjs/server";
import Form from "next/form";
import Link from "next/link";
import { Check } from "lucide-react";
import type { ReactNode } from "react";
import { BrandMark } from "@/components/BrandMark";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { SiteFooterLinks } from "@/components/SiteFooterLinks";
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
import { pricesTaxBehavior } from "@/lib/checkout-config";
import { isBillingConfigured } from "@/lib/stripe";
import { siteUrl } from "@/lib/site";
import { organizationLd, softwareApplicationLd } from "@/lib/seo/structured-data";
import { JsonLd } from "@/components/JsonLd";
import type { Metadata } from "next";
import { cn } from "@/lib/utils";

type Landing = Dictionary["landing"];

/**
 * The landing page in the StudyOS look (tokens in globals.css): warm paper,
 * ink text, bold serif headings over a sans, lime pill buttons, and soft
 * pastel fills (matcha, cloud, heather, oat) for cards, tags and the panels
 * that hold the product samples. Corners are large and borders are hairlines;
 * headings carry the hierarchy, so there are no small labels above them.
 */
const CONTAINER = "mx-auto w-full max-w-[1240px] px-5 sm:px-8";
const BUTTON =
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full text-[15px] font-semibold transition";
const BUTTON_PRIMARY = `${BUTTON} bg-lime text-lime-on hover:bg-lime-hover`;
const BUTTON_SECONDARY = `${BUTTON} border border-line-strong text-ink hover:bg-hover`;
const NAV_LINK = "text-ink-soft transition-colors hover:text-ink";
const CARD = "rounded-3xl border border-line bg-card";
const SECTION_TITLE = "font-display text-4xl leading-[1.08] text-balance sm:text-5xl";
/** The soft fills, in the order sections cycle through them. */
const TINTS = ["bg-matcha", "bg-cloud", "bg-heather", "bg-oat"];

/** The root layout's title and description apply; this page adds its canonical address. */
export const metadata: Metadata = { alternates: { canonical: "/" } };

export default async function Home() {
  const { userId } = await auth();
  const { dict, locale, t } = await getI18n();
  const L = dict.landing;
  const today = renderDay();
  // The same source as the pricing page and checkout: Stripe's price when
  // billing is configured, the configured fallback otherwise (lib/plan-pricing).
  const pro = await getProPricing();
  const { monthly } = pro;
  const price = formatPrice(monthly.amount, monthly.currency, locale);
  // As on the pricing page: with billing on, a Pro price Stripe cannot sell
  // right now is not shown anywhere (no price in the copy, no price card).
  const proUnavailable = isBillingConfigured() && !pro.offered.month;
  // With Stripe Tax on, whether that price includes VAT (as on the pricing page).
  const taxBehavior = pricesTaxBehavior();
  const vatNote = taxBehavior ? (taxBehavior === "inclusive" ? dict.checkout.vatIncluded : dict.checkout.vatExcluded) : null;
  const n = (value: number) => value.toLocaleString(locale);
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
    <div className="site-scale min-h-screen overflow-x-clip bg-paper text-ink antialiased">
      <header className="sticky top-0 z-40 border-b border-line bg-paper/90 backdrop-blur-md">
        <div className={cn(CONTAINER, "flex h-[4.5rem] items-center justify-between gap-2 sm:gap-4")}>
          <Brand />
          <nav aria-label={L.nav.sections} className="hidden items-center gap-8 whitespace-nowrap text-[15px] lg:flex">
            <a href="#how" className={NAV_LINK}>{L.nav.howItWorks}</a>
            <a href="#product" className={NAV_LINK}>{L.nav.features}</a>
            <Link href="/pricing" className={NAV_LINK}>{L.nav.pricing}</Link>
          </nav>
          <div className="flex items-center gap-1.5 sm:gap-2">
            <ThemeToggle />
            <LanguageSwitcher compact />
            {userId ? (
              <>
                <Link href="/app" className={cn(BUTTON_PRIMARY, "hidden min-h-10 px-5 sm:inline-flex")}>
                  {L.nav.openApp}
                </Link>
                <UserButton />
              </>
            ) : (
              <>
                <Link
                  href="/sign-in"
                  className={cn(NAV_LINK, "hidden min-h-10 items-center px-2 text-[15px] font-medium sm:inline-flex")}
                >
                  {L.nav.signIn}
                </Link>
                <Link href="/sign-up" className={cn(BUTTON_PRIMARY, "min-h-10 px-3.5 text-sm sm:px-5 sm:text-[15px]")}>
                  {L.nav.getStarted}
                </Link>
              </>
            )}
          </div>
        </div>
        <nav aria-label={L.nav.sections} className="border-t border-line lg:hidden">
          <div className={cn(CONTAINER, "flex items-center gap-5 overflow-x-auto whitespace-nowrap text-[15px] [scrollbar-width:none]")}>
            <a href="#how" className={cn(NAV_LINK, "flex min-h-11 items-center")}>{L.nav.howItWorks}</a>
            <a href="#product" className={cn(NAV_LINK, "flex min-h-11 items-center")}>{L.nav.features}</a>
            <Link href="/pricing" className={cn(NAV_LINK, "flex min-h-11 items-center")}>{L.nav.pricing}</Link>
            <Link href={userId ? "/app" : "/sign-in"} className={cn(NAV_LINK, "ms-auto flex min-h-11 items-center")}>
              {userId ? L.nav.openApp : L.nav.signIn}
            </Link>
          </div>
        </nav>
      </header>

      <main id="main-content">
        <JsonLd
          data={[
            organizationLd(siteUrl()),
            softwareApplicationLd({
              site: siteUrl(),
              description: dict.meta.homeDescription,
              language: locale,
              pro,
              freeName: L.plans.free,
              proName: L.plans.pro,
            }),
          ]}
        />
        {/* Hero: the headline and the prompt on one side, today's plan on the other. */}
        <section>
          <div className={cn(CONTAINER, "pb-16 pt-10 sm:pb-20 sm:pt-14")}>
            {/* Top-aligned, so the headline and the prompt stay above the fold
                next to the taller sample. */}
            <div className="grid items-start gap-x-16 gap-y-14 lg:grid-cols-[1fr_1.12fr]">
              {/* On a phone the prompt comes straight after the headline, so the
                  first screen already has the one thing to do; the longer pitch
                  follows it. From sm up the order is headline, pitch, prompt. */}
              <div className="flex min-w-0 flex-col lg:pt-8">
                {/* The promise large, how fast it happens as a second, quieter line. */}
                <h1 className="reveal font-display text-5xl leading-[1.04] text-balance sm:text-6xl lg:text-[4.25rem]">
                  {L.hero.titleLine1}{" "}
                  <span className="mt-4 block text-[1.75rem] leading-[1.15] text-ink-soft sm:text-4xl">
                    {L.hero.titleLine2}
                  </span>
                </h1>
                <p
                  className="reveal order-last mt-8 max-w-[62ch] text-[17px] leading-7 text-ink-soft sm:order-none sm:mt-6"
                  style={{ animationDelay: "0.06s" }}
                >
                  {L.hero.subtitle}
                </p>
                <div className="reveal mt-8" style={{ animationDelay: "0.12s" }}>
                  <PromptForm
                    title={L.hero.promptTitle}
                    placeholder={dict.generate.describe.placeholder}
                    build={L.hero.build}
                    finePrint={L.hero.finePrint}
                    seeIt={L.hero.seeIt}
                  />
                </div>
              </div>
              <div className="reveal min-w-0" style={{ animationDelay: "0.14s" }}>
                <TodayPreview dict={dict} locale={locale} today={today} />
                <p className="mt-3 text-center text-sm text-ink-faint">{L.hero.sampleNote}</p>
              </div>
            </div>

            {/* Promises, as a row of tags */}
            <ul aria-label={L.promises.label} className="mt-14 flex flex-wrap gap-2.5">
              {L.promises.items.map((item, i) => (
                <li
                  key={item}
                  className={cn(
                    "inline-flex items-center gap-2 rounded-full px-4 py-2 text-[15px] font-medium text-ink",
                    TINTS[i % TINTS.length],
                  )}
                >
                  <Check className="h-4 w-4 shrink-0" aria-hidden />
                  {item}
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* Made to measure: what sets StudyOS apart from template tools */}
        <section>
          <div className={cn(CONTAINER, "py-16 sm:py-24")}>
            <SectionHeader title={L.tailored.title} subtitle={L.tailored.subtitle} />
            <div className="mt-12 grid gap-4 md:grid-cols-2">
              <div className={cn(CARD, "p-7 sm:p-8")}>
                <p className="inline-flex rounded-full border border-line-strong px-3 py-1 text-sm font-semibold text-ink-soft">
                  {L.tailored.offTheRack.name}
                </p>
                <ul className="mt-6 space-y-3.5 text-[15px] leading-6 text-ink-soft">
                  {L.tailored.offTheRack.points.map((point) => (
                    <li key={point} className="flex gap-3">
                      <span
                        aria-hidden
                        className="mt-[11px] h-0.5 w-4 shrink-0 rounded-full bg-line-strong"
                      />
                      {point}
                    </li>
                  ))}
                </ul>
              </div>
              <div className="rounded-3xl bg-matcha p-7 sm:p-8">
                <p className="inline-flex items-center gap-1.5 rounded-full bg-lime px-3 py-1 text-sm font-semibold text-lime-on">
                  <BrandMark className="h-4 w-4" />
                  {L.tailored.fitted.name}
                </p>
                <ul className="mt-6 space-y-3.5 text-[15px] leading-6 text-ink">
                  {L.tailored.fitted.points.map((point) => (
                    <li key={point} className="flex gap-3">
                      <CheckDot />
                      {point}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </section>

        {/* How it works */}
        <section id="how" className="scroll-mt-32 lg:scroll-mt-20">
          <div className={cn(CONTAINER, "py-16 sm:py-24")}>
            <SectionHeader title={L.how.title} subtitle={L.how.subtitle} />
            <ol className="mt-12 grid gap-4 md:grid-cols-3">
              {L.how.steps.map((step, i) => (
                <li key={step.title} className={cn("rounded-3xl p-7", TINTS[i % TINTS.length])}>
                  <span
                    aria-hidden
                    className="grid h-10 w-10 place-items-center rounded-full bg-card font-display text-lg tabular-nums text-ink"
                  >
                    {i + 1}
                  </span>
                  <h3 className="mt-6 font-display text-2xl leading-tight text-ink">{step.title}</h3>
                  <p className="mt-2.5 text-[15px] leading-6 text-ink-soft">{step.body}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* What it does */}
        <section id="product" className="scroll-mt-32 lg:scroll-mt-20">
          <div className={cn(CONTAINER, "space-y-20 py-16 sm:space-y-28 sm:py-24")}>
            {chapters.map((chapter, i) => (
              <Chapter
                key={chapter.id}
                id={chapter.id}
                copy={chapter.copy}
                flip={i % 2 === 1}
                tint={TINTS[(i + 1) % TINTS.length]}
              >
                {chapter.preview}
              </Chapter>
            ))}
          </div>
        </section>

        {/* Also */}
        <section>
          <div className={cn(CONTAINER, "py-16 sm:py-24")}>
            <h2 className={SECTION_TITLE}>{L.also.title}</h2>
            <ul className="mt-10 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {L.also.items.map((item) => (
                <li key={item.title} className="rounded-2xl border border-line bg-card p-5">
                  <h3 className="font-display text-lg leading-snug text-ink">{item.title}</h3>
                  <p className="mt-1.5 text-sm leading-6 text-ink-soft">{item.body}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* Trust */}
        <section>
          <div className={cn(CONTAINER, "py-16 sm:py-24")}>
            <h2 className={cn(SECTION_TITLE, "max-w-2xl")}>{L.trust.title}</h2>
            <ul className="mt-10 grid gap-4 sm:grid-cols-2">
              {L.trust.items.map((item) => (
                // An odd last card spans both columns instead of leaving a gap.
                <li key={item.title} className={cn(CARD, "flex gap-4 p-6 sm:last:odd:col-span-2")}>
                  <CheckDot className="mt-0.5" />
                  <div className="min-w-0">
                    <h3 className="font-display text-xl leading-snug text-ink">{item.title}</h3>
                    <p className="mt-2 max-w-[75ch] text-[15px] leading-6 text-ink-soft">
                      {t(proUnavailable && item.body.includes("{price}") ? L.trust.billingUnpriced : item.body, {
                        price,
                        trial: n(TRIAL_CREDITS),
                      })}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* Plans */}
        <section>
          <div className={cn(CONTAINER, "py-16 sm:py-24")}>
            <h2 className={cn(SECTION_TITLE, "max-w-2xl")}>
              {proUnavailable ? L.plans.titleUnpriced : t(L.plans.title, { price })}
            </h2>
            <div className="mt-10 grid gap-4 md:grid-cols-2">
              <PlanSummary
                name={L.plans.free}
                price={formatPrice(0, monthly.currency, locale)}
                per={L.plans.perMonth}
                bullets={L.plans.freeBullets.map((b) => t(b, { trial: n(TRIAL_CREDITS) }))}
              />
              <PlanSummary
                name={L.plans.pro}
                price={price}
                per={L.plans.perMonth}
                unavailable={proUnavailable ? dict.credits.unavailable : null}
                bullets={L.plans.proBullets.map((b) => t(b, { count: n(PRO_MONTHLY_CREDITS) }))}
                note={vatNote}
                highlight
              />
            </div>
            <Link
              href="/pricing"
              className="mt-6 inline-flex min-h-11 items-center gap-1.5 text-[15px] font-semibold text-ink underline-offset-4 hover:underline"
            >
              {L.plans.seeAll}
              <span aria-hidden className="rtl:-scale-x-100">→</span>
            </Link>
          </div>
        </section>

        {/* Closing */}
        <section>
          <div className={cn(CONTAINER, "pb-20 pt-8 sm:pb-28")}>
            <div className="rounded-[2rem] bg-oat px-6 py-16 text-center sm:py-24">
              <h2 className="font-display text-4xl leading-[1.06] text-balance sm:text-6xl">
                {L.closing.titleLine1}
                <br />
                {L.closing.titleLine2}
              </h2>
              <p className="mx-auto mt-5 max-w-md text-lg text-ink-soft">{L.closing.subtitle}</p>
              <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
                <Link href={start} className={cn(BUTTON_PRIMARY, "min-h-13 px-7 text-base")}>
                  {L.closing.cta}
                  <span aria-hidden className="rtl:-scale-x-100">→</span>
                </Link>
                <Link href="/pricing" className={cn(BUTTON_SECONDARY, "min-h-13 border-ink/25 px-7 text-base")}>
                  {L.nav.pricing}
                </Link>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-line">
        <div className={cn(CONTAINER, "flex flex-col items-center justify-between gap-4 py-8 sm:flex-row")}>
          <Brand />
          <SiteFooterLinks
            dict={dict}
            className="flex flex-wrap items-center justify-center gap-x-6 gap-y-1 text-[15px]"
            linkClassName="text-ink-soft"
          />
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
    <Link href="/" className="flex min-h-10 items-center gap-2 font-display text-xl sm:text-2xl">
      <BrandMark />
      StudyOS
    </Link>
  );
}

/** A small lime circle with a check: the mark for "yes, this is included". */
function CheckDot({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn("grid h-6 w-6 shrink-0 place-items-center rounded-full bg-lime text-lime-on", className)}
    >
      <Check className="h-3.5 w-3.5" strokeWidth={3} />
    </span>
  );
}

function PromptForm({
  title,
  placeholder,
  build,
  finePrint,
  seeIt,
}: {
  title: string;
  placeholder: string;
  build: string;
  finePrint: string;
  seeIt: string;
}) {
  return (
    <div className="max-w-xl">
      <p className="text-[15px] font-semibold text-ink">{title}</p>
      <Form
        action="/generate"
        className="mt-3 flex flex-col gap-2 rounded-[1.75rem] border border-line-strong bg-card p-2 transition-colors focus-within:border-ink-faint sm:flex-row sm:items-center sm:rounded-full"
      >
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
          className="min-h-12 min-w-0 flex-1 rounded-full bg-transparent px-4 text-base text-ink placeholder:text-ink-faint"
        />
        <button type="submit" className={cn(BUTTON_PRIMARY, "min-h-12 shrink-0 px-7")}>
          {build}
          <span aria-hidden className="rtl:-scale-x-100">→</span>
        </button>
      </Form>
      <div className="mt-3.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-ink-faint">
        <span>{finePrint}</span>
        <a href="#product" className="font-medium text-ink underline underline-offset-4 hover:text-ink-soft">
          {seeIt}
        </a>
      </div>
    </div>
  );
}

function SectionHeader({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="max-w-3xl">
      <h2 className={SECTION_TITLE}>{title}</h2>
      <p className="mt-4 max-w-[60ch] text-lg leading-8 text-ink-soft">{subtitle}</p>
    </div>
  );
}

function Chapter({
  id,
  copy,
  flip,
  tint,
  children,
}: {
  id: string;
  copy: { label: string; title: string; body: string; points: string[] };
  flip: boolean;
  tint: string;
  children: ReactNode;
}) {
  return (
    <article
      id={id}
      aria-labelledby={`${id}-title`}
      className="grid scroll-mt-36 items-center gap-x-14 gap-y-10 lg:scroll-mt-24 lg:grid-cols-2"
    >
      <div className={cn("min-w-0", flip && "lg:order-2")}>
        <h2 id={`${id}-title`} className="font-display text-3xl leading-[1.12] text-balance sm:text-4xl">
          {copy.title}
        </h2>
        <p className="mt-4 text-[17px] leading-7 text-ink-soft">{copy.body}</p>
        <ul className="mt-6 space-y-3.5">
          {copy.points.map((point) => (
            <li key={point} className="flex gap-3 text-[15px] leading-6 text-ink-soft">
              <CheckDot />
              <span>{point}</span>
            </li>
          ))}
        </ul>
      </div>
      {/* The sample sits on a soft panel, like a card laid on coloured paper. */}
      <div className={cn("min-w-0 rounded-[2rem] p-3 sm:p-6", tint, flip && "lg:order-1")}>{children}</div>
    </article>
  );
}

function PlanSummary({
  name,
  price,
  per,
  bullets,
  note = null,
  unavailable = null,
  highlight = false,
}: {
  name: string;
  price: string;
  per: string;
  bullets: string[];
  /** Shown instead of the price (and its note) while the plan cannot be bought. */
  unavailable?: string | null;
  /** A line under the price (the VAT note). */
  note?: string | null;
  highlight?: boolean;
}) {
  return (
    <div className={cn("rounded-3xl p-7 sm:p-8", highlight ? "bg-matcha" : "border border-line bg-card")}>
      <p
        className={cn(
          "inline-flex rounded-full px-3 py-1 text-sm font-semibold text-ink",
          highlight ? "bg-lime text-lime-on" : "border border-line-strong",
        )}
      >
        {name}
      </p>
      {unavailable ? (
        <p className="mt-5 font-display text-3xl leading-tight" data-testid="plan-unavailable">
          {unavailable}
        </p>
      ) : (
        <p className="mt-5 font-display text-6xl leading-none">
          {price}
          <span className="font-sans text-base font-normal tracking-normal text-ink-soft">{per}</span>
        </p>
      )}
      {note && !unavailable && (
        <p className="mt-3 text-sm text-ink-soft" data-testid="vat-note">
          {note}
        </p>
      )}
      <ul className="mt-7 space-y-3 text-[15px] text-ink">
        {bullets.map((b) => (
          <li key={b} className="flex gap-3">
            <CheckDot />
            {b}
          </li>
        ))}
      </ul>
    </div>
  );
}
