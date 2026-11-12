import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { LOCALES, type Locale } from "@/lib/i18n/config";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { en } from "@/lib/i18n/dictionaries/en";
import { fmt } from "@/lib/i18n/interpolate";
import { pluralizer } from "@/lib/i18n/plural";
import {
  ACTION_PRICES,
  buildQuote,
  CREDIT_PACK_PRICE_USD,
  FREE_FAILURES_PER_DAY,
  PRO_MONTHLY_CREDITS,
  TRIAL_CREDITS,
  TURN_CREDIT_CAP,
  USAGE_LIMITS,
} from "@/lib/price-list";
import { clearProPriceCache } from "@/lib/plan-pricing";
import type { createFakeStripe } from "@/test/billing-fakes";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  getI18n: vi.fn(),
  isPro: vi.fn(),
  // The configured model (real cost within every list price) unless a test changes it.
  models: { free: "claude-haiku-5-5", pro: "claude-haiku-5-5" } as Record<string, string>,
  stripe: null as unknown as ReturnType<typeof createFakeStripe>,
}));

// The Stripe Prices the page shows come from the in-memory fake (no network).
vi.mock("@/lib/stripe", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/stripe")>();
  const { createFakeStripe } = await import("@/test/billing-fakes");
  mocks.stripe = createFakeStripe();
  return { ...actual, stripe: mocks.stripe.stripe };
});

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
import "@/lib/stripe"; // creates the fake (lib/plan-pricing reads it lazily)

const page = async () => render(await PricingPage({ searchParams: Promise.resolve({}) }));

function useLocale(locale: Locale) {
  mocks.getI18n.mockResolvedValue({
    dict: getDictionary(locale),
    locale,
    t: fmt,
    plural: pluralizer(locale),
    dir: locale === "ar" ? "rtl" : "ltr",
  });
}

/** Billing on, with Stripe Prices of $5 a month and `yearlyCents` a year. */
function enableAnnual(yearlyCents = 4800) {
  vi.stubEnv("STRIPE_SECRET_KEY", "sk_test");
  vi.stubEnv("STRIPE_PRICE_PRO", "price_month");
  vi.stubEnv("STRIPE_PRICE_PRO_ANNUAL", "price_year");
  mocks.stripe.setPrice("price_month", { unit_amount: 500 });
  mocks.stripe.setPrice("price_year", { unit_amount: yearlyCents, recurring: { interval: "year", interval_count: 1 } });
}

