import { afterEach, describe, expect, it, vi } from "vitest";
import {
  annualCheckoutConfigured,
  DEFAULT_PRO_MONTHLY_USD,
  formatUsd,
  parseUsd,
  proPricing,
} from "./plan-pricing";
import { isAnnualBillingAvailable } from "./stripe";

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
