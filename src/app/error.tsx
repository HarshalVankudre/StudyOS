"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useI18n } from "@/lib/i18n/client";

/**
 * Route-level error boundary: friendly, localized, and recoverable. Rendered
 * inside the root layout, so theme + i18n providers are available.
 */
export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const { dict } = useI18n();
  const E = dict.errors;

  useEffect(() => {
    console.error("[StudyOS] route error:", error);
  }, [error]);

  return (
    <div className="grid min-h-screen place-items-center bg-paper px-6 text-ink antialiased">
      <div className="text-center">
        <p className="font-mono text-xs uppercase tracking-[0.16em] text-ink-faint">
          500
        </p>
        <h1 className="mt-4 font-display text-4xl font-bold tracking-tight sm:text-5xl">
          {E.errorTitle}
        </h1>
        <p className="mx-auto mt-4 max-w-md text-ink-soft">{E.errorBody}</p>
        <div className="mt-8 flex items-center justify-center gap-3">
          <button
            type="button"
            onClick={reset}
            className="rounded-lg bg-lime px-6 py-3 text-sm font-semibold text-lime-on transition hover:bg-lime-deep"
          >
            {E.tryAgain}
          </button>
          <Link
            href="/"
            className="rounded-lg border border-line-strong px-6 py-3 text-sm font-semibold text-ink transition hover:bg-hover"
          >
            {E.backHome}
          </Link>
        </div>
      </div>
    </div>
  );
}
