/**
 * The Pro prices StudyOS SHOWS, in one place.
 *
 * With billing configured, Stripe is the source of truth: the amount,
 * currency and interval shown are those of the Stripe Prices behind the
 * checkout (STRIPE_PRICE_PRO, STRIPE_PRICE_PRO_ANNUAL), read on the server
 * and cached (PRICE_CACHE_MS) by getProPricing. An interval is OFFERED —
 * shown, and accepted by checkout (startCheckoutAction) — only when its
 * Stripe Price is an active, flat, recurring price of exactly that interval,
 * so the page can never show one thing while Stripe charges another.
 *
 * The configured settings are only the fallback for when billing is off (or
 * Stripe has never answered yet, and then nothing is offered for sale):
 *   STUDYOS_PRO_MONTHLY_PRICE  USD a month for monthly Pro   (default 5)
 *   STUDYOS_PRO_ANNUAL_PRICE   USD a year for annual Pro     (no default)
 * `proPricing` (synchronous) returns just those settings.
 *
 * Credit packs are priced in lib/credits.ts (CREDIT_PACK_PRICE_USD), which
 * is also what their checkout charges.
 */
import { reportError } from "@/lib/ops/report-error";

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

const savingsPercent = (yearly: number, monthly: number) =>
  Math.max(0, Math.floor((1 - yearly / (monthly * 12)) * 100 + 1e-9));

/** The CONFIGURED prices (the fallback; see the header). Pure. */
export function proPricing(env: Env = process.env): ProPricing {
  const monthlyUsd = parseUsd(env.STUDYOS_PRO_MONTHLY_PRICE) ?? DEFAULT_PRO_MONTHLY_USD;
  const annualTotal = parseUsd(env.STUDYOS_PRO_ANNUAL_PRICE);
  if (!annualTotal || !annualCheckoutConfigured(env)) return { monthlyUsd, annual: null };
  const perMonthUsd = Math.round((annualTotal / 12) * 100) / 100;
  return {
    monthlyUsd,
    annual: { totalUsd: annualTotal, perMonthUsd, savingsPercent: savingsPercent(annualTotal, monthlyUsd) },
  };
}

/** "$5", "4,17 €", "¥800" … an amount in `currency`, in the visitor's locale. */
export function formatPrice(amount: number, currency: string, locale: string): string {
  const whole = Number.isInteger(amount);
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    minimumFractionDigits: whole ? 0 : undefined,
    maximumFractionDigits: whole ? 0 : undefined,
  }).format(amount);
}

/** "$5", "$4.17", "5 $", "US$5" … in the visitor's locale (always USD). */
export function formatUsd(amount: number, locale: string): string {
  return formatPrice(amount, "USD", locale);
}

// ---- Stripe as the source of truth -------------------------------------------

/** The fields of a Stripe Price this module reads. */
export interface StripePriceLike {
  id: string;
  active: boolean;
  type: string;
  billing_scheme?: string | null;
  currency: string;
  unit_amount: number | null;
  recurring: { interval: string; interval_count?: number | null } | null;
}

/** An amount in major units (5 = $5.00, 800 = ¥800) and its ISO currency. */
export interface PriceAmount {
  amount: number;
  currency: string;
}

/** Decimal places of a currency's minor unit (USD 2, JPY 0, KWD 3), as Stripe counts them. */
function minorUnitDigits(currency: string): number {
  return new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions().maximumFractionDigits ?? 2;
}

/**
 * What a Stripe Price charges per `interval`, or null when it cannot be
 * offered as that interval: inactive, not recurring, not exactly one
 * `interval`, not a flat per-unit amount.
 */
export function amountOfStripePrice(price: StripePriceLike, interval: "month" | "year"): PriceAmount | null {
  if (!price.active || price.type !== "recurring") return null;
  if (price.billing_scheme && price.billing_scheme !== "per_unit") return null;
  if (price.recurring?.interval !== interval || (price.recurring.interval_count ?? 1) !== 1) return null;
  if (typeof price.unit_amount !== "number" || price.unit_amount <= 0) return null;
  const currency = price.currency.toUpperCase();
  return { amount: price.unit_amount / 10 ** minorUnitDigits(currency), currency };
}

export interface DisplayedAnnual {
  total: PriceAmount;
  perMonth: PriceAmount;
  /** Whole percent saved against twelve monthly payments (0 when none, or another currency). */
  savingsPercent: number;
}

