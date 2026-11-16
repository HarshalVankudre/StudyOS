import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  amountOfOneTimePrice,
  annualCheckoutConfigured,
  clearProPriceCache,
  DEFAULT_PRO_ANNUAL_USD,
  DEFAULT_PRO_MONTHLY_USD,
  effectiveTaxBehavior,
  extraCurrencies,
  formatPrice,
  formatUsd,
  getCreditPackPricing,
  getProPricing,
  parseUsd,
  PRICE_CACHE_MS,
  proPricing,
  type StripePriceLike,
} from "./plan-pricing";
import { CREDIT_PACK_PRICE_USD } from "./price-list";
import { isAnnualBillingAvailable } from "./stripe";

const report = vi.hoisted(() => vi.fn());
vi.mock("@/lib/ops/report-error", () => ({ reportError: report }));

const BILLING = { STRIPE_SECRET_KEY: "sk_test", STRIPE_PRICE_PRO: "price_m" };

describe("parseUsd", () => {
  it("accepts plain positive amounts with up to two decimals", () => {
    expect(parseUsd("5")).toBe(5);
    expect(parseUsd(" 49.99 ")).toBe(49.99);
  });

  it("rejects anything that could display a wrong price", () => {
    for (const bad of [undefined, "", "0", "-5", "5,00", "$5", "1e3", "5.999", "abc", "10000"]) {
      expect(parseUsd(bad)).toBeNull();
    }
  });
});

describe("proPricing", () => {
  it("defaults to the price list's $7.99 a month and $39.99 a year", () => {
    expect(DEFAULT_PRO_MONTHLY_USD).toBe(7.99);
    expect(DEFAULT_PRO_ANNUAL_USD).toBe(39.99);
    expect(proPricing({})).toEqual({
      monthlyUsd: 7.99,
      annual: { totalUsd: 39.99, perMonthUsd: 3.33, savingsPercent: 58 },
    });
  });

  it("reads the prices from STUDYOS_PRO_MONTHLY_PRICE and STUDYOS_PRO_ANNUAL_PRICE", () => {
    expect(proPricing({ STUDYOS_PRO_MONTHLY_PRICE: "7" }).monthlyUsd).toBe(7);
    expect(proPricing({ STUDYOS_PRO_MONTHLY_PRICE: "nonsense" }).monthlyUsd).toBe(7.99);
    expect(proPricing({ STUDYOS_PRO_MONTHLY_PRICE: "5", STUDYOS_PRO_ANNUAL_PRICE: "48" }).annual).toEqual({
      totalUsd: 48,
      perMonthUsd: 4,
      savingsPercent: 20,
    });
  });

  it("never shows a negative saving", () => {
    expect(proPricing({ STUDYOS_PRO_MONTHLY_PRICE: "5", STUDYOS_PRO_ANNUAL_PRICE: "70" }).annual.savingsPercent).toBe(0);
  });
});

describe("the fallback while billing is off", () => {
  it("shows both configured prices and offers nothing", async () => {
    const shown = await getProPricing({ env: {} });
    expect(shown).toEqual({
      monthly: { amount: 7.99, currency: "USD" },
      annual: {
        total: { amount: 39.99, currency: "USD" },
        perMonth: { amount: 3.33, currency: "USD" },
        savingsPercent: 58,
      },
      offered: { month: false, year: false },
      source: "configured",
    });
    expect(formatPrice(shown.monthly.amount, "USD", "en")).toBe("$7.99");
    expect(formatPrice(shown.annual!.total.amount, "USD", "en")).toBe("$39.99");
  });
});
describe("annualCheckoutConfigured", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("agrees with lib/stripe isAnnualBillingAvailable", () => {
    const cases = [
      {},
      BILLING,
      { ...BILLING, STRIPE_PRICE_PRO_ANNUAL: "price_y" },
      { STRIPE_PRICE_PRO_ANNUAL: "price_y" },
    ];
    for (const env of cases) {
      vi.unstubAllEnvs();
      for (const name of ["STRIPE_SECRET_KEY", "STRIPE_PRICE_PRO", "STRIPE_PRICE_PRO_ANNUAL"]) {
        vi.stubEnv(name, (env as Record<string, string>)[name] ?? "");
      }
      expect(annualCheckoutConfigured(env)).toBe(isAnnualBillingAvailable());
    }
  });
});

