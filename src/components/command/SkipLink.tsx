"use client";

import { useI18n } from "@/lib/i18n/client";

/**
 * "Skip to main content": the first stop for keyboard users. Moves focus to
 * #main-content when a page marks one, else to the page's <main>, without
 * every page having to opt in.
 */
export function SkipLink() {
  const { dict } = useI18n();
  return (
    <a
      href="#main-content"
      onClick={(e) => {
        const target = document.getElementById("main-content") ?? document.querySelector("main");
        if (!(target instanceof HTMLElement)) return;
        e.preventDefault();
        if (!target.hasAttribute("tabindex")) target.setAttribute("tabindex", "-1");
        target.focus({ preventScroll: false });
        target.scrollIntoView({ block: "start" });
      }}
      data-print="hide"
      className="sr-only rounded-md bg-ink px-4 py-2.5 text-sm font-semibold text-paper shadow-pop focus:not-sr-only focus:fixed focus:start-3 focus:top-3 focus:z-[100]"
    >
      {dict.shell.skipToContent}
    </a>
  );
}