export interface DisplayedProPricing {
  monthly: PriceAmount;
  /** Shown (and sold) only when offered. */
  annual: DisplayedAnnual | null;
  /** The intervals checkout accepts right now. */
  offered: { month: boolean; year: boolean };
  /** "stripe": read from the Stripe Prices; "configured": the fallback settings. */
  source: "stripe" | "configured";
}

/** How long a Stripe Price read is reused; a failed read is retried sooner. */
export const PRICE_CACHE_MS = 10 * 60 * 1000;
const PRICE_RETRY_MS = 60 * 1000;

type PriceFetcher = (id: string) => Promise<StripePriceLike>;
const priceCache = new Map<string, { price: StripePriceLike | null; at: number; ttl: number }>();
const reported = new Set<string>();

/** Forget cached Stripe Prices (tests; a price change takes effect at once). */
export function clearProPriceCache(): void {
  priceCache.clear();
  reported.clear();
}

/** Report a pricing problem once per process, not on every page view. */
function reportOnce(key: string, err: unknown): void {
  if (reported.has(key)) return;
  reported.add(key);
  reportError(err, { source: "billing", route: "lib/plan-pricing" });
}

async function cachedPrice(id: string, fetchPrice: PriceFetcher, now: number): Promise<StripePriceLike | null> {
  const hit = priceCache.get(id);
  if (hit && now - hit.at < hit.ttl) return hit.price;
  try {
    const price = await fetchPrice(id);
    priceCache.set(id, { price, at: now, ttl: PRICE_CACHE_MS });
    return price;
  } catch (err) {
    reportOnce(`fetch:${id}`, err);
    // Keep showing the last price Stripe gave, if any; retry in a minute.
    const stale = hit?.price ?? null;
    priceCache.set(id, { price: stale, at: now, ttl: PRICE_RETRY_MS });
    return stale;
  }
}

const defaultFetcher: PriceFetcher = async (id) => {
  const { stripe } = await import("@/lib/stripe");
  return (await stripe.prices.retrieve(id)) as unknown as StripePriceLike;
};

/** Round to the currency's minor unit. */
const roundTo = (amount: number, currency: string) => {
  const f = 10 ** minorUnitDigits(currency);
  return Math.round(amount * f) / f;
};

/**
 * The Pro prices to show and sell (see the header). Server-only. With
 * billing configured, the Stripe Prices decide: an interval whose price
 * cannot be read or is not exactly that interval is not offered (and a
 * misconfigured price is reported to the owner once).
 */
export async function getProPricing(
  opts: { env?: Env; fetchPrice?: PriceFetcher; now?: number } = {},
): Promise<DisplayedProPricing> {
  const env = opts.env ?? process.env;
  const now = opts.now ?? Date.now();
  const configured = proPricing(env);
  const fallback: DisplayedProPricing = {
    monthly: { amount: configured.monthlyUsd, currency: "USD" },
    annual: null,
    offered: { month: false, year: false },
    source: "configured",
  };
  const monthlyId = env.STRIPE_PRICE_PRO;
  if (!env.STRIPE_SECRET_KEY || !monthlyId) return fallback;

  const fetchPrice = opts.fetchPrice ?? defaultFetcher;
  const monthlyPrice = await cachedPrice(monthlyId, fetchPrice, now);
  const monthly = monthlyPrice ? amountOfStripePrice(monthlyPrice, "month") : null;
  if (!monthly) {
    if (monthlyPrice) {
      reportOnce(`invalid:${monthlyId}`, new Error(`STRIPE_PRICE_PRO ${monthlyId} is not an active flat monthly price: Pro is not offered`));
    }
    return fallback;
  }

  const annualId = env.STRIPE_PRICE_PRO_ANNUAL;
  const annualPrice = annualId ? await cachedPrice(annualId, fetchPrice, now) : null;
  const yearly = annualPrice ? amountOfStripePrice(annualPrice, "year") : null;
  if (annualPrice && !yearly) {
    reportOnce(`invalid:${annualId}`, new Error(`STRIPE_PRICE_PRO_ANNUAL ${annualId} is not an active flat yearly price: annual is not offered`));
  }
  const annual: DisplayedAnnual | null = yearly
    ? {
        total: yearly,
        perMonth: { amount: roundTo(yearly.amount / 12, yearly.currency), currency: yearly.currency },
        savingsPercent: yearly.currency === monthly.currency ? savingsPercent(yearly.amount, monthly.amount) : 0,
      }
    : null;
  return { monthly, annual, offered: { month: true, year: annual !== null }, source: "stripe" };
}
