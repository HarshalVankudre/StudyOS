/**
 * The Pro prices StudyOS SHOWS, in one place. Every page that prints a Pro
 * price (landing, pricing) reads it from here, and the README points here.
 *
 * Stripe decides what a checkout charges (the price ids STRIPE_PRICE_PRO and
 * STRIPE_PRICE_PRO_ANNUAL). These public settings must state the same amounts:
 *   STUDYOS_PRO_MONTHLY_PRICE  USD a month for monthly Pro   (default 5)
 *   STUDYOS_PRO_ANNUAL_PRICE   USD a year for annual Pro     (no default)
 * When you change a price in Stripe, change the setting with it.
 *
 * Annual billing is shown only when it can really be bought (Stripe billing
 * and an annual price id are configured, the same test as
 * isAnnualBillingAvailable in lib/stripe.ts) AND its displayed price is set.
 * There is deliberately no default annual price: guessing one could show an
 * amount Stripe will not charge.
 *
 * Pure (reads only the env object it is given), so pages, tests and the
 * startup check share it. Credit packs are priced in lib/credits.ts
 * (CREDIT_PACK_PRICE_USD), which is also what their checkout charges.
 */

type Env = Record<string, string | undefined>;

/** Pro's monthly price when STUDYOS_PRO_MONTHLY_PRICE is not set. */
export const DEFAULT_PRO_MONTHLY_USD = 5;

/** A configured USD amount: positive, at most two decimals, below 10,000. */
export function parseUsd(raw: string | undefined): number | null {
  const text = raw?.trim();
  if (!text || !/^\d{1,4}(\.\d{1,2})?$/.test(text)) return null;
  const value = Number(text);
  return value > 0 ? value : null;
}

export interface AnnualOffer {
  /** Charged once a year. */
  totalUsd: number;
  /** totalUsd / 12, for comparison with the monthly price. */
  perMonthUsd: number;
  /** Whole percent saved against twelve monthly payments (0 when none). */
  savingsPercent: number;
}

export interface ProPricing {
  monthlyUsd: number;
  /** Null when annual billing is not offered in this deployment. */
  annual: AnnualOffer | null;
}

/** Can annual Pro be bought here? Mirrors isAnnualBillingAvailable (lib/stripe.ts). */
export function annualCheckoutConfigured(env: Env = process.env): boolean {
  return Boolean(env.STRIPE_SECRET_KEY && env.STRIPE_PRICE_PRO && env.STRIPE_PRICE_PRO_ANNUAL);
}

export function proPricing(env: Env = process.env): ProPricing {
  const monthlyUsd = parseUsd(env.STUDYOS_PRO_MONTHLY_PRICE) ?? DEFAULT_PRO_MONTHLY_USD;
  const annualTotal = parseUsd(env.STUDYOS_PRO_ANNUAL_PRICE);
  if (!annualTotal || !annualCheckoutConfigured(env)) return { monthlyUsd, annual: null };
  const perMonthUsd = Math.round((annualTotal / 12) * 100) / 100;
  const savings = Math.floor((1 - annualTotal / (monthlyUsd * 12)) * 100 + 1e-9);
  return {
    monthlyUsd,
    annual: { totalUsd: annualTotal, perMonthUsd, savingsPercent: Math.max(0, savings) },
  };
}

/** "$5", "$4.17", "5 $", "US$5" … in the visitor's locale (always USD). */
export function formatUsd(amount: number, locale: string): string {
  const whole = Number.isInteger(amount);
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: whole ? 0 : 2,
  }).format(amount);
}
