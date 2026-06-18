import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import {
  CREDIT_PACK_PRICE_USD,
  CREDIT_PACK_SIZE,
  getCreditBalance,
} from "@/lib/credits";
import { getI18n } from "@/lib/i18n/server";
import { buyCreditsAction } from "../billing-actions";

export async function generateMetadata(): Promise<Metadata> {
  const { dict } = await getI18n();
  return { title: dict.credits.metaTitle };
}

export default async function BuyCreditsPage() {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const [credits, { dict, t, locale }] = await Promise.all([
    getCreditBalance(userId),
    getI18n(),
  ]);
  const C = dict.credits;
  const P = dict.pricing.credits;

  return (
    <div className="min-h-screen bg-paper text-ink antialiased">
      <header className="border-b border-ink/10">
        <div className="mx-auto flex max-w-2xl items-center justify-between px-6 py-4">
          <Link
            href="/"
            className="flex items-center gap-1.5 font-display text-lg font-extrabold tracking-tight"
          >
            StudyOS
            <span className="mb-2 h-1.5 w-1.5 rounded-full bg-lime" aria-hidden />
          </Link>
          <Link
            href="/app"
            className="text-sm text-ink-soft transition hover:text-ink"
          >
            {dict.settings.back}
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-2xl px-6 py-16">
        <div className="text-center">
          <h1 className="font-display text-4xl font-extrabold tracking-tight">
            {C.buy}
          </h1>
          <p className="mx-auto mt-3 max-w-md text-ink-soft">{C.pageIntro}</p>
          <p className="mt-5 inline-flex items-center gap-2 rounded-full bg-ink/5 px-4 py-1.5 text-sm font-semibold text-ink">
            <span className="text-lime-deep" aria-hidden>
              ●
            </span>
            {t(P.balance, { count: credits.toLocaleString(locale) })}
          </p>
        </div>

        {/* Credit pack */}
        <div className="mx-auto mt-10 max-w-sm rounded-2xl border-2 border-ink bg-white p-8 text-center shadow-[0_24px_60px_-30px_rgba(26,23,18,0.45)]">
          <p className="text-sm font-semibold uppercase tracking-wide text-ink-soft">
            {P.pack}
          </p>
          <div className="mt-3 font-display text-6xl font-extrabold">
            {CREDIT_PACK_SIZE.toLocaleString(locale)}
          </div>
          <p className="text-sm text-ink-soft">{P.unit}</p>
          <div className="mt-4 font-display text-3xl font-bold">
            ${CREDIT_PACK_PRICE_USD}
          </div>
          <form action={buyCreditsAction} className="mt-6">
            <button
              type="submit"
              className="w-full rounded-lg bg-ink px-5 py-3.5 text-sm font-semibold text-paper transition hover:bg-ink/90"
            >
              {t(P.buy, { count: CREDIT_PACK_SIZE.toLocaleString(locale) })}
            </button>
          </form>
          <p className="mt-3 text-xs text-ink-soft/70">{C.oneTimeExpire}</p>
        </div>

        <p className="mt-8 text-center text-sm text-ink-soft">
          {C.wantMore}{" "}
          <Link href="/pricing" className="font-semibold text-ink underline">
            {dict.settings.comparePlans}
          </Link>
        </p>
      </main>
    </div>
  );
}
