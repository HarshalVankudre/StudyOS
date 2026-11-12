"use client";

import { Search } from "lucide-react";
import { useSyncExternalStore } from "react";
import { useI18n } from "@/lib/i18n/client";
import { cn } from "@/lib/utils";
import { emit, isApplePlatform, modKey, OPEN_PALETTE_EVENT } from "./events";

const noop = () => () => {};

/** A visible way into the palette, for touch screens and for discovery. */
export function SearchButton({
  variant = "header",
  className,
}: {
  /** "header": compact button in a toolbar; "floating": round button pinned to the corner. */
  variant?: "header" | "floating";
  className?: string;
}) {
  const { dict, t } = useI18n();
  const apple = useSyncExternalStore(noop, isApplePlatform, () => false);
  const hint = t(dict.command.searchHint, { key: modKey("K", apple) });

  if (variant === "floating") {
    return (
      <button
        type="button"
        onClick={() => emit(OPEN_PALETTE_EVENT)}
        aria-label={dict.command.search}
        aria-keyshortcuts={apple ? "Meta+K" : "Control+K"}
        title={hint}
        data-print="hide"
        className={cn(
          "fixed bottom-[max(1rem,env(safe-area-inset-bottom))] end-4 z-30 grid h-12 w-12 place-items-center rounded-full border border-line-strong bg-card text-ink shadow-pop transition hover:bg-hover",
          className,
        )}
      >
        <Search className="h-5 w-5" aria-hidden />
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={() => emit(OPEN_PALETTE_EVENT)}
      aria-label={dict.command.search}
      aria-keyshortcuts={apple ? "Meta+K" : "Control+K"}
      title={hint}
      className={cn(
        "flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-md text-ink-soft transition hover:bg-hover hover:text-ink sm:min-h-9 sm:min-w-9 lg:border lg:border-line-strong lg:px-2.5",
        className,
      )}
    >
      <Search className="h-4 w-4" aria-hidden />
      <span className="hidden text-xs lg:inline">{dict.command.search}</span>
      <kbd className="hidden font-mono text-[10px] text-ink-faint lg:inline" dir="ltr" suppressHydrationWarning>
        {modKey("K", apple)}
      </kbd>
    </button>
  );
}
