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
 *   STUDYOS_PRO_MONTHLY_PRICE  USD a month for monthly Pro   (default 7.99)
 *   STUDYOS_PRO_ANNUAL_PRICE   USD a year for annual Pro     (default 39.99)
 * The defaults are the price list's (lib/price-list.ts). `proPricing`
 * (synchronous) returns just those settings. While billing is off both are
 * shown (nothing is sold); with billing on and Stripe unreadable, only the
 * monthly figure is shown, since no annual price may exist in Stripe.
 *
 * Existing subscribers keep the Stripe price they subscribed at: nothing here
 * changes what they are charged.
 *
 * The credit pack (getCreditPackPricing) costs CREDIT_PACK_PRICE_USD
 * (lib/price-list.ts), charged as an inline USD price, unless
 * STRIPE_PRICE_CREDIT_PACK names a Stripe one-time Price: then that Price's
 * amount and currency are shown and charged, and the pack is sold only while
 * it is an active, flat, one-time price (the same rule as Pro).
 *
 * Two more rules keep what a page says true for every Stripe Price (Pro,
 * annual, pack); a Price that breaks one is not offered, like an invalid one,
 * and the owner is told once:
 *  - one currency: a Price with extra currencies (currency_options) could be
 *    charged in a currency the page does not show;
 *  - with Stripe Tax on, its tax behavior (its own, else the Stripe Tax
 *    settings' default, read and cached like the Prices) must be
 *    STRIPE_TAX_BEHAVIOR, which the pages state; one that differs, or that
 *    cannot be told, would make the VAT note wrong. (The inline pack price is
 *    created with STRIPE_TAX_BEHAVIOR, so it always agrees.)
 */
import { pricesTaxBehavior, type TaxBehavior } from "@/lib/checkout-config";
import { reportError } from "@/lib/ops/report-error";
import {
  CREDIT_PACK_PRICE_USD,
  PRO_FALLBACK_ANNUAL_USD,
  PRO_FALLBACK_MONTHLY_USD,
} from "@/lib/price-list";

type Env = Record<string, string | undefined>;

/** Pro's monthly price when STUDYOS_PRO_MONTHLY_PRICE is not set. */
export const DEFAULT_PRO_MONTHLY_USD = PRO_FALLBACK_MONTHLY_USD;
/** Pro's yearly price when STUDYOS_PRO_ANNUAL_PRICE is not set. */
export const DEFAULT_PRO_ANNUAL_USD = PRO_FALLBACK_ANNUAL_USD;

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
  /** The configured yearly price (shown while billing is off; sold only through Stripe). */
  annual: AnnualOffer;
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
  const annualTotal = parseUsd(env.STUDYOS_PRO_ANNUAL_PRICE) ?? DEFAULT_PRO_ANNUAL_USD;
  const perMonthUsd = Math.round((annualTotal / 12) * 100) / 100;
  return {
    monthlyUsd,
    annual: { totalUsd: annualTotal, perMonthUsd, savingsPercent: savingsPercent(annualTotal, monthlyUsd) },
  };
}

/** Right-to-left languages (of the ten, Arabic). */
const RTL_LOCALE = /^(ar|he|fa|ur)(\b|-|_)/i;

/**
 * "$5", "4,17 €", "¥800" … an amount in `currency`, in the visitor's locale.
 *
 * In a right-to-left language a Latin currency sign ("US$") is wrapped in a
 * left-to-right isolate: without it the bidi algorithm splits it and Arabic
 * pages read "$US 5". With it the amount reads "5 US$" in Arabic order
 * (shown as "US$ 5"), as Arabic price tags do.
 */
export function formatPrice(amount: number, currency: string, locale: string): string {
  const whole = Number.isInteger(amount);
  const format = new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    minimumFractionDigits: whole ? 0 : undefined,
    maximumFractionDigits: whole ? 0 : undefined,
  });
  if (!RTL_LOCALE.test(locale)) return format.format(amount);
  return format
    .formatToParts(amount)
    .map((part) => (part.type === "currency" && /[A-Za-z$]/.test(part.value) ? `⁦${part.value}⁩` : part.value))
    .join("");
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
  /** "inclusive", "exclusive" or "unspecified" (the account's default from Stripe Tax settings applies). */
  tax_behavior?: string | null;
  /** The Price's amounts in other currencies, by currency code (present when read with expand: ["currency_options"]). */
  currency_options?: Record<string, unknown> | null;
}

