import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  annualCheckoutConfigured,
  clearProPriceCache,
  DEFAULT_PRO_MONTHLY_USD,
  formatPrice,
  formatUsd,
  getProPricing,
  parseUsd,
  PRICE_CACHE_MS,
  proPricing,
  type StripePriceLike,
} from "./plan-pricing";
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
  it("defaults to $5 a month and no annual offer", () => {
    expect(proPricing({})).toEqual({ monthlyUsd: DEFAULT_PRO_MONTHLY_USD, annual: null });
    expect(DEFAULT_PRO_MONTHLY_USD).toBe(5);
  });

  it("reads the monthly price from STUDYOS_PRO_MONTHLY_PRICE", () => {
    expect(proPricing({ STUDYOS_PRO_MONTHLY_PRICE: "7" }).monthlyUsd).toBe(7);
    expect(proPricing({ STUDYOS_PRO_MONTHLY_PRICE: "nonsense" }).monthlyUsd).toBe(5);
  });

  it("offers annual only when Stripe can sell it AND its displayed price is set", () => {
    const annualId = { ...BILLING, STRIPE_PRICE_PRO_ANNUAL: "price_y" };
    expect(proPricing({ ...annualId }).annual).toBeNull(); // no displayed price: never guessed
    expect(proPricing({ ...BILLING, STUDYOS_PRO_ANNUAL_PRICE: "48" }).annual).toBeNull(); // no Stripe price
    expect(proPricing({ STRIPE_PRICE_PRO_ANNUAL: "price_y", STUDYOS_PRO_ANNUAL_PRICE: "48" }).annual).toBeNull();
    expect(proPricing({ ...annualId, STUDYOS_PRO_ANNUAL_PRICE: "48" }).annual).toEqual({
      totalUsd: 48,
      perMonthUsd: 4,
      savingsPercent: 20,
    });
  });

  it("never shows a negative saving", () => {
    const env = { ...BILLING, STRIPE_PRICE_PRO_ANNUAL: "price_y", STUDYOS_PRO_ANNUAL_PRICE: "70" };
    expect(proPricing(env).annual?.savingsPercent).toBe(0);
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
