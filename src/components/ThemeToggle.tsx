"use client";

import { useSyncExternalStore } from "react";
import { useTheme } from "next-themes";
import { useI18n } from "@/lib/i18n/client";
import { cn } from "@/lib/utils";

const subscribeToClient = () => () => {};

/**
 * Compact light/dark switch. Rendered as a client island inside the (server)
 * page headers. The `mounted` guard avoids a hydration mismatch, since the icon
 * depends on the resolved theme which is only known on the client.
 */
export function ThemeToggle({ className }: { className?: string }) {
  const { resolvedTheme, setTheme } = useTheme();
  const { dict } = useI18n();
  const mounted = useSyncExternalStore(
    subscribeToClient,
    () => true,
    () => false,
  );

  const isDark = resolvedTheme === "dark";
  // Says what pressing it does, in the visitor's language. Before hydration
  // the theme is unknown; the app's default theme is dark.
  const darkNow = mounted ? isDark : true;
  const label = darkNow ? dict.command.actions.themeLight : dict.command.actions.themeDark;

  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={() => setTheme(isDark ? "light" : "dark")}
      className={cn(
        "grid h-10 w-10 shrink-0 place-items-center sm:h-8 sm:w-8 rounded-md border border-line-strong text-[15px] text-ink-soft transition hover:bg-hover hover:text-ink",
        className,
      )}
    >
      <span aria-hidden suppressHydrationWarning>
        {darkNow ? "☀" : "☾"}
      </span>
    </button>
  );
}
