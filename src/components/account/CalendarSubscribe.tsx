"use client";

import { useState, useTransition } from "react";
import { useI18n } from "@/lib/i18n/client";
import { resetCalendarFeedAction } from "@/app/app/calendar-actions";

/**
 * Calendar-subscription panel for the settings page. Shows the user's private
 * ICS feed URL with copy + "add to calendar" (webcal://) affordances and a
 * reset that rotates the link. The URL is a capability token, so the copy is
 * explicit that anyone holding it can see the user's deadlines.
 */
export function CalendarSubscribe({ initialUrl }: { initialUrl: string | null }) {
  const { dict } = useI18n();
  const C = dict.calendar;
  const [url, setUrl] = useState(initialUrl);
  const [copied, setCopied] = useState(false);
  const [pending, startTransition] = useTransition();

  if (!url) return null;
  const webcal = url.replace(/^https?:\/\//, "webcal://");

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard blocked — the input is selectable as a fallback.
    }
  };

  const reset = () =>
    startTransition(async () => {
      const next = await resetCalendarFeedAction();
      if (next) setUrl(next);
    });

  return (
    <div>
      <div className="flex items-stretch gap-2">
        <input
          readOnly
          value={url}
          onFocus={(e) => e.currentTarget.select()}
          aria-label={C.urlLabel}
          className="min-w-0 flex-1 rounded-lg border border-ink/15 bg-paper px-3 py-2 font-mono text-xs text-ink-soft outline-none focus:border-ink/40"
        />
        <button
          onClick={copy}
          className="shrink-0 rounded-lg border border-ink/15 bg-card px-4 py-2 text-sm font-semibold text-ink transition hover:border-ink/40"
        >
          {copied ? C.copied : C.copy}
        </button>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <a
          href={webcal}
          className="rounded-lg bg-ink px-4 py-2 text-sm font-semibold text-paper transition hover:bg-ink/90"
        >
          {C.addToCalendar}
        </a>
        <button
          onClick={reset}
          disabled={pending}
          className="text-sm font-medium text-ink-soft transition hover:text-rose-600 disabled:opacity-50"
        >
          {pending ? C.resetting : C.reset}
        </button>
      </div>

      <p className="mt-3 text-xs text-ink-soft">{C.instructions}</p>
    </div>
  );
}
