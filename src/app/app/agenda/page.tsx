import type { Metadata } from "next";
import Link from "next/link";
import { AccountMenu } from "@/components/account/AccountMenu";
import { BrandMark } from "@/components/BrandMark";
import { AppNav } from "@/components/AppNav";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { ThemeToggle } from "@/components/ThemeToggle";
import { getAgenda } from "@/lib/agenda/agenda";
import { parseAgendaParams } from "@/lib/agenda/build";
import { getI18n } from "@/lib/i18n/server";
import { AgendaView } from "./AgendaView";

// Per-student deadlines that change with every edit and check-off: always
// rendered for the request, never cached (no Cache Components in this app,
// so the route segment config applies).
export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const { dict } = await getI18n();
  return { title: dict.agenda.metaTitle };
}

/**
 * The agenda: everything dated across the student's workspaces for the next
 * two weeks, and what is still open from the two before, grouped by day.
 * ?course=<workspace id> shows one course and ?done=1 adds finished work, so
 * a view can be linked. Free and AI-free, like Today, which it agrees with.
 */
export default async function AgendaPage({
  searchParams,
}: {
  searchParams: Promise<{ course?: string | string[]; done?: string | string[] }>;
}) {
  const params = parseAgendaParams(await searchParams);
  const [data, { dict, locale, t, plural }] = await Promise.all([getAgenda(), getI18n()]);

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
        <AgendaView data={data} params={params} i18n={{ dict, locale, t, plural }} />
      </main>
    </div>
  );
}
