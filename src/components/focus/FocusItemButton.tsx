"use client";

import { Timer } from "lucide-react";
import type { Dictionary } from "@/lib/i18n/dictionaries/en";
import { fmt } from "@/lib/i18n/interpolate";
import { cn } from "@/lib/utils";
import { useFocusLauncher } from "./launcher";

export type FocusItemCopy = Pick<
  Dictionary["focus"],
  "itemButton" | "itemActive" | "expand" | "itemAria" | "itemAriaNoCourse"
>;

/**
 * "Focus" on one piece of work (a Today item, an agenda row): starts a focus
 * session about it, with its title and course on the timer and the minutes
 * saved against its workspace. While the timer runs for this item the
 * button says so and opens the timer. Renders nothing where there is no
 * timer (outside the signed-in app).
 */
export function FocusItemButton({
  itemKey,
  label,
  course,
  workspaceId,
  copy,
}: {
  itemKey: string;
  label: string;
  course: string | null;
  workspaceId: string;
  copy: FocusItemCopy;
}) {
  const focus = useFocusLauncher();
  if (!focus) return null;
  const active = focus.activeItemKey === itemKey;
  return (
    <button
      type="button"
      onClick={() => focus.open({ label, course: course || null, workspaceId, itemKey })}
      aria-label={
        active
          ? copy.expand
          : course
            ? fmt(copy.itemAria, { title: label, course })
            : fmt(copy.itemAriaNoCourse, { title: label })
      }
      className={cn(
        "inline-flex min-h-9 items-center gap-1.5 rounded-full px-3.5 text-[13px] font-semibold text-ink transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lime-deep/60",
        active ? "bg-matcha" : "border border-line-strong hover:bg-hover",
      )}
    >
      {active ? (
        <span className="h-2 w-2 rounded-full bg-lime motion-safe:animate-pulse" aria-hidden />
      ) : (
        <Timer className="h-3.5 w-3.5" aria-hidden />
      )}
      {active ? copy.itemActive : copy.itemButton}
    </button>
  );
}
