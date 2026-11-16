import Link from "next/link";
import type { ReactNode } from "react";
import type { Dictionary } from "@/lib/i18n/dictionaries/en";
import { fmt } from "@/lib/i18n/interpolate";
import { BrandMark } from "@/components/BrandMark";
import { SiteFooterLinks } from "@/components/SiteFooterLinks";

/**
 * Shared chrome for /terms, /privacy and /legal-notice: brand header, prose
 * column, footer. The chrome follows the visitor's language; the legal text
 * itself is published in English only (translations of legal text need their
 * own review), and the page says so in other languages.
 */
export function LegalLayout({
  title,
  effectiveDate,
  dict,
  locale,
  children,
}: {
  title: string;
  /** ISO day (YYYY-MM-DD) the text took effect; omitted for the legal notice. */
  effectiveDate?: string;
  /** The visitor's dictionary and locale, for the chrome around the text. */
  dict: Dictionary;
  locale: string;
  children: ReactNode;
}) {
  const t = fmt;
  const date = effectiveDate
    ? new Date(`${effectiveDate}T12:00:00.000Z`).toLocaleDateString(locale, {
        year: "numeric",
        month: "long",
        day: "numeric",
        timeZone: "UTC",
      })
    : null;

  return (
    <div className="site-scale min-h-screen bg-paper text-ink antialiased">
      <header className="border-b border-line">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-3 sm:px-6">
          <Link
            href="/"
            className="flex min-h-10 items-center gap-1.5 font-display text-lg font-extrabold tracking-tight"
          >
            <BrandMark />
            StudyOS
          </Link>
          <Link href="/" className="flex min-h-10 items-center gap-1 text-sm text-ink-soft transition hover:text-ink">
            <span aria-hidden className="rtl:-scale-x-100">←</span>
            {dict.legal.home}
          </Link>
        </div>
      </header>

      <main id="main-content" className="mx-auto max-w-3xl px-4 py-14 sm:px-6">
        {locale !== "en" && (
          <p className="mb-8 rounded-md border border-line bg-surface px-4 py-3 text-sm text-ink-soft">
            {dict.legal.englishOnly}
          </p>
        )}
        <div lang="en" dir="ltr">
          <h1 className="font-display text-4xl font-bold tracking-tight">{title}</h1>
          {date && (
            <p className="mt-2 text-sm text-ink-faint">
              <span lang={locale}>{t(dict.legal.effective, { date })}</span>
            </p>
          )}
          <div className="legal-prose mt-10 space-y-8 text-[15px] leading-7 text-ink-soft [&_h2]:font-display [&_h2]:text-xl [&_h2]:font-semibold [&_h2]:tracking-tight [&_h2]:text-ink [&_ul]:list-disc [&_ul]:space-y-1.5 [&_ul]:pl-5 [&_a]:text-lime-deep [&_a]:underline [&_a]:underline-offset-4 [&_a]:break-all [&_strong]:text-ink [&_section>*+*]:mt-3 [&_blockquote]:rounded-2xl [&_blockquote]:border [&_blockquote]:border-line [&_blockquote]:bg-oat [&_blockquote]:px-5 [&_blockquote]:py-4 [&_blockquote]:text-ink">
            {children}
          </div>
        </div>
      </main>

      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-3 px-4 py-8 text-sm text-ink-faint sm:px-6">
          <span>StudyOS</span>
          <SiteFooterLinks dict={dict} className="flex flex-wrap gap-x-5" contactLabel={dict.legal.contact} />
        </div>
      </footer>
    </div>
  );
}