describe("formatUsd", () => {
  it("formats whole and fractional amounts in the visitor's locale", () => {
    expect(formatUsd(5, "en")).toBe("$5");
    expect(formatUsd(4.17, "en")).toBe("$4.17");
    expect(formatUsd(5, "de")).toMatch(/^5\s\$$/);
  });
});

describe("round 2, finding 7: Stripe is the source of truth for the displayed price", () => {
  const ON = { ...BILLING, STRIPE_PRICE_PRO_ANNUAL: "price_y", STUDYOS_PRO_MONTHLY_PRICE: "9", STUDYOS_PRO_ANNUAL_PRICE: "90" };
  const price = (over: Partial<StripePriceLike> = {}): StripePriceLike => ({
    id: "price_m",
    active: true,
    type: "recurring",
    billing_scheme: "per_unit",
    currency: "usd",
    unit_amount: 500,
    recurring: { interval: "month", interval_count: 1 },
    ...over,
  });
  const yearly = (over: Partial<StripePriceLike> = {}) =>
    price({ id: "price_y", unit_amount: 4800, recurring: { interval: "year", interval_count: 1 }, ...over });
  const fetcher = (prices: Record<string, StripePriceLike | Error>) =>
    vi.fn(async (id: string) => {
      const p = prices[id];
      if (!p || p instanceof Error) throw p ?? new Error("missing");
      return p;
    });

  beforeEach(() => {
    clearProPriceCache();
    report.mockReset();
  });

  it("shows and offers what the Stripe prices charge, ignoring the configured amounts", async () => {
    const out = await getProPricing({ env: ON, fetchPrice: fetcher({ price_m: price(), price_y: yearly() }) });
    expect(out).toEqual({
      monthly: { amount: 5, currency: "USD" },
      annual: { total: { amount: 48, currency: "USD" }, perMonth: { amount: 4, currency: "USD" }, savingsPercent: 20 },
      offered: { month: true, year: true },
      source: "stripe",
    });
  });

  it("shows the currency Stripe charges in, zero-decimal currencies included", async () => {
    const eur = await getProPricing({ env: BILLING, fetchPrice: fetcher({ price_m: price({ currency: "eur", unit_amount: 499 }) }) });
    expect(eur.monthly).toEqual({ amount: 4.99, currency: "EUR" });
    clearProPriceCache();
    const jpy = await getProPricing({ env: BILLING, fetchPrice: fetcher({ price_m: price({ currency: "jpy", unit_amount: 800 }) }) });
    expect(jpy.monthly).toEqual({ amount: 800, currency: "JPY" });
    expect(formatPrice(800, "JPY", "en")).toBe("¥800");
    expect(formatPrice(4.99, "EUR", "de")).toMatch(/^4,99\s€$/);
  });

  it("does not offer annual when its Stripe price is not a yearly price, and says so once", async () => {
    const fetchPrice = fetcher({ price_m: price(), price_y: yearly({ recurring: { interval: "month", interval_count: 1 } }) });
    const out = await getProPricing({ env: ON, fetchPrice });
    expect(out.annual).toBeNull();
    expect(out.offered).toEqual({ month: true, year: false });
    await getProPricing({ env: ON, fetchPrice });
    expect(report).toHaveBeenCalledTimes(1);
  });

  it("offers nothing when the monthly Stripe price is wrong (e.g. it bills every 3 months)", async () => {
    const out = await getProPricing({
      env: BILLING,
      fetchPrice: fetcher({ price_m: price({ recurring: { interval: "month", interval_count: 3 } }) }),
    });
    expect(out).toMatchObject({ offered: { month: false, year: false }, source: "configured" });
  });

  it("caches Stripe's answer, keeps the last one when Stripe fails, and retries soon", async () => {
    const fetchPrice = fetcher({ price_m: price() });
    await getProPricing({ env: BILLING, fetchPrice, now: 0 });
    await getProPricing({ env: BILLING, fetchPrice, now: PRICE_CACHE_MS - 1 });
    expect(fetchPrice).toHaveBeenCalledTimes(1);
    fetchPrice.mockRejectedValueOnce(new Error("Stripe down"));
    const stale = await getProPricing({ env: BILLING, fetchPrice, now: PRICE_CACHE_MS + 1 });
    expect(stale).toMatchObject({ monthly: { amount: 5, currency: "USD" }, offered: { month: true }, source: "stripe" });
    await getProPricing({ env: BILLING, fetchPrice, now: PRICE_CACHE_MS + 2 });
    expect(fetchPrice).toHaveBeenCalledTimes(2); // the failure is retried after a minute, not on every view
  });

  it("with Stripe unreachable and nothing cached, shows the configured price and sells nothing", async () => {
    const out = await getProPricing({ env: ON, fetchPrice: fetcher({ price_m: new Error("down") }) });
    expect(out).toEqual({
      monthly: { amount: 9, currency: "USD" },
      annual: null,
      offered: { month: false, year: false },
      source: "configured",
    });
  });

  it("with billing off, the configured price is shown and Stripe is never asked", async () => {
    const fetchPrice = fetcher({});
    const out = await getProPricing({ env: { STUDYOS_PRO_MONTHLY_PRICE: "7" }, fetchPrice });
    expect(out.monthly).toEqual({ amount: 7, currency: "USD" });
    expect(fetchPrice).not.toHaveBeenCalled();
  });

  it("no saving is claimed across two currencies", async () => {
    const out = await getProPricing({
      env: ON,
      fetchPrice: fetcher({ price_m: price(), price_y: yearly({ currency: "eur" }) }),
    });
    expect(out.annual?.savingsPercent).toBe(0);
  });
});

