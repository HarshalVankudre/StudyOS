"use client";

import { BellRing, CalendarClock, Moon, Sunrise } from "lucide-react";
import { useI18n } from "@/lib/i18n/client";
import { fmt } from "@/lib/i18n/interpolate";

/**
 * What the student is about to allow, shown BEFORE the browser's permission
 * prompt (which can only be answered once: a "Block" is hard to undo).
 */
export function PermissionExplainer({
  cap,
  pending,
  onContinue,
  onCancel,
}: {
  cap: number;
  pending: boolean;
  onContinue: () => void;
  onCancel: () => void;
}) {
  const { dict } = useI18n();
  const N = dict.notifications;
  return (
    <div className="rounded-md border border-line-strong bg-surface p-4" role="group" aria-labelledby="notify-explain-title">
      <p id="notify-explain-title" className="flex items-center gap-2 text-sm font-semibold text-ink">
        <BellRing className="h-4 w-4 text-lime-deep" aria-hidden />
        {N.explainTitle}
      </p>
      <p className="mt-2 text-sm leading-6 text-ink-soft">{N.explainBody}</p>
      <ul className="mt-2 space-y-1.5 text-sm leading-6 text-ink-soft">
        <li className="flex gap-2">
          <Sunrise className="mt-1 h-4 w-4 shrink-0 text-lime-deep" aria-hidden />
          {N.explainDaily}
        </li>
        <li className="flex gap-2">
          <CalendarClock className="mt-1 h-4 w-4 shrink-0 text-lime-deep" aria-hidden />
          {N.explainDeadlines}
        </li>
        <li className="flex gap-2">
          <Moon className="mt-1 h-4 w-4 shrink-0 text-lime-deep" aria-hidden />
          {fmt(N.explainControl, { cap })}
        </li>
      </ul>
      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onContinue}
          disabled={pending}
          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-ink px-5 text-sm font-semibold text-paper transition hover:opacity-90 disabled:opacity-60"
        >
          {pending && (
            <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-r-transparent" aria-hidden />
          )}
          {pending ? N.turningOn : N.continue}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={pending}
          className="inline-flex min-h-11 items-center justify-center rounded-md border border-line-strong bg-card px-4 text-sm font-semibold text-ink-soft transition hover:text-ink disabled:opacity-60"
        >
          {N.cancel}
        </button>
      </div>
    </div>
  );
}
