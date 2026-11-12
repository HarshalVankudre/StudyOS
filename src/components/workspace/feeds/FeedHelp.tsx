"use client";

import { ChevronDown } from "lucide-react";
import { useI18n } from "@/lib/i18n/client";

const PLATFORMS = ["canvas", "moodle", "blackboard", "brightspace", "google"] as const;

/** Short, collapsible instructions for finding the calendar link on each platform. */
export function FeedHelp() {
  const { dict } = useI18n();
  const F = dict.feeds;
  return (
    <details className="group rounded-lg border border-line bg-surface">
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 px-3 text-sm font-semibold text-ink [&::-webkit-details-marker]:hidden">
        {F.helpTitle}
        <ChevronDown className="size-4 shrink-0 text-ink-faint transition group-open:rotate-180" aria-hidden />
      </summary>
      <ul className="space-y-2 border-t border-line px-3 py-3 text-sm text-ink-soft">
        {PLATFORMS.map((p) => (
          <li key={p}>
            <span className="font-semibold text-ink">{F.platform[p]}</span>
            {": "}
            {F.help[p]}
          </li>
        ))}
      </ul>
    </details>
  );
}