describe("the credit pack's price (STRIPE_PRICE_CREDIT_PACK)", () => {
  const PACK = { ...BILLING, STRIPE_PRICE_CREDIT_PACK: "price_pack" };
  const oneTime = (over: Partial<StripePriceLike> = {}): StripePriceLike => ({
    id: "price_pack",
    active: true,
    type: "one_time",
    billing_scheme: "per_unit",
    currency: "eur",
    unit_amount: 999,
    recurring: null,
    ...over,
  });
  const fetcher = (price: StripePriceLike | Error) =>
    vi.fn(async () => {
      if (price instanceof Error) throw price;
      return price;
    });

  beforeEach(() => {
    clearProPriceCache();
    report.mockReset();
  });

  it("without it, nothing changes: the price list's USD price, sold whenever billing is on, Stripe never asked", async () => {
    const fetchPrice = fetcher(oneTime());
    const configured = { price: { amount: CREDIT_PACK_PRICE_USD, currency: "USD" }, priceId: null, source: "configured" };
    expect(await getCreditPackPricing({ env: BILLING, fetchPrice })).toEqual({ ...configured, offered: true });
    expect(await getCreditPackPricing({ env: {}, fetchPrice })).toEqual({ ...configured, offered: false });
    // Set, but billing is off: still nothing to sell, nothing asked.
    expect(await getCreditPackPricing({ env: { STRIPE_PRICE_CREDIT_PACK: "price_pack" }, fetchPrice })).toEqual({ ...configured, offered: false });
    expect(fetchPrice).not.toHaveBeenCalled();
  });

  it("with it, shows and sells the Stripe Price's amount and currency", async () => {
    expect(await getCreditPackPricing({ env: PACK, fetchPrice: fetcher(oneTime()) })).toEqual({
      price: { amount: 9.99, currency: "EUR" },
      priceId: "price_pack",
      offered: true,
      source: "stripe",
    });
    clearProPriceCache();
    const jpy = await getCreditPackPricing({ env: PACK, fetchPrice: fetcher(oneTime({ currency: "jpy", unit_amount: 1500 })) });
    expect(jpy.price).toEqual({ amount: 1500, currency: "JPY" });
  });

  it("never sells the pack at another price when its Stripe Price is wrong or unreadable, and says so once", async () => {
    for (const wrong of [
      oneTime({ active: false }),
      oneTime({ type: "recurring", recurring: { interval: "month", interval_count: 1 } }),
      oneTime({ billing_scheme: "tiered" }),
      oneTime({ unit_amount: null }),
      oneTime({ unit_amount: 0 }),
    ]) {
      clearProPriceCache();
      report.mockReset();
      const fetchPrice = fetcher(wrong);
      const out = await getCreditPackPricing({ env: PACK, fetchPrice });
      expect(out).toMatchObject({ offered: false, priceId: null, source: "configured" });
      await getCreditPackPricing({ env: PACK, fetchPrice });
      expect(report).toHaveBeenCalledTimes(1);
    }
    clearProPriceCache();
    expect(await getCreditPackPricing({ env: PACK, fetchPrice: fetcher(new Error("Stripe down")) })).toMatchObject({
      offered: false,
      priceId: null,
    });
  });

  it("accepts only active, flat, one-time prices", () => {
    expect(amountOfOneTimePrice(oneTime())).toEqual({ amount: 9.99, currency: "EUR" });
    expect(amountOfOneTimePrice(oneTime({ billing_scheme: null }))).toEqual({ amount: 9.99, currency: "EUR" });
    expect(amountOfOneTimePrice(oneTime({ type: "recurring" }))).toBeNull();
  });

  /** The Stripe Tax settings with this default tax behavior (null: none set). */
  const taxDefault = (value: string | null) => vi.fn(async () => ({ defaults: { tax_behavior: value } }));
  const TAXED = { ...PACK, STRIPE_AUTOMATIC_TAX: "1" };

  it("does not sell a Stripe Price whose tax behavior contradicts STRIPE_TAX_BEHAVIOR while Stripe Tax is on, and says so once", async () => {
    const exclusive = fetcher(oneTime({ tax_behavior: "exclusive" }));
    const settings = taxDefault("inclusive");
    expect(await getCreditPackPricing({ env: TAXED, fetchPrice: exclusive, fetchTaxSettings: settings })).toMatchObject({
      offered: false,
      priceId: null,
      source: "configured",
    });
    await getCreditPackPricing({ env: TAXED, fetchPrice: exclusive, fetchTaxSettings: settings });
    expect(report).toHaveBeenCalledTimes(1);
    expect(String(report.mock.calls[0][0])).toMatch(
      /STRIPE_PRICE_CREDIT_PACK price_pack has tax behavior exclusive but STRIPE_TAX_BEHAVIOR is inclusive: it is not offered/,
    );
    // Its own behavior decides: the account default is not even read.
    expect(settings).not.toHaveBeenCalled();
    report.mockReset();
    clearProPriceCache();
    // Matching, or Stripe Tax off (nothing is said about VAT then): sold, nothing to say.
    expect(
      await getCreditPackPricing({ env: { ...TAXED, STRIPE_TAX_BEHAVIOR: "exclusive" }, fetchPrice: exclusive, fetchTaxSettings: settings }),
    ).toMatchObject({ offered: true, priceId: "price_pack" });
    expect(await getCreditPackPricing({ env: PACK, fetchPrice: exclusive, fetchTaxSettings: settings })).toMatchObject({ offered: true });
    expect(report).not.toHaveBeenCalled();
    expect(settings).not.toHaveBeenCalled();
  });

  it("a Price without its own tax behavior follows the Stripe Tax default, read once and cached", async () => {
    const unspecified = fetcher(oneTime({ tax_behavior: "unspecified" }));
    const inclusive = taxDefault("inclusive");
    expect(await getCreditPackPricing({ env: TAXED, fetchPrice: unspecified, fetchTaxSettings: inclusive, now: 0 })).toMatchObject({ offered: true });
    expect(await getCreditPackPricing({ env: TAXED, fetchPrice: unspecified, fetchTaxSettings: inclusive, now: PRICE_CACHE_MS - 1 })).toMatchObject({ offered: true });
    expect(inclusive).toHaveBeenCalledTimes(1);
    expect(report).not.toHaveBeenCalled();
    clearProPriceCache();
    // A default that contradicts the setting: not sold.
    expect(
      await getCreditPackPricing({ env: TAXED, fetchPrice: fetcher(oneTime({ tax_behavior: null })), fetchTaxSettings: taxDefault("exclusive") }),
    ).toMatchObject({ offered: false });
    expect(String(report.mock.calls[0][0])).toMatch(/has tax behavior exclusive \(the Stripe Tax default\) but STRIPE_TAX_BEHAVIOR is inclusive/);
  });

  it("whether a Price includes VAT that cannot be told (no default, inferred by currency, settings unreadable) is not sold", async () => {
    const unspecified = fetcher(oneTime({ tax_behavior: "unspecified" }));
    for (const settings of [taxDefault(null), taxDefault("inferred_by_currency"), vi.fn(async () => Promise.reject(new Error("Stripe down")))]) {
      clearProPriceCache();
      report.mockReset();
      expect(await getCreditPackPricing({ env: TAXED, fetchPrice: unspecified, fetchTaxSettings: settings })).toMatchObject({ offered: false });
      expect(report.mock.calls.map((c) => String(c[0])).join("\n")).toMatch(/cannot be told: it is not offered/);
    }
  });

  it("the effective tax behavior: the Price's own, else the account default, else unknown", () => {
    expect(effectiveTaxBehavior("inclusive", "exclusive")).toBe("inclusive");
    expect(effectiveTaxBehavior("exclusive", null)).toBe("exclusive");
    expect(effectiveTaxBehavior("unspecified", "exclusive")).toBe("exclusive");
    expect(effectiveTaxBehavior(null, "inclusive")).toBe("inclusive");
    expect(effectiveTaxBehavior(undefined, "inferred_by_currency")).toBeNull();
    expect(effectiveTaxBehavior("unspecified", null)).toBeNull();
    expect(effectiveTaxBehavior("unspecified", undefined)).toBeNull();
  });

  it("the Pro prices follow the same rule: a monthly mismatch offers no Pro, an annual one no annual", async () => {
    const recurring = (id: string, interval: "month" | "year", tax_behavior: string) => ({
      id,
      active: true,
      type: "recurring",
      billing_scheme: "per_unit",
      currency: "eur",
      unit_amount: interval === "year" ? 4800 : 500,
      recurring: { interval, interval_count: 1 },
      tax_behavior,
    });
    const env = { ...BILLING, STRIPE_PRICE_PRO_ANNUAL: "price_y", STRIPE_AUTOMATIC_TAX: "1" };
    const settings = taxDefault("inclusive");
    let out = await getProPricing({
      env,
      fetchTaxSettings: settings,
      fetchPrice: vi.fn(async (id: string) => recurring(id, id === "price_y" ? "year" : "month", "exclusive")),
    });
    expect(out).toMatchObject({ offered: { month: false, year: false }, source: "configured" });
    expect(String(report.mock.calls[0][0])).toMatch(/STRIPE_PRICE_PRO price_m has tax behavior exclusive/);
    clearProPriceCache();
    out = await getProPricing({
      env,
      fetchTaxSettings: settings,
      fetchPrice: vi.fn(async (id: string) => recurring(id, id === "price_y" ? "year" : "month", id === "price_y" ? "exclusive" : "inclusive")),
    });
    expect(out).toMatchObject({ offered: { month: true, year: false }, annual: null, source: "stripe" });
  });
});

