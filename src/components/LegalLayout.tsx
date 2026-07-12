import Link from "next/link";
import type { ReactNode } from "react";

/**
 * Shared chrome for /terms and /privacy: brand header, prose column, footer.
 * Legal body text is English-only (the UI chrome stays localized elsewhere).
 */
export function LegalLayout({
  title,
  effectiveDate,
  children,
}: {
  title: string;
  effectiveDate: string;
  children: ReactNode;
}) {
  return (
    <div className="min-h-screen bg-paper text-ink antialiased">
      <header className="border-b border-line">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-6 py-4">
          <Link
            href="/"
            className="flex items-center gap-1.5 font-display text-lg font-extrabold tracking-tight"
          >
            StudyOS
            <span className="mb-2 h-1.5 w-1.5 rounded-full bg-lime" aria-hidden />
          </Link>
          <Link
            href="/"
            className="text-sm text-ink-soft transition hover:text-ink"
          >
            ← Home
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-6 py-14">
        <h1 className="font-display text-4xl font-bold tracking-tight">
          {title}
        </h1>
        <p className="mt-2 font-mono text-xs uppercase tracking-[0.12em] text-ink-faint">
          Effective {effectiveDate}
        </p>
        <div className="legal-prose mt-10 space-y-8 text-[15px] leading-7 text-ink-soft [&_h2]:font-display [&_h2]:text-xl [&_h2]:font-bold [&_h2]:tracking-tight [&_h2]:text-ink [&_ul]:list-disc [&_ul]:space-y-1.5 [&_ul]:pl-5 [&_a]:text-lime-deep [&_a]:underline [&_a]:underline-offset-4 [&_strong]:text-ink">
          {children}
        </div>
      </main>

      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-3 px-6 py-8 text-sm text-ink-faint">
          <span>StudyOS</span>
          <span className="flex gap-5">
            <Link href="/terms" className="transition hover:text-ink">
              Terms
            </Link>
            <Link href="/privacy" className="transition hover:text-ink">
              Privacy
            </Link>
            <a
              href="mailto:harshalvankudre@gmail.com"
              className="transition hover:text-ink"
            >
              Contact
            </a>
          </span>
        </div>
      </footer>
    </div>
  );
}
