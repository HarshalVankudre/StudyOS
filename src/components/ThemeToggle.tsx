"use client";

import { useEffect, useState } from "react";
import { useTheme } from "next-themes";
import { cn } from "@/lib/utils";

/**
 * Compact light/dark switch. Rendered as a client island inside the (server)
 * page headers. The `mounted` guard avoids a hydration mismatch, since the icon
 * depends on the resolved theme which is only known on the client.
 */
export function ThemeToggle({ className }: { className?: string }) {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const isDark = resolvedTheme === "dark";

  return (
    <button
      type="button"
      aria-label="Toggle theme"
      onClick={() => setTheme(isDark ? "light" : "dark")}
      className={cn(
        "grid h-8 w-8 shrink-0 place-items-center rounded-md border border-line-strong text-[15px] text-ink-soft transition hover:bg-hover hover:text-ink",
        className,
      )}
    >
      <span aria-hidden suppressHydrationWarning>
        {mounted && isDark ? "☀" : "☾"}
      </span>
    </button>
  );
}
