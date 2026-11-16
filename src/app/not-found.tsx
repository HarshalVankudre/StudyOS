import Link from "next/link";
import { getI18n } from "@/lib/i18n/server";

export default async function NotFound() {
  const { dict } = await getI18n();
  const E = dict.errors;

  return (
    <div className="grid min-h-screen place-items-center bg-paper px-6 text-ink antialiased">
      <div className="text-center">
        <p className="text-sm font-medium tabular-nums text-ink-faint">
          404
        </p>
        <h1 className="mt-3 font-display text-4xl tracking-tight sm:text-5xl">
          {E.notFoundTitle}
        </h1>
        <p className="mx-auto mt-4 max-w-md text-ink-soft">{E.notFoundBody}</p>
        <Link
          href="/"
          className="mt-8 inline-flex items-center gap-2 rounded-full bg-lime px-6 py-3 text-sm font-semibold text-lime-on transition hover:bg-lime-hover"
        >
          {E.backHome}
          <span aria-hidden className="rtl:-scale-x-100">→</span>
        </Link>
      </div>
    </div>
  );
}
