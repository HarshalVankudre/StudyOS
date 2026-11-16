"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bot, CalendarDays, ChartColumn, GraduationCap, NotebookPen, Sun, type LucideIcon } from "lucide-react";
import { useI18n } from "@/lib/i18n/client";
import { cn } from "@/lib/utils";

interface Section {
  href: string;
  label: string;
  Icon: LucideIcon;
}

/** Which section a path belongs to ("/app" only for itself: workspaces have their own view). */
export function activeSection(pathname: string, hrefs: string[]): string | null {
  const path = pathname.replace(/\/+$/, "") || "/";
  if (path === "/app") return "/app";
  return hrefs.find((href) => href !== "/app" && (path === href || path.startsWith(`${href}/`))) ?? null;
}

/**
 * The signed-in app's sections as one row of pills under the header: the same
 * on Today, Agenda, Insights, Grades and the Agent Center, and on a phone it
 * scrolls sideways instead of wrapping. The notebook library has it too;
 * the notebook editor is full screen and has its own back link.
 */
export function AppNav({ className }: { className?: string }) {
  const { dict } = useI18n();
  const pathname = usePathname() ?? "/app";
  const sections: Section[] = [
    { href: "/app", label: dict.today.title, Icon: Sun },
    { href: "/app/agenda", label: dict.agenda.label, Icon: CalendarDays },
    { href: "/app/insights", label: dict.insights.label, Icon: ChartColumn },
    { href: "/app/grades", label: dict.gradesOverview.label, Icon: GraduationCap },
    { href: "/app/notebooks", label: dict.notebooks.nav, Icon: NotebookPen },
    { href: "/app/agents", label: dict.agentCenter.label, Icon: Bot },
  ];
  const active = activeSection(pathname, sections.map((s) => s.href));

  return (
    <nav aria-label={dict.shell.appNav} className={cn("-mx-1 overflow-x-auto [scrollbar-width:none]", className)}>
      <ul className="flex w-max items-center gap-1 px-1">
        {sections.map(({ href, label, Icon }) => {
          const current = active === href;
          return (
            <li key={href}>
              <Link
                href={href}
                aria-current={current ? "page" : undefined}
                className={cn(
                  "inline-flex min-h-9 items-center gap-1.5 whitespace-nowrap rounded-full px-3.5 text-sm font-semibold transition",
                  current ? "bg-ink text-paper" : "text-ink-soft hover:bg-hover hover:text-ink",
                )}
              >
                <Icon className="h-4 w-4" aria-hidden />
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
