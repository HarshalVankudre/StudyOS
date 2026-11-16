import type { Metadata } from "next";
import Link from "next/link";
import { AccountMenu } from "@/components/account/AccountMenu";
import { BrandMark } from "@/components/BrandMark";
import { AppNav } from "@/components/AppNav";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { ThemeToggle } from "@/components/ThemeToggle";
import { getGradesOverview } from "@/lib/grades/overview-store";
import { getI18n } from "@/lib/i18n/server";
import { GradesOverviewView } from "./GradesOverviewView";

// Per-student grades that change with every score typed into a tracker:
// always rendered for the request, never cached (no Cache Components in this
// app, so the route segment config applies).
export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const { dict } = await getI18n();
  return { title: dict.gradesOverview.metaTitle };
}

/**
 * Grades overview: where the student stands in every course at once, from
 * the grade trackers in their workspaces. Free and AI-free, like the
 * trackers themselves.
 */
export default async function GradesPage() {
  const { dict, locale, t, plural } = await getI18n();
  const overview = await getGradesOverview({ ukLabels: dict.grades.uk });

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
        <GradesOverviewView overview={overview} i18n={{ dict, locale, t, plural }} />
      </main>
    </div>
  );
}
