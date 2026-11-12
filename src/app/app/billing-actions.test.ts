import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  createProCheckout: vi.fn(),
  createCreditPackCheckout: vi.fn(),
  portalCreate: vi.fn(),
  subFindUnique: vi.fn(),
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
    });
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