describe("prices with extra currencies (currency_options)", () => {
  const options = (...codes: string[]) => Object.fromEntries(codes.map((c) => [c, { unit_amount: 500 }]));
  const monthly = (over: Partial<StripePriceLike> = {}): StripePriceLike => ({
    id: "price_m",
    active: true,
    type: "recurring",
    billing_scheme: "per_unit",
    currency: "usd",
    unit_amount: 500,
    recurring: { interval: "month", interval_count: 1 },
    ...over,
  });

  beforeEach(() => {
    clearProPriceCache();
    report.mockReset();
  });

  it("are not offered, and the owner is told once to use single-currency prices", async () => {
    const fetchPrice = vi.fn(async () => monthly({ currency_options: options("usd", "eur", "gbp") }));
    expect(await getProPricing({ env: BILLING, fetchPrice })).toMatchObject({ offered: { month: false, year: false }, source: "configured" });
    await getProPricing({ env: BILLING, fetchPrice });
    expect(report).toHaveBeenCalledTimes(1);
    expect(String(report.mock.calls[0][0])).toMatch(/STRIPE_PRICE_PRO price_m also charges in EUR, GBP \(currency_options\).*Use a single-currency Price/);
    expect(extraCurrencies(monthly({ currency_options: options("USD", "eur") }))).toEqual(["EUR"]);
  });

  it("a Price whose options list only its own currency is a single-currency Price", async () => {
    expect(await getProPricing({ env: BILLING, fetchPrice: vi.fn(async () => monthly({ currency_options: options("usd") })) })).toMatchObject({
      offered: { month: true },
    });
    expect(report).not.toHaveBeenCalled();
  });

  it("applies to the annual price and the pack too", async () => {
    const env = { ...BILLING, STRIPE_PRICE_PRO_ANNUAL: "price_y", STRIPE_PRICE_CREDIT_PACK: "price_pack" };
    const fetchPrice = vi.fn(async (id: string) =>
      id === "price_y"
        ? monthly({ id, unit_amount: 4800, recurring: { interval: "year", interval_count: 1 }, currency_options: options("usd", "eur") })
        : id === "price_pack"
          ? monthly({ id, type: "one_time", recurring: null, currency_options: options("usd", "jpy") })
          : monthly(),
    );
    expect(await getProPricing({ env, fetchPrice })).toMatchObject({ offered: { month: true, year: false }, annual: null });
    expect(await getCreditPackPricing({ env, fetchPrice })).toMatchObject({ offered: false, priceId: null });
    expect(report).toHaveBeenCalledTimes(2);
  });
});

