"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

/**
 * The credit-balance chip in the app header. Clicking it opens a small popover
 * with the balance and a "Buy credits" button that goes to the dedicated
 * buy-credits page (separate from the upgrade/pricing page).
 */
export function CreditChip({
  credits,
  locale,
}: {
  credits: number;
  locale?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const label = credits.toLocaleString(locale);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        title="AI credits"
        className="flex items-center gap-1.5 rounded-full border border-ink/15 px-3 py-1 text-xs font-semibold text-ink transition hover:border-ink/40 hover:bg-white"
      >
        <span className="text-lime-deep" aria-hidden>
          ●
        </span>
        {label} credits
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-[calc(100%+8px)] z-30 w-60 overflow-hidden rounded-xl border border-ink/10 bg-white p-4 shadow-[0_18px_50px_-22px_rgba(26,23,18,0.45)]"
        >
          <p className="text-xs font-medium uppercase tracking-wide text-ink-soft">
            AI credits
          </p>
          <p className="mt-1 font-display text-2xl font-extrabold text-ink">
            {label}
          </p>
          <p className="mt-1 text-xs text-ink-soft">
            Spent on AI generations and agent edits.
          </p>
          <Link
            href="/app/credits"
            onClick={() => setOpen(false)}
            className="mt-4 block rounded-lg bg-ink px-4 py-2.5 text-center text-sm font-semibold text-paper transition hover:bg-ink/90"
          >
            Buy credits
          </Link>
        </div>
      )}
    </div>
  );
}
