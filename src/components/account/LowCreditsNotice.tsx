"use client";

import Link from "next/link";
import { useSyncExternalStore } from "react";
import { X } from "lucide-react";
import { useI18n } from "@/lib/i18n/client";
import { isLowBalance } from "@/lib/credits-info";
import { useLiveBalance } from "@/lib/credits-bus";

/** Hidden for this long after "Hide for a week". */
export const LOW_CREDITS_SNOOZE_MS = 7 * 24 * 60 * 60 * 1000;
const STORAGE_KEY = "studyos_low_credits_snoozed_at";

const listeners = new Set<() => void>();
function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** True while a snooze from this browser is still running (storage may be unavailable). */
export function snoozed(now = Date.now()): boolean {
  try {
    const at = Number(window.localStorage.getItem(STORAGE_KEY));
    return Number.isFinite(at) && at > 0 && now - at < LOW_CREDITS_SNOOZE_MS;
  } catch {
    return false;
  }
}

function snooze() {
  try {
    window.localStorage.setItem(STORAGE_KEY, String(Date.now()));
  } catch {
    // No storage (private window): hidden until the page is reloaded.
  }
  for (const listener of listeners) listener();
}

/**
 * A quiet note on Today when the balance is low (the workspace meter's
 * threshold, lib/credits-info), with the ways to get more: Pro for a Free
 * student while it is on sale, and the credits page (packs, invites). It
 * goes away by itself once credits arrive (the live balance), and "Hide for
 * a week" snoozes it in this browser. Rendered only after hydration: the
 * server cannot know about a snooze.
 */
export function LowCreditsNotice({
  credits: initial,
  showPro,
}: {
  credits: number;
  /** A Free student and Pro can be bought right now. */
  showPro: boolean;
}) {
  const { dict, plural, t } = useI18n();
  const balance = useLiveBalance(initial);
  // Server and first client render: hidden (a snooze lives in this browser only).
  const hidden = useSyncExternalStore(subscribe, snoozed, () => true);
  const L = dict.credits.lowNotice;

  if (hidden || !isLowBalance(balance)) return null;

  return (
    <section
      aria-labelledby="low-credits-title"
      className="mb-6 flex flex-col gap-3 rounded-2xl bg-oat px-5 py-4 sm:flex-row sm:items-center sm:gap-5"
    >
      <div className="min-w-0 flex-1">
        <h2 id="low-credits-title" className="font-display text-lg leading-snug text-ink">
          {L.title}
        </h2>
        <p className="mt-0.5 text-sm leading-6 text-ink-soft">
          {t(L.body, { balance: plural(dict.counts.credits, balance) })}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {showPro && (
          <Link
            href="/pricing"
            className="inline-flex min-h-10 items-center rounded-full bg-lime px-4 text-sm font-semibold text-lime-on transition hover:bg-lime-hover"
          >
            {L.seePro}
          </Link>
        )}
        <Link
          href="/app/credits"
          className="inline-flex min-h-10 items-center rounded-full border border-line-strong bg-card px-4 text-sm font-semibold text-ink transition hover:bg-hover"
        >
          {L.more}
        </Link>
        <button
          type="button"
          onClick={snooze}
          aria-label={L.snooze}
          title={L.snooze}
          className="inline-flex h-10 w-10 items-center justify-center rounded-full text-ink-soft transition hover:bg-hover hover:text-ink"
        >
          <X className="h-4 w-4" aria-hidden />
        </button>
      </div>
    </section>
  );
}
