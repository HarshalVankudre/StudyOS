import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { LOCALES, type Locale } from "@/lib/i18n/config";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { en } from "@/lib/i18n/dictionaries/en";
import { fmt } from "@/lib/i18n/interpolate";
import {
  CREDIT_PACK_PRICE_USD,
  FREE_MONTHLY_CREDITS,
  FREE_SIGNUP_CREDITS,
  PRO_MONTHLY_CREDITS,
} from "@/lib/credits";
import { CREDITS_PER_GENERATION, STUDY_KIT_MAX_CREDITS_PER_SECTION } from "@/lib/credits-info";
import { TURN_CREDIT_CAP } from "@/lib/ai/budgets";
import { USAGE_LIMITS } from "@/lib/usage-limits";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  getI18n: vi.fn(),
  isPro: vi.fn(),
  models: { free: "z-ai/glm-5.2", pro: "z-ai/glm-5.2" } as Record<string, string>,
}));

vi.mock("@/lib/db", () => ({ prisma: {} }));
vi.mock("@clerk/nextjs/server", () => ({ auth: mocks.auth }));
vi.mock("@clerk/nextjs", () => ({ UserButton: () => <div data-testid="user-button" /> }));
vi.mock("@/lib/i18n/server", () => ({ getI18n: mocks.getI18n }));
vi.mock("@/lib/billing", () => ({ isPro: mocks.isPro }));
vi.mock("@/lib/credits", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/credits")>()),
  getCreditBalance: vi.fn(async () => 420),
}));
vi.mock("@/lib/ai/plans", () => ({ modelForPlan: (plan: string) => mocks.models[plan] }));
vi.mock("@/app/app/billing-actions", () => ({
  startCheckoutAction: async () => {},
  buyCreditsAction: async () => {},
  manageBillingAction: async () => {},
}));
vi.mock("@/components/LanguageSwitcher", () => ({ LanguageSwitcher: () => null }));
vi.mock("@/components/ThemeToggle", () => ({ ThemeToggle: () => null }));

import PricingPage from "./page";

const page = async () => render(await PricingPage({ searchParams: Promise.resolve({}) }));

function useLocale(locale: Locale) {
  mocks.getI18n.mockResolvedValue({ dict: getDictionary(locale), locale, t: fmt, dir: locale === "ar" ? "rtl" : "ltr" });
}

function enableAnnual(displayed = "48") {
  vi.stubEnv("STRIPE_SECRET_KEY", "sk_test");
  vi.stubEnv("STRIPE_PRICE_PRO", "price_month");
  vi.stubEnv("STRIPE_PRICE_PRO_ANNUAL", "price_year");
  vi.stubEnv("STUDYOS_PRO_ANNUAL_PRICE", displayed);
}

