import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  createProCheckout: vi.fn(),
  createCreditPackCheckout: vi.fn(),
  portalCreate: vi.fn(),
  subFindUnique: vi.fn(),
  pricing: vi.fn(),
  packPricing: vi.fn(),
  locale: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw Object.assign(new Error(`REDIRECT ${url}`), { url });
  },
}));
vi.mock("next/headers", () => ({
  headers: async () => new Map([["host", "studyos.test"]]),
}));
vi.mock("@clerk/nextjs/server", () => ({
  auth: async () => ({ userId: "user_1" }),
  currentUser: async () => ({ primaryEmailAddress: { emailAddress: "a@b.c" } }),
}));
vi.mock("@/lib/billing", () => ({
  createProCheckout: m.createProCheckout,
  createCreditPackCheckout: m.createCreditPackCheckout,
}));
vi.mock("@/lib/db", () => ({
  prisma: { subscription: { findUnique: m.subFindUnique } },
}));
// What the pricing page offers (from the Stripe Prices, lib/plan-pricing.ts).
vi.mock("@/lib/plan-pricing", () => ({ getProPricing: m.pricing, getCreditPackPricing: m.packPricing }));
// The student's app language (lib/i18n/server.ts reads the cookie and headers).
vi.mock("@/lib/i18n/server", () => ({ getLocale: m.locale }));
vi.mock("@/lib/stripe", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/stripe")>();
  return {
    ...actual,
    stripe: { billingPortal: { sessions: { create: m.portalCreate } } },
  };
});

import {
  buyCreditsAction,
  manageBillingAction,
  startCheckoutAction,
} from "./billing-actions";

async function redirectOf(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (err) {
    const url = (err as { url?: string }).url;
    if (url) return url;
    throw err;
  }
  throw new Error("expected a redirect");
}

function form(fields: Record<string, string> = {}) {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
}

beforeEach(() => {
  for (const fn of Object.values(m)) fn.mockReset();
  m.pricing.mockImplementation(async () => ({
    offered: { month: true, year: Boolean(process.env.STRIPE_PRICE_PRO_ANNUAL) },
  }));
  // No STRIPE_PRICE_CREDIT_PACK: the inline USD price.
  m.packPricing.mockResolvedValue({ priceId: null, offered: true });
  m.locale.mockResolvedValue("en");
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_x");
  vi.stubEnv("STRIPE_PRICE_PRO", "price_month");
  vi.stubEnv("STRIPE_PRICE_PRO_ANNUAL", "");
});
afterEach(() => vi.unstubAllEnvs());

describe("startCheckoutAction", () => {
  it("explains (not crashes) when billing is not configured", async () => {
    vi.stubEnv("STRIPE_SECRET_KEY", "");
    expect(await redirectOf(startCheckoutAction(form()))).toBe("/pricing?billing=unavailable");
    expect(m.createProCheckout).not.toHaveBeenCalled();
  });

  it("starts monthly checkout by default and redirects to Stripe", async () => {
    m.createProCheckout.mockResolvedValue({ url: "https://checkout.stripe.test/cs_1" });
    expect(await redirectOf(startCheckoutAction(form()))).toBe("https://checkout.stripe.test/cs_1");
    expect(m.createProCheckout).toHaveBeenCalledWith({
      userId: "user_1",
      email: "a@b.c",
      priceId: "price_month",
      origin: "https://studyos.test",
      locale: "en",
    });
  });

  it("opens Checkout in the student's app language", async () => {
    m.locale.mockResolvedValue("de");
    m.createProCheckout.mockResolvedValue({ url: "https://checkout.stripe.test/cs_de" });
    await redirectOf(startCheckoutAction(form()));
    expect(m.createProCheckout).toHaveBeenCalledWith(expect.objectContaining({ locale: "de" }));
  });

  it("uses the annual price when interval=year and it is configured", async () => {
    vi.stubEnv("STRIPE_PRICE_PRO_ANNUAL", "price_year");
    m.createProCheckout.mockResolvedValue({ url: "https://checkout.stripe.test/cs_2" });
    await redirectOf(startCheckoutAction(form({ interval: "year" })));
    expect(m.createProCheckout).toHaveBeenCalledWith(
      expect.objectContaining({ priceId: "price_year" }),
    );
  });

  it("never silently bills monthly when annual was asked for but is not offered", async () => {
    expect(await redirectOf(startCheckoutAction(form({ interval: "year" })))).toBe(
      "/pricing?billing=unavailable",
    );
    expect(m.createProCheckout).not.toHaveBeenCalled();
  });

  it("refuses an interval the pricing page does not offer, even when its price id is set", async () => {
    // STRIPE_PRICE_PRO_ANNUAL is set, but its Stripe Price is not a yearly price.
    vi.stubEnv("STRIPE_PRICE_PRO_ANNUAL", "price_year");
    m.pricing.mockResolvedValue({ offered: { month: true, year: false } });
    expect(await redirectOf(startCheckoutAction(form({ interval: "year" })))).toBe(
      "/pricing?billing=unavailable",
    );
    // Monthly not offered (its Stripe Price cannot be read right now).
    m.pricing.mockResolvedValue({ offered: { month: false, year: false } });
    expect(await redirectOf(startCheckoutAction(form()))).toBe("/pricing?billing=unavailable");
    expect(m.createProCheckout).not.toHaveBeenCalled();
  });

  it("tells an existing subscriber instead of starting a second subscription", async () => {
    m.createProCheckout.mockResolvedValue({ blocked: "already_subscribed" });
    expect(await redirectOf(startCheckoutAction(form()))).toBe(
      "/pricing?billing=already_subscribed",
    );
  });

  it("shows a friendly error when Stripe fails", async () => {
    m.createProCheckout.mockRejectedValue(new Error("stripe down"));
    expect(await redirectOf(startCheckoutAction(form()))).toBe("/pricing?billing=error");
  });
});

