"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useI18n } from "@/lib/i18n/client";
import { sendClientErrorReport } from "@/lib/ops/client-report";

/**
 * Route-level error boundary: friendly, localized, and recoverable. Rendered
 * inside the root layout, so theme + i18n providers are available.
 *
 * "Try again" uses `unstable_retry`, which fetches the route again. `reset`
 * only re-renders what the browser already holds, so after a server error
 * (the database was briefly unreachable, say) it would show the same error.
 */
export default function ErrorPage({
  error,
  unstable_retry: retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  const { dict } = useI18n();
  const E = dict.errors;

  useEffect(() => {
    console.error("[StudyOS] route error:", error);
    sendClientErrorReport(error, "route");
  }, [error]);

  return (
    <div className="grid min-h-screen place-items-center bg-paper px-6 text-ink antialiased">
      <div className="text-center">
        <p className="text-sm font-medium tabular-nums text-ink-faint">
          500
        </p>
        <h1 className="mt-3 font-display text-4xl tracking-tight sm:text-5xl">
          {E.errorTitle}
        </h1>
        <p className="mx-auto mt-4 max-w-md text-ink-soft">{E.errorBody}</p>
        <div className="mt-8 flex items-center justify-center gap-3">
          <button
            type="button"
            onClick={() => retry()}
            className="rounded-full bg-lime px-6 py-3 text-sm font-semibold text-lime-on transition hover:bg-lime-hover"
          >
            {E.tryAgain}
          </button>
          <Link
            href="/"
            className="rounded-full border border-line-strong px-6 py-3 text-sm font-semibold text-ink transition hover:bg-hover"
          >
            {E.backHome}
          </Link>
        </div>
      </div>
    </div>
  );
}