describe("pricing page", () => {
  beforeEach(() => {
    mocks.auth.mockResolvedValue({ userId: null });
    mocks.isPro.mockResolvedValue(false);
    mocks.models.pro = "z-ai/glm-5.2";
    useLocale("en");
    for (const name of ["STRIPE_SECRET_KEY", "STRIPE_PRICE_PRO", "STRIPE_PRICE_PRO_ANNUAL", "STUDYOS_PRO_ANNUAL_PRICE", "STUDYOS_PRO_MONTHLY_PRICE"]) {
      vi.stubEnv(name, "");
    }
  });
  afterEach(() => vi.unstubAllEnvs());

  test.each(LOCALES.map((l) => l.code))("renders completely in %s, annual included", async (locale) => {
    enableAnnual();
    useLocale(locale);
    const { container } = await page();
    const text = container.textContent ?? "";
    const dict = getDictionary(locale);
    expect(text).toContain(dict.pricing.title);
    expect(text).toContain(dict.pricing.faqAnnual.q);
    expect(text).not.toMatch(/undefined|NaN|\[object Object\]/);
    expect(text).not.toMatch(/\{[a-zA-Z]+\}/);
  });

  test("the yearly switch appears only when annual billing is configured", async () => {
    let view = await page();
    expect(screen.queryByRole("radio", { name: en.pricing.yearly })).toBeNull();
    expect(view.container.textContent).not.toContain(en.pricing.faqAnnual.q);
    view.unmount();

    // A Stripe annual price without a displayed price stays hidden: never guess an amount.
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test");
    vi.stubEnv("STRIPE_PRICE_PRO", "price_month");
    vi.stubEnv("STRIPE_PRICE_PRO_ANNUAL", "price_year");
    view = await page();
    expect(screen.queryByRole("radio", { name: en.pricing.yearly })).toBeNull();
    view.unmount();

    enableAnnual();
    view = await page();
    expect(screen.getByRole("radio", { name: new RegExp(en.pricing.yearly) })).toBeInTheDocument();
  });

  test("checkout sends the chosen interval", async () => {
    enableAnnual("48");
    mocks.auth.mockResolvedValue({ userId: "user_1" });
    const { container } = await page();
    const interval = () => container.querySelector<HTMLInputElement>('input[type=hidden][name="interval"]')!;
    expect(interval().value).toBe("month");
    expect(container.textContent).toContain("$5/month");

    fireEvent.click(screen.getByRole("radio", { name: /yearly/i }));
    expect(interval().value).toBe("year");
    expect(container.textContent).toContain("$48/year");
    expect(container.textContent).toContain("$4 a month");
    expect(screen.getByText("save 20%")).toBeInTheDocument();
  });

  test("displayed prices come from the one pricing configuration", async () => {
    vi.stubEnv("STUDYOS_PRO_MONTHLY_PRICE", "9");
    const { container } = await page();
    const text = container.textContent ?? "";
    expect(text).toContain("$9/month");
    expect(text).not.toContain("$5");
    expect(text).toContain(`$${CREDIT_PACK_PRICE_USD}`);
  });

  test("states the plans, costs and limits the code implements", async () => {
    const { container } = await page();
    const text = container.textContent ?? "";
    expect(text).toContain(`${FREE_SIGNUP_CREDITS} AI credits when you sign up`);
    expect(text).toContain(`if your balance is under ${FREE_MONTHLY_CREDITS}, ${FREE_MONTHLY_CREDITS} credits are added`);
    expect(text).toContain(`${PRO_MONTHLY_CREDITS.toLocaleString("en")} AI credits for every paid month`);
    expect(text).toContain(`about ${CREDITS_PER_GENERATION}`);
    expect(text).toContain(`never costs more than ${STUDY_KIT_MAX_CREDITS_PER_SECTION} per part`);

    const row = (label: string) => screen.getByRole("rowheader", { name: label }).closest("tr")!;
    expect(within(row(en.pricing.limits.builds)).getByText(String(USAGE_LIMITS.generate.free))).toBeInTheDocument();
    expect(within(row(en.pricing.limits.builds)).getByText(String(USAGE_LIMITS.generate.pro))).toBeInTheDocument();
    expect(within(row(en.pricing.limits.messageCap)).getByText(String(TURN_CREDIT_CAP.pro))).toBeInTheDocument();

    for (const claim of [/most capable/i, /smartest/i, /priority/i, /early access/i, /community/i]) {
      expect(text).not.toMatch(claim);
    }
  });

  test("says both plans use the same model only when they do", async () => {
    let view = await page();
    expect(screen.getByText(en.pricing.sameModel)).toBeInTheDocument();
    view.unmount();
    mocks.models.pro = "claude-something";
    view = await page();
    expect(screen.queryByText(en.pricing.sameModel)).toBeNull();
    expect(view.container.textContent).not.toContain(en.pricing.limits.sameModel);
  });

  test("Pro subscribers see their plan and the billing portal instead of checkout", async () => {
    mocks.auth.mockResolvedValue({ userId: "user_1" });
    mocks.isPro.mockResolvedValue(true);
    await page();
    expect(screen.getByText(en.pricing.pro.currentPlan)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: en.pricing.pro.manageBilling })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: en.pricing.pro.upgrade })).toBeNull();
  });

  test("signed-out visitors are sent to sign-up and back to pricing for Pro", async () => {
    await page();
    expect(screen.getByRole("link", { name: en.pricing.pro.ctaSignedOut })).toHaveAttribute(
      "href",
      "/sign-up?redirect_url=%2Fpricing",
    );
  });
});
