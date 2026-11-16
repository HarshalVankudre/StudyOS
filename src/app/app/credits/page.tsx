import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import { getCreditBalance } from "@/lib/credits";
import { getUserPlan } from "@/lib/billing";
import { modelForPlan } from "@/lib/ai/plans";
import {
  CREDIT_PACK_SIZE,
  creditExamples,
  planQuotes,
} from "@/lib/price-list";
import { getI18n } from "@/lib/i18n/server";
import { formatPrice, getCreditPackPricing } from "@/lib/plan-pricing";
import { pricesTaxBehavior } from "@/lib/checkout-config";
import { buyCreditsAction } from "../billing-actions";
import { isBillingConfigured } from "@/lib/stripe";
import { ComingSoon } from "@/components/account/ComingSoon";
import {
  BillingNotice,
  parseBillingNotice,
} from "@/components/account/BillingNotice";
import { BrandMark } from "@/components/BrandMark";
import { ContractNoticeLinks } from "@/components/contract-notices/ContractNoticeLinks";
import { InviteCard } from "@/components/referral/InviteCard";
import { inviteCardProps } from "@/lib/referral/card";

export async function generateMetadata(): Promise<Metadata> {
  const { dict } = await getI18n();
  return { title: dict.credits.metaTitle };
}

export default async function BuyCreditsPage({
  searchParams,
}: {
  searchParams: Promise<{ billing?: string | string[] }>;
}) {
  const billingNotice = parseBillingNotice((await searchParams).billing);
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const [credits, { dict, t, locale, plural }] = await Promise.all([
    getCreditBalance(userId),
    getI18n(),
  ]);
  // The invite card (lib/referral); left out when it cannot be loaded.
  const invite = await inviteCardProps(userId, { dict, t, plural, locale });
  const C = dict.credits;
  // What a pack buys at the prices this student is charged (lib/price-list.ts).
  const plan = await getUserPlan().catch(() => "free" as const);
  const pack = creditExamples(CREDIT_PACK_SIZE, planQuotes(modelForPlan(plan), plan));
  const P = dict.pricing.credits;
  // Without payments switched on, the pack is shown as coming soon.
  const billing = isBillingConfigured();
  // What its checkout charges, in its currency (lib/plan-pricing.ts). With
  // billing on, a pack its Stripe Price cannot sell right now shows no price
  // and no button, only that it is not available.
  const { price: packPrice, offered } = await getCreditPackPricing();
  const unavailable = billing && !offered;
  const taxBehavior = pricesTaxBehavior();

  return (
    <div className="min-h-screen bg-paper text-ink antialiased">
      <header className="border-b border-ink/10">
        <div className="mx-auto flex max-w-2xl items-center justify-between px-6 py-4">
          <Link
            href="/"
            className="flex items-center gap-1.5 font-display text-lg font-extrabold tracking-tight"
          >
            <BrandMark />
            StudyOS
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
            {billing ? C.buy : C.label}
          </h1>
          <p className="mx-auto mt-3 max-w-md text-ink-soft">
            {billing ? C.pageIntro : dict.spend.purchasesComingSoon}
          </p>
          <p className="mt-5 inline-flex items-center gap-2 rounded-full bg-ink/5 px-4 py-1.5 text-sm font-semibold text-ink">
            <span className="text-lime-deep" aria-hidden>
              ●
            </span>
            {plural(dict.counts.balance, credits)}
          </p>
        </div>

        <BillingNotice
          code={billingNotice}
          messages={dict.billingNotice}
          className="mx-auto mt-8 max-w-sm"
        />

        {/* Credit pack */}
        <div className="mx-auto mt-10 max-w-sm rounded-2xl border-2 border-lime-deep bg-card p-8 text-center shadow-pop">
          <p className="text-sm font-semibold text-ink-soft">
            {P.pack}
          </p>
          <div className="mt-3 font-display text-6xl font-extrabold">
            {CREDIT_PACK_SIZE.toLocaleString(locale)}
          </div>
          <p className="text-sm text-ink-soft">{P.unit}</p>
          {!unavailable && (
            <>
              <div className="mt-4 font-display text-3xl font-bold" data-testid="pack-price">
                {formatPrice(packPrice.amount, packPrice.currency, locale)}
              </div>
              {taxBehavior && (
                <p className="mt-1 text-xs text-ink-soft">
                  {taxBehavior === "inclusive" ? dict.checkout.vatIncluded : dict.checkout.vatExcluded}
                </p>
              )}
            </>
          )}
          <p className="mt-2 text-xs text-ink-soft">
            {t(dict.credits.buysApprox, {
              gens: pack.builds.toLocaleString(locale),
              edits: pack.messages.toLocaleString(locale),
            })}
          </p>
          {unavailable ? (
            <div data-testid="pack-unavailable" className="mt-6">
              <ComingSoon messages={{ comingSoon: C.unavailable, purchasesComingSoon: C.packUnavailableNote }} note />
            </div>
          ) : billing ? (
            <>
              <form action={buyCreditsAction} className="mt-6">
                <button
                  type="submit"
                  className="w-full rounded-lg bg-ink px-5 py-3.5 text-sm font-semibold text-paper transition hover:bg-ink/90"
                >
                  {t(P.buy, { count: CREDIT_PACK_SIZE.toLocaleString(locale) })}
                </button>
              </form>
              <p className="mt-3 text-xs text-ink-soft/70">{C.oneTimeExpire}</p>
            </>
          ) : (
            <ComingSoon messages={dict.spend} className="mt-6" />
          )}
        </div>

        {billing && (
          <p className="mt-8 text-center text-sm text-ink-soft">
            {C.wantMore}{" "}
            <Link href="/pricing" className="font-semibold text-ink underline">
              {dict.settings.comparePlans}
            </Link>
          </p>
        )}

        {/* The statutory withdrawal function and cancellation button (lib/contract-notices). */}
        {billing && (
          <ContractNoticeLinks messages={dict.contractNotices} className="mx-auto mt-6 max-w-sm text-center [&>div]:justify-center" />
        )}

        {invite && (
          <section className="mx-auto mt-10 max-w-sm rounded-2xl border border-line bg-card p-6">
            <h2 className="font-display text-lg font-bold">{dict.referral.title}</h2>
            <InviteCard {...invite} className="mt-2" />
          </section>
        )}
      </main>
    </div>
  );
}