describe("buyCreditsAction", () => {
  it("explains when billing is not configured", async () => {
    vi.stubEnv("STRIPE_SECRET_KEY", "");
    expect(await redirectOf(buyCreditsAction())).toBe("/app/credits?billing=unavailable");
    expect(m.createCreditPackCheckout).not.toHaveBeenCalled();
  });

  it("redirects to Stripe on success", async () => {
    m.createCreditPackCheckout.mockResolvedValue({ url: "https://checkout.stripe.test/cs_3" });
    expect(await redirectOf(buyCreditsAction())).toBe("https://checkout.stripe.test/cs_3");
    // No Stripe pack price: the inline USD price, in the student's language.
    expect(m.createCreditPackCheckout).toHaveBeenCalledWith({
      userId: "user_1",
      email: "a@b.c",
      origin: "https://studyos.test",
      priceId: null,
      locale: "en",
    });
  });

  it("charges the Stripe pack price the pages show, in the student's language", async () => {
    m.packPricing.mockResolvedValue({ priceId: "price_pack_eur", offered: true });
    m.locale.mockResolvedValue("fr");
    m.createCreditPackCheckout.mockResolvedValue({ url: "https://checkout.stripe.test/cs_4" });
    await redirectOf(buyCreditsAction());
    expect(m.createCreditPackCheckout).toHaveBeenCalledWith(
      expect.objectContaining({ priceId: "price_pack_eur", locale: "fr" }),
    );
  });

  it("never falls back to another price when the configured Stripe pack price is not offered", async () => {
    m.packPricing.mockResolvedValue({ priceId: null, offered: false });
    expect(await redirectOf(buyCreditsAction())).toBe("/app/credits?billing=unavailable");
    expect(m.createCreditPackCheckout).not.toHaveBeenCalled();
  });

  it("shows a friendly error when Stripe fails", async () => {
    m.createCreditPackCheckout.mockRejectedValue(new Error("stripe down"));
    expect(await redirectOf(buyCreditsAction())).toBe("/app/credits?billing=error");
  });
});

describe("manageBillingAction", () => {
  it("opens the portal for the stored customer", async () => {
    m.subFindUnique.mockResolvedValue({ stripeCustomerId: "cus_1" });
    m.portalCreate.mockResolvedValue({ url: "https://billing.stripe.test/p" });
    expect(await redirectOf(manageBillingAction())).toBe("https://billing.stripe.test/p");
    expect(m.portalCreate).toHaveBeenCalledWith({
      customer: "cus_1",
      return_url: "https://studyos.test/app",
    });
  });

  it("explains when billing is not configured", async () => {
    vi.stubEnv("STRIPE_SECRET_KEY", "");
    expect(await redirectOf(manageBillingAction())).toBe("/pricing?billing=unavailable");
  });
});