/** The fields of the Stripe Tax settings this module reads. */
export interface TaxSettingsLike {
  defaults?: { tax_behavior?: string | null } | null;
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
  if (price.recurring?.interval !== interval || (price.recurring.interval_count ?? 1) !== 1) return null;
  return flatAmount(price);
}

/**
 * What a Stripe one-time Price charges, or null when it cannot be sold as
 * the credit pack: inactive, recurring, or not a flat per-unit amount
 * (tiered, or an amount the customer chooses).
 */
export function amountOfOneTimePrice(price: StripePriceLike): PriceAmount | null {
  if (!price.active || price.type !== "one_time") return null;
  return flatAmount(price);
}

/** A flat per-unit amount above zero, in major units of its currency. */
function flatAmount(price: StripePriceLike): PriceAmount | null {
  if (price.billing_scheme && price.billing_scheme !== "per_unit") return null;
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
type TaxSettingsFetcher = () => Promise<TaxSettingsLike>;
const priceCache = new Map<string, { price: StripePriceLike | null; at: number; ttl: number }>();
/** The Stripe Tax settings' default tax behavior: null = none set; undefined = never read. */
let taxDefaultCache: { value: string | null | undefined; at: number; ttl: number } | null = null;
const reported = new Set<string>();

/** Forget cached Stripe Prices and tax settings (tests; a price change takes effect at once). */
export function clearProPriceCache(): void {
  priceCache.clear();
  taxDefaultCache = null;
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
  // currency_options is returned only when expanded (sellable() reads it).
  return (await stripe.prices.retrieve(id, { expand: ["currency_options"] })) as unknown as StripePriceLike;
};

const defaultTaxSettingsFetcher: TaxSettingsFetcher = async () => {
  const { stripe } = await import("@/lib/stripe");
  return (await stripe.tax.settings.retrieve()) as unknown as TaxSettingsLike;
};

/** The Stripe Tax settings' default tax behavior, cached like the Prices (undefined: never read). */
async function cachedTaxDefault(fetchSettings: TaxSettingsFetcher, now: number): Promise<string | null | undefined> {
  const hit = taxDefaultCache;
  if (hit && now - hit.at < hit.ttl) return hit.value;
  try {
    const settings = await fetchSettings();
    const value = settings.defaults?.tax_behavior ?? null;
    taxDefaultCache = { value, at: now, ttl: PRICE_CACHE_MS };
    return value;
  } catch (err) {
    reportOnce("fetch:tax_settings", err);
    // Keep the last answer Stripe gave, if any; retry in a minute.
    taxDefaultCache = { value: hit?.value, at: now, ttl: PRICE_RETRY_MS };
    return hit?.value;
  }
}

/**
 * Whether a Stripe Price's amount includes tax at checkout: its own
 * tax_behavior when it has one, else the Stripe Tax settings' default. Null
 * when that cannot be told: no default set, the default could not be read,
 * or "inferred_by_currency" (Stripe then decides by currency, by a rule the
 * SDK's types do not state, so it is not guessed here).
 */
export function effectiveTaxBehavior(
  own: string | null | undefined,
  accountDefault: string | null | undefined,
): TaxBehavior | null {
  if (own === "inclusive" || own === "exclusive") return own;
  if (accountDefault === "inclusive" || accountDefault === "exclusive") return accountDefault;
  return null;
}

/** The currencies a Price charges in besides its own (from currency_options), upper case. */
export function extraCurrencies(price: StripePriceLike): string[] {
  const own = price.currency.toLowerCase();
  return Object.keys(price.currency_options ?? {})
    .map((c) => c.toLowerCase())
    .filter((c) => c !== own)
    .map((c) => c.toUpperCase());
}

interface SellContext {
  env: Env;
  now: number;
  fetchTaxSettings: TaxSettingsFetcher;
}

/**
 * Can a valid Stripe Price be sold as the pages show it? Not when it has
 * extra currencies (the page shows one, Checkout could charge another), nor,
 * with Stripe Tax on, when its tax behavior is not STRIPE_TAX_BEHAVIOR or
 * cannot be told (the VAT note would be wrong). Each problem is reported once.
 */
async function sellable(price: StripePriceLike, setting: string, ctx: SellContext): Promise<boolean> {
  const extra = extraCurrencies(price);
  if (extra.length > 0) {
    reportOnce(
      `currencies:${price.id}`,
      new Error(
        `${setting} ${price.id} also charges in ${extra.join(", ")} (currency_options): it is not offered, since the pages show ${price.currency.toUpperCase()} and Checkout could charge another currency. Use a single-currency Price.`,
      ),
    );
    return false;
  }
  const expected = pricesTaxBehavior(ctx.env);
  if (!expected) return true; // Stripe Tax off: no tax is charged and nothing is said about it.
  const own = price.tax_behavior;
  const specified = own === "inclusive" || own === "exclusive";
  const accountDefault = specified ? undefined : await cachedTaxDefault(ctx.fetchTaxSettings, ctx.now);
  const effective = effectiveTaxBehavior(own, accountDefault);
  if (effective === expected) return true;
  reportOnce(
    `tax:${price.id}:${effective ?? "unknown"}`,
    new Error(
      effective
        ? `${setting} ${price.id} has tax behavior ${effective}${specified ? "" : " (the Stripe Tax default)"} but STRIPE_TAX_BEHAVIOR is ${expected}: it is not offered, since the pricing pages would state VAT wrongly for it. Give the Price tax behavior ${expected}.`
        : `${setting} ${price.id} has no tax behavior of its own and the Stripe Tax default is ${accountDefault === undefined ? "unreadable" : (accountDefault ?? "not set")}, so whether it includes VAT cannot be told: it is not offered. Give the Price tax behavior ${expected}.`,
    ),
  );
  return false;
}

/** Round to the currency's minor unit. */
const roundTo = (amount: number, currency: string) => {
  const f = 10 ** minorUnitDigits(currency);
  return Math.round(amount * f) / f;
};

/** What the price readers take (tests pass fakes; the defaults ask Stripe). */
export interface PricingOptions {
  env?: Env;
  fetchPrice?: PriceFetcher;
  fetchTaxSettings?: TaxSettingsFetcher;
  now?: number;
}

/**
 * The Pro prices to show and sell (see the header). Server-only. With
 * billing configured, the Stripe Prices decide: an interval whose price
 * cannot be read, is not exactly that interval, or cannot be sold as shown
 * (sellable) is not offered (and a misconfigured price is reported to the
 * owner once).
 */
export async function getProPricing(opts: PricingOptions = {}): Promise<DisplayedProPricing> {
  const env = opts.env ?? process.env;
  const now = opts.now ?? Date.now();
  const ctx: SellContext = { env, now, fetchTaxSettings: opts.fetchTaxSettings ?? defaultTaxSettingsFetcher };
  const configured = proPricing(env);
  const fallback: DisplayedProPricing = {
    monthly: { amount: configured.monthlyUsd, currency: "USD" },
    annual: null,
    offered: { month: false, year: false },
    source: "configured",
  };
  const monthlyId = env.STRIPE_PRICE_PRO;
  if (!env.STRIPE_SECRET_KEY || !monthlyId) {
    // Billing is off: show both configured prices (nothing is offered).
    return {
      ...fallback,
      annual: {
        total: { amount: configured.annual.totalUsd, currency: "USD" },
        perMonth: { amount: configured.annual.perMonthUsd, currency: "USD" },
        savingsPercent: configured.annual.savingsPercent,
      },
    };
  }

  const fetchPrice = opts.fetchPrice ?? defaultFetcher;
  const monthlyPrice = await cachedPrice(monthlyId, fetchPrice, now);
  const monthly = monthlyPrice ? amountOfStripePrice(monthlyPrice, "month") : null;
  if (!monthly) {
    if (monthlyPrice) {
      reportOnce(`invalid:${monthlyId}`, new Error(`STRIPE_PRICE_PRO ${monthlyId} is not an active flat monthly price: Pro is not offered`));
    }
    return fallback;
  }
  if (!(await sellable(monthlyPrice!, "STRIPE_PRICE_PRO", ctx))) return fallback;

  const annualId = env.STRIPE_PRICE_PRO_ANNUAL;
  const annualPrice = annualId ? await cachedPrice(annualId, fetchPrice, now) : null;
  let yearly = annualPrice ? amountOfStripePrice(annualPrice, "year") : null;
  if (annualPrice && !yearly) {
    reportOnce(`invalid:${annualId}`, new Error(`STRIPE_PRICE_PRO_ANNUAL ${annualId} is not an active flat yearly price: annual is not offered`));
  }
  if (annualPrice && yearly && !(await sellable(annualPrice, "STRIPE_PRICE_PRO_ANNUAL", ctx))) yearly = null;
  const annual: DisplayedAnnual | null = yearly
    ? {
        total: yearly,
        perMonth: { amount: roundTo(yearly.amount / 12, yearly.currency), currency: yearly.currency },
        savingsPercent: yearly.currency === monthly.currency ? savingsPercent(yearly.amount, monthly.amount) : 0,
      }
    : null;
  return { monthly, annual, offered: { month: true, year: annual !== null }, source: "stripe" };
}

// ---- The credit pack -----------------------------------------------------------

export interface DisplayedPackPricing {
  /** What one pack costs: shown on every page that names the price, and charged by its checkout. */
  price: PriceAmount;
  /** The Stripe Price checkout charges (STRIPE_PRICE_CREDIT_PACK), or null: CREDIT_PACK_PRICE_USD as an inline price. */
  priceId: string | null;
  /** Checkout sells the pack at this price right now (billing on, and a configured Stripe Price is valid). */
  offered: boolean;
  /** "stripe": read from the Stripe Price; "configured": the price list's USD price. */
  source: "stripe" | "configured";
}

/**
 * The credit pack's price to show and sell (see the header). Server-only.
 * Without STRIPE_PRICE_CREDIT_PACK nothing changes: CREDIT_PACK_PRICE_USD,
 * sold whenever billing is on (its inline price carries STRIPE_TAX_BEHAVIOR,
 * so it always matches what the pages say about VAT). With it, the Stripe
 * Price decides; while it cannot be read, is not an active flat one-time
 * price, or cannot be sold as shown (sellable), the pack is not sold (and a
 * misconfigured price is reported to the owner once).
 */
export async function getCreditPackPricing(opts: PricingOptions = {}): Promise<DisplayedPackPricing> {
  const env = opts.env ?? process.env;
  const now = opts.now ?? Date.now();
  const ctx: SellContext = { env, now, fetchTaxSettings: opts.fetchTaxSettings ?? defaultTaxSettingsFetcher };
  // The same switch as lib/stripe isBillingConfigured.
  const billingOn = Boolean(env.STRIPE_SECRET_KEY && env.STRIPE_PRICE_PRO);
  const configured = {
    price: { amount: CREDIT_PACK_PRICE_USD, currency: "USD" },
    priceId: null,
    source: "configured" as const,
  };
  const id = env.STRIPE_PRICE_CREDIT_PACK?.trim();
  if (!billingOn) return { ...configured, offered: false };
  if (!id) return { ...configured, offered: true };

  const stripePrice = await cachedPrice(id, opts.fetchPrice ?? defaultFetcher, now);
  const amount = stripePrice ? amountOfOneTimePrice(stripePrice) : null;
  if (!stripePrice || !amount) {
    if (stripePrice) {
      reportOnce(`invalid:${id}`, new Error(`STRIPE_PRICE_CREDIT_PACK ${id} is not an active flat one-time price: the credit pack is not offered`));
    }
    return { ...configured, offered: false };
  }
  if (!(await sellable(stripePrice, "STRIPE_PRICE_CREDIT_PACK", ctx))) return { ...configured, offered: false };
  return { price: amount, priceId: id, offered: true, source: "stripe" };
}
