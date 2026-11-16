import Link from "next/link";
import type { ReactNode } from "react";
import { BrandMark } from "@/components/BrandMark";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { SiteFooterLinks } from "@/components/SiteFooterLinks";
import { ThemeToggle } from "@/components/ThemeToggle";
import type { Dictionary } from "@/lib/i18n/dictionaries/en";
import { supportEmail } from "@/lib/site";
import { cn } from "@/lib/utils";

const CONTAINER = "mx-auto w-full px-4 sm:px-6";
const WIDTH = { reading: "max-w-4xl", tool: "max-w-6xl" } as const;
// On a phone a long label ("Commencer gratuitement") wraps inside the pill
// rather than running off the screen.
const PILL =
  "flex min-h-10 min-w-0 items-center justify-center rounded-full bg-lime px-4 py-1 text-center text-sm leading-tight font-semibold text-lime-on transition hover:bg-lime-hover sm:whitespace-nowrap";

/**
 * Chrome for /help, /help/<slug> and the free tools (/tools/...): the
 * pricing page's header (brand, theme, language, sign in or open the app)
 * and the public pages' footer. Public pages (lib/ops/site-split.ts): served
 * by the website deployment too, so nothing here may need the database.
 * `width` "tool" gives a tool's inputs and result room side by side.
 */
export function HelpLayout({
  dict,
  signedIn,
  width = "reading",
  children,
}: {
  dict: Dictionary;
  signedIn: boolean;
  width?: keyof typeof WIDTH;
  children: ReactNode;
}) {
  const container = cn(CONTAINER, WIDTH[width]);
  return (
    <div className="site-scale min-h-screen overflow-x-clip bg-paper text-ink antialiased">
      <header className="border-b border-line bg-paper/80 backdrop-blur-md">
        <div className={cn(container, "flex items-center justify-between gap-3 py-3")}>
          {/* On the narrowest phones the mark stands alone (the name stays for screen readers), leaving the actions room. */}
          <Link href="/" className="flex min-h-10 shrink-0 items-center gap-1.5 font-display text-lg font-extrabold tracking-tight">
            <BrandMark />
            <span className="max-[420px]:sr-only">StudyOS</span>
          </Link>
          <div className="flex min-w-0 items-center gap-2 sm:gap-3">
            <ThemeToggle />
            <LanguageSwitcher compact />
            {signedIn ? (
              <Link href="/app" className={PILL}>
                {dict.common.openApp}
              </Link>
            ) : (
              <>
                <Link href="/sign-in" className="hidden min-h-10 items-center text-sm text-ink-soft transition hover:text-ink sm:flex">
                  {dict.common.signIn}
                </Link>
                <Link href="/sign-up" className={PILL}>
                  {dict.landing.nav.getStarted}
                </Link>
              </>
            )}
          </div>
        </div>
      </header>

      <main id="main-content" className={cn(container, "py-12 sm:py-16")}>
        {children}
      </main>

      <footer className="border-t border-line">
        <div className={cn(container, "flex flex-col items-center justify-between gap-3 py-8 sm:flex-row")}>
          <Link href="/" className="flex min-h-10 items-center gap-1.5 font-display font-bold text-ink">
            <BrandMark />
            StudyOS
          </Link>
          <SiteFooterLinks
            dict={dict}
            className="flex flex-wrap items-center justify-center gap-x-5 text-sm text-ink-faint"
          />
        </div>
      </footer>
    </div>
  );
}

/** "Still stuck? Email us", at the end of the index and of every article. */
export function StillStuck({ dict }: { dict: Dictionary }) {
  const H = dict.help;
  const email = supportEmail();
  const [before, after = ""] = H.stuckBody.split("{email}");
  return (
    <section aria-labelledby="help-stuck" className="mt-16 rounded-3xl bg-oat p-6 sm:p-8">
      <h2 id="help-stuck" className="font-display text-2xl font-bold tracking-tight text-ink">
        {H.stuckTitle}
      </h2>
      <p className="mt-2 max-w-2xl leading-relaxed text-ink-soft">
        {before}
        <a href={`mailto:${email}`} className="break-all font-semibold text-ink underline underline-offset-4">
          {email}
        </a>
        {after}
      </p>
      <a
        href={`mailto:${email}`}
        className="mt-5 inline-flex min-h-11 items-center rounded-full bg-lime px-5 text-sm font-semibold text-lime-on transition hover:bg-lime-hover"
      >
        {H.stuckButton}
      </a>
    </section>
  );
}