describe("prices in each of the ten languages (QA round 3)", () => {
  const LOCALES = ["en", "es", "de", "fr", "it", "pt", "nl", "zh", "ja", "ar"];

  it("shows the amount and a dollar sign or USD code in every language", () => {
    for (const locale of LOCALES) {
      for (const amount of [0, 5, 10, 4.17]) {
        const text = formatUsd(amount, locale);
        expect(text, `${locale} ${amount}`).toMatch(/\$|USD/);
        const digits = text.replace(/[^\d٠-٩]/g, "");
        expect(digits.length, `${locale} ${amount}`).toBeGreaterThan(0);
      }
    }
    // Whole amounts carry no ".00"; cents keep both decimals.
    expect(formatUsd(10, "fr")).not.toMatch(/,00/);
    expect(formatUsd(4.17, "fr")).toMatch(/4,17/);
  });

  it("keeps a Latin currency sign in one piece in Arabic (no \"$US 0\")", () => {
    const text = formatUsd(0, "ar");
    // The sign is isolated left-to-right, so bidi cannot split "US" from "$".
    expect(text).toMatch(/\u2066[^\u2069]*\$[^\u2069]*\u2069/);
    const visibleOrder = text.replace(/[\u2066\u2069\u200f\u200e]/g, "");
    expect(visibleOrder).not.toContain("$US");
  });

  it("adds no direction marks in left-to-right languages", () => {
    for (const locale of LOCALES.filter((l) => l !== "ar")) {
      expect(formatUsd(5, locale), locale).not.toMatch(/[\u2066\u2069]/);
    }
  });
});
