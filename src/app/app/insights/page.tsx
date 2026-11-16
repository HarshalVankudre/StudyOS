import type { Metadata } from "next";
import Link from "next/link";
import { AccountMenu } from "@/components/account/AccountMenu";
import { BrandMark } from "@/components/BrandMark";
import { AppNav } from "@/components/AppNav";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { ThemeToggle } from "@/components/ThemeToggle";
import { getI18n } from "@/lib/i18n/server";
import { parsePeriod } from "@/lib/study/insights";
import { getInsights } from "@/lib/study/insights-store";
import { InsightsView } from "./InsightsView";

// Per-student numbers that change with every review and focus block: always
// rendered for the request, never cached (no Cache Components in this app,
// so the route segment config applies).
export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const { dict } = await getI18n();
  return { title: dict.insights.metaTitle };
}

/**
 * Study insights: how the student's studying went over the last 7, 30 or
 * 90 days (?period=7d|30d|90d, so a view can be linked), from what the app
 * already records. Free and AI-free, like every study feature.
 */
export default async function InsightsPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string | string[] }>;
}) {
  const period = parsePeriod((await searchParams).period);
  // Days follow the zone the daily plan uses (else UTC), like Today's focus strip.
  const [insights, { dict, locale, t, plural }] = await Promise.all([getInsights({ period }), getI18n()]);

  return (
    <div className="min-h-screen bg-paper text-ink antialiased">
      <header className="sticky top-0 z-40 border-b border-line bg-paper/90 backdrop-blur-md">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-3.5 sm:px-7">
          <Link href="/app" className="flex shrink-0 items-center gap-2 font-display text-xl">
            <BrandMark />
            StudyOS
          </Link>
          <div className="flex items-center gap-2">
            <div className="hidden sm:block">
              <ThemeToggle />
            </div>
            <div className="hidden md:block">
              <LanguageSwitcher compact />
            </div>
            <AccountMenu variant="header" />
          </div>
        </div>
        <div className="mx-auto max-w-5xl px-4 pb-3 sm:px-7">
          <AppNav />
        </div>
      </header>
      <main id="main-content">
        <InsightsView insights={insights} period={period} i18n={{ dict, locale, t, plural }} />
      </main>
    </div>
  );
}
