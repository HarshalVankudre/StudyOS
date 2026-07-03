"use client";

import Link from "next/link";
import { useI18n } from "@/lib/i18n/client";
import { isLowBalance } from "@/lib/credits-info";
import { useLiveBalance } from "@/lib/credits-bus";

/**
 * Always-visible credit balance in the workspace header. Seeds from a
 * server-rendered value and updates live after each charged action (via the
 * credits bus). Turns amber with a "Low" tag under the threshold — the
 * "always show remaining allowance, warn before it runs out" transparency the
 * credit-pricing research calls essential. Links to buy more.
 */
export function CreditMeter({ initial }: { initial: number }) {
  const { dict, t, locale } = useI18n();
  const balance = useLiveBalance(initial);
  const low = isLowBalance(balance);

  return (
    <Link
      href="/app/credits"
      title={low ? dict.credits.runningLow : dict.credits.label}
      className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold transition ${
        low
          ? "border-amber-500/40 bg-amber-500/10 text-amber-600 hover:bg-amber-500/20"
          : "border-ink/15 text-ink hover:border-ink/40 hover:bg-card"
      }`}
    >
      <span
        className={low ? "text-amber-500" : "text-lime-deep"}
        aria-hidden
      >
        ●
      </span>
      {t(dict.credits.amount, { count: balance.toLocaleString(locale) })}
      {low && (
        <span className="rounded-full bg-amber-500/20 px-1.5 py-0.5 text-[10px] uppercase tracking-wide">
          {dict.credits.low}
        </span>
      )}
    </Link>
  );
}
