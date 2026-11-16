import type { Metadata, ResolvingMetadata } from "next";
import Link from "next/link";
import { auth } from "@clerk/nextjs/server";
import { Check } from "lucide-react";
import { HelpLayout } from "@/components/help/HelpLayout";
import { JsonLd } from "@/components/JsonLd";
import { GradeCalculator } from "@/components/tools/GradeCalculator";
import { helpMetadata } from "@/lib/help/metadata";
import { getI18n } from "@/lib/i18n/server";
import { faqPageLd, freeToolLd } from "@/lib/seo/structured-data";
import { siteUrl } from "@/lib/site";
import { GRADE_CALCULATOR_PATH } from "@/lib/tools/catalog";
import { cn } from "@/lib/utils";

export async function generateMetadata(_props: unknown, parent: ResolvingMetadata): Promise<Metadata> {
  const { dict } = await getI18n();
  const T = dict.tools.gradeCalculator;
  return helpMetadata({ title: T.metaTitle, description: T.metaDescription, path: GRADE_CALCULATOR_PATH }, parent);
}

const CARD = "rounded-3xl border border-line bg-card";

/**
 * The free grade calculator (/tools/grade-calculator): useful on its own,
 * with no account and nothing stored (its state is the page address), then a
 * short pitch for the grade tracker that does it for every course, and how
 * the numbers are worked out in plain words. Public, like /help: no database.
 */
export default async function GradeCalculatorPage() {
  const [{ dict, locale }, { userId }] = await Promise.all([getI18n(), auth()]);
  const T = dict.tools.gradeCalculator;
  const signedIn = Boolean(userId);

  return (
    <HelpLayout dict={dict} signedIn={signedIn} width="tool">
      <JsonLd
        data={[
          freeToolLd({
            site: siteUrl(),
            path: GRADE_CALCULATOR_PATH,
            // The tool's short name ("Grade calculator", "Notenschnitt-Rechner"), as the footer links it.
            name: T.footerLink,
            description: T.metaDescription,
            language: locale,
          }),
          faqPageLd(T.faq, locale),
        ]}
      />
      <div className="max-w-3xl">
        <h1 className="font-display text-4xl leading-[1.06] text-balance [overflow-wrap:anywhere] sm:text-5xl">{T.title}</h1>
        <p className="mt-4 max-w-[62ch] text-lg leading-relaxed text-ink-soft">{T.subtitle}</p>
      </div>

      <GradeCalculator />

      <section
        aria-labelledby="calc-cta"
        className="mt-16 grid items-center gap-8 rounded-[2rem] bg-oat p-6 sm:p-10 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]"
      >
        <div className="min-w-0">
          <h2 id="calc-cta" className="font-display text-3xl leading-[1.1] text-balance sm:text-4xl">
            {T.ctaTitle}
          </h2>
          <p className="mt-4 max-w-[58ch] text-[17px] leading-7 text-ink-soft">{T.ctaBody}</p>
          <Link
            href={signedIn ? "/app/grades" : "/sign-up"}
            className="mt-7 inline-flex min-h-12 items-center justify-center gap-2 rounded-full bg-lime px-7 text-base font-semibold text-lime-on transition hover:bg-lime-hover"
          >
            {signedIn ? T.ctaSignedIn : T.ctaSignedOut}
            <span aria-hidden className="rtl:-scale-x-100">
              →
            </span>
          </Link>
        </div>
        <ul className="min-w-0 space-y-3">
          {T.ctaPoints.map((point) => (
            <li key={point} className="flex items-start gap-3 rounded-2xl bg-card px-4 py-3.5 text-[15px] leading-6 text-ink">
              <span aria-hidden className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full bg-lime text-lime-on">
                <Check className="size-3.5" strokeWidth={3} />
              </span>
              <span className="min-w-0">{point}</span>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="calc-faq" className="mt-16">
        <h2 id="calc-faq" className="font-display text-3xl leading-[1.1] sm:text-4xl">
          {T.faqTitle}
        </h2>
        <div className="mt-8 grid gap-4 md:grid-cols-2">
          {T.faq.map((item) => (
            // An odd last card spans both columns instead of leaving a gap.
            <div key={item.question} className={cn(CARD, "p-6 md:last:odd:col-span-2")}>
              <h3 className="font-display text-xl leading-snug text-ink">{item.question}</h3>
              <p className="mt-2.5 text-[15px] leading-7 text-ink-soft">{item.answer}</p>
            </div>
          ))}
        </div>
      </section>
    </HelpLayout>
  );
}