describe("pricing page", () => {
  beforeEach(() => {
    mocks.auth.mockResolvedValue({ userId: null });
    mocks.isPro.mockResolvedValue(false);
    mocks.models.free = "claude-haiku-5-5";
    mocks.models.pro = "claude-haiku-5-5";
    useLocale("en");
    for (const name of ["STRIPE_SECRET_KEY", "STRIPE_PRICE_PRO", "STRIPE_PRICE_PRO_ANNUAL", "STUDYOS_PRO_ANNUAL_PRICE", "STUDYOS_PRO_MONTHLY_PRICE"]) {
      vi.stubEnv(name, "");
    }
    mocks.stripe.reset();
    clearProPriceCache();
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
    // The study-help promise, backed by the agent's and study kit's prompts (src/lib/ai/integrity.ts).
    expect(dict.pricing.faq.some((item) => /StudyOS/.test(item.q) && text.includes(item.a))).toBe(true);
    expect(text).not.toMatch(/undefined|NaN|\[object Object\]/);
    expect(text).not.toMatch(/\{[a-zA-Z]+\}/);
  });

  test("the yearly switch appears only when annual billing is configured", async () => {
    // Billing off: both fallback prices are shown, nothing can be chosen or bought.
    let view = await page();
    expect(screen.queryByRole("radio", { name: en.pricing.yearly })).toBeNull();
    expect(view.container.textContent).toContain("$7.99/month");
    expect(view.container.textContent).toContain("or $39.99 a year ($3.33 a month)");
    view.unmount();

    // Billing on without a yearly Stripe price: no yearly price anywhere.
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test");
    vi.stubEnv("STRIPE_PRICE_PRO", "price_month");
    mocks.stripe.setPrice("price_month", { unit_amount: 799 });
    clearProPriceCache();
    view = await page();
    expect(view.container.textContent).not.toContain(en.pricing.faqAnnual.q);
    expect(view.container.textContent).not.toContain("39.99");
    view.unmount();

    // An "annual" Stripe price that really bills monthly is never shown as yearly.
    enableAnnual();
    mocks.stripe.setPrice("price_year", { unit_amount: 4800 });
    clearProPriceCache();
    view = await page();
    expect(screen.queryByRole("radio", { name: en.pricing.yearly })).toBeNull();
    view.unmount();

    enableAnnual();
    clearProPriceCache();
    view = await page();
    expect(screen.getByRole("radio", { name: new RegExp(en.pricing.yearly) })).toBeInTheDocument();
  });

  test("checkout sends the chosen interval", async () => {
    enableAnnual(4800);
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

  test("with billing off, the displayed price is the configured one", async () => {
    vi.stubEnv("STUDYOS_PRO_MONTHLY_PRICE", "9");
    const { container } = await page();
    const text = container.textContent ?? "";
    expect(text).toContain("$9/month");
    expect(text).not.toContain("$5");
    expect(text).toContain(`$${CREDIT_PACK_PRICE_USD}`);
  });

  test("with billing on, the page shows what Stripe charges, in its currency", async () => {
    vi.stubEnv("STUDYOS_PRO_MONTHLY_PRICE", "9"); // a stale setting is ignored
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test");
    vi.stubEnv("STRIPE_PRICE_PRO", "price_month");
    mocks.stripe.setPrice("price_month", { unit_amount: 700, currency: "eur" });
    const { container } = await page();
    const text = container.textContent ?? "";
    expect(text).toContain("€7/month");
    expect(text).not.toContain("$9");
    expect(screen.queryByRole("radio", { name: en.pricing.yearly })).toBeNull();
  });

  test("states the plans, prices and limits the code implements", async () => {
    const { container } = await page();
    const text = container.textContent ?? "";
    // Free is a trial; Pro is more credits; no monthly top-up anywhere.
    expect(text).toContain(`${TRIAL_CREDITS} credits to try everything; no card.`);
    expect(text).toContain(`${TRIAL_CREDITS} AI credits once, to try every feature`);
    expect(text).toContain(`${PRO_MONTHLY_CREDITS.toLocaleString("en")} AI credits for every paid month`);
    expect(text).toContain("The same features as Free: Pro is for more credits");
    expect(text).not.toMatch(/once a month|balance is under|credits are added/i);
    // The price list, as fixed prices on the configured model.
    const cost = (action: string) => within(screen.getByRole("rowheader", { name: action }).closest("tr")!).getByText(/credit|per part/);
    expect(cost(en.pricing.costs.rows.build.action)).toHaveTextContent(`${ACTION_PRICES.build} credits`);
    expect(cost(en.pricing.costs.rows.assistant.action)).toHaveTextContent(`${ACTION_PRICES.message} credits`);
    expect(cost(en.pricing.costs.rows.studyKit.action)).toHaveTextContent(`${ACTION_PRICES.studyKitPart} per part`);
    expect(screen.queryByTestId("real-cost-note")).toBeNull();
    expect(text).toContain(`up to ${FREE_FAILURES_PER_DAY} a day`);
    // What a month of Pro covers, computed from the prices.
    const examples = screen.getByTestId("credit-examples").textContent ?? "";
    expect(examples).toContain("33 workspace builds");
    expect(examples).toContain("100 study-kit parts");
    expect(examples).toContain("333 assistant messages");
    expect(examples).toMatch(/Your 300 trial credits cover, for example, 1 workspace build, \d+ study-kit parts and \d+ assistant messages\./);
    // The FAQ for the trial model.
    expect(text).toContain(en.pricing.faq.find((f) => f.q === "What happens when my trial credits run out?")!.a);

    const row = (label: string) => screen.getByRole("rowheader", { name: label }).closest("tr")!;
    expect(within(row(en.pricing.limits.builds)).getByText(String(USAGE_LIMITS.generate.free))).toBeInTheDocument();
    expect(within(row(en.pricing.limits.builds)).getByText(String(USAGE_LIMITS.generate.pro))).toBeInTheDocument();
    expect(within(row(en.pricing.limits.messageCap)).getByText(String(TURN_CREDIT_CAP.pro))).toBeInTheDocument();

    for (const claim of [/most capable/i, /smartest/i, /priority/i, /early access/i, /community/i]) {
      expect(text).not.toMatch(claim);
    }
  });

  test("on an expensive model, the page shows the real cost and the most an action can cost", async () => {
    mocks.models.free = "z-ai/glm-5.2";
    mocks.models.pro = "z-ai/glm-5.2";
    await page();
    const q = buildQuote("z-ai/glm-5.2");
    const row = screen.getByRole("rowheader", { name: en.pricing.costs.rows.build.action }).closest("tr")!;
    expect(row).toHaveTextContent(`about ${q.price}, at most ${q.max}`);
    expect(screen.getByTestId("real-cost-note")).toHaveTextContent(en.pricing.costs.realCost);
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
    // A subscriber keeps the price they subscribed at: today's price is not shown as theirs.
    expect(screen.getByText(en.pricing.pro.currentPrice)).toBeInTheDocument();
    expect(screen.getByRole("region", { name: en.pricing.pro.name }).textContent).not.toMatch(/\$\d/);
    expect(screen.getByRole("button", { name: en.pricing.pro.manageBilling })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: en.pricing.pro.upgrade })).toBeNull();
  });

  test("with billing off, nothing can be bought: purchases are marked coming soon, once", async () => {
    mocks.auth.mockResolvedValue({ userId: "user_1" });
    const { container } = await page();
    expect(screen.queryByRole("button", { name: en.pricing.pro.upgrade })).toBeNull();
    // No checkout form of any kind (Pro, credit pack).
    expect(container.querySelectorAll("form")).toHaveLength(0);
    expect(screen.queryByRole("link", { name: en.pricing.credits.signUpToBuy })).toBeNull();
    // The Pro card and the credit pack each say "Coming soon"; the reason is said once.
    expect(screen.getAllByTestId("coming-soon")).toHaveLength(2);
    expect(container.textContent?.split(en.spend.purchasesComingSoon).length).toBe(2);
    expect(container.textContent).not.toContain(en.billingNotice.unavailable);
  });

  test("with billing on, purchase buttons are offered and nothing says coming soon", async () => {
    enableAnnual();
    mocks.auth.mockResolvedValue({ userId: "user_1" });
    const { container } = await page();
    expect(screen.getByRole("button", { name: new RegExp(en.pricing.pro.upgrade) })).toBeInTheDocument();
    expect(screen.queryAllByTestId("coming-soon")).toHaveLength(0);
    expect(container.textContent).not.toContain(en.spend.purchasesComingSoon);
  });

  test("signed-out visitors are sent to sign-up and back to pricing for Pro", async () => {
    enableAnnual();
    await page();
    expect(screen.getByRole("link", { name: en.pricing.pro.ctaSignedOut })).toHaveAttribute(
      "href",
      "/sign-up?redirect_url=%2Fpricing",
    );
  });
});
