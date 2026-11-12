/**
 * Every page that states a plan or price number reads it from the price list
 * (lib/price-list.ts). Here the price list is built with other numbers than
 * the real ones; each page must show those, and none of the real ones, so a
 * number written into a page or a dictionary instead of read from the module
 * fails this test. (The README, which cannot read the module, is checked
 * against it in price-list.test.ts.)
 */
import { render } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { fmt } from "@/lib/i18n/interpolate";
import { pluralizer } from "@/lib/i18n/plural";
import type { createFakeStripe } from "@/test/billing-fakes";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  getI18n: vi.fn(),
  isPro: vi.fn(),
  stripe: null as unknown as ReturnType<typeof createFakeStripe>,
}));

// A price list with none of the real numbers in it.
vi.mock("@/lib/price-list", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/price-list")>();
  return {
    ...real,
    ...real.createPriceList({
      ...real.DEFAULT_PRICE_LIST,
      trialCredits: 313,
      proMonthlyCredits: 1234,
      proFallbackUsd: { month: 8.49, year: 41.49 },
      creditPack: { credits: 1111, usd: 12 },
      actions: { build: 37, message: 4, studyKitPart: 11, render: 5 },
      turnCreditCap: { free: 31, pro: 107 },
      freeFailuresPerDay: 2,
      usageLimits: {
        ...real.DEFAULT_PRICE_LIST.usageLimits,
        generate: { free: 9, pro: 29, windowMs: 3_600_000 },
        agent: { free: 59, pro: 179, windowMs: 3_600_000 },
        study_kit: { free: 8, pro: 28, windowMs: 3_600_000 },
      },
    }),
  };
});
vi.mock("@/lib/stripe", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/stripe")>();
  const { createFakeStripe } = await import("@/test/billing-fakes");
  mocks.stripe = createFakeStripe();
  return { ...actual, stripe: mocks.stripe.stripe };
});
vi.mock("@/lib/db", () => ({ prisma: {} }));
vi.mock("@clerk/nextjs/server", () => ({
  auth: mocks.auth,
  currentUser: async () => ({ firstName: "Ada", lastName: "L", emailAddresses: [{ emailAddress: "ada@example.com" }] }),
}));
vi.mock("@clerk/nextjs", () => ({ UserButton: () => null }));
vi.mock("next/form", () => ({ default: (props: React.ComponentProps<"form">) => <form {...props} /> }));
vi.mock("@/lib/i18n/server", () => ({ getI18n: mocks.getI18n }));
vi.mock("@/lib/billing", () => ({ isPro: mocks.isPro, getUserPlan: async () => "free" }));
vi.mock("@/lib/credits", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/credits")>()),
  getCreditBalance: vi.fn(async () => 42),
}));
vi.mock("@/lib/ai/plans", () => ({ modelForPlan: () => "claude-haiku-5-5" }));
vi.mock("@/app/app/billing-actions", () => ({
  startCheckoutAction: async () => {},
  buyCreditsAction: async () => {},
  manageBillingAction: async () => {},
}));
vi.mock("@/app/app/calendar-actions", () => ({ getCalendarFeedUrlAction: async () => null }));
vi.mock("@/lib/notifications/service", () => ({ getNotificationSettings: async () => null }));
vi.mock("@/components/LanguageSwitcher", () => ({ LanguageSwitcher: () => null }));
vi.mock("@/components/ThemeToggle", () => ({ ThemeToggle: () => null }));
vi.mock("@/components/account/DeleteAccountButton", () => ({ DeleteAccountButton: () => null }));
vi.mock("@/components/account/SignOutButton", () => ({ SignOutButton: () => null }));
vi.mock("@/components/account/DownloadDataButton", () => ({ DownloadDataButton: () => null }));
vi.mock("@/components/account/CalendarSubscribe", () => ({ CalendarSubscribe: () => null }));
vi.mock("@/components/account/ManageAccountButton", () => ({ ManageAccountButton: () => null }));
vi.mock("@/components/notifications/NotificationSettings", () => ({ NotificationSettings: () => null }));

import PricingPage from "@/app/pricing/page";
import Home from "@/app/page";
import TermsPage from "@/app/terms/page";
import SettingsPage from "@/app/app/settings/page";
import CreditsPage from "@/app/app/credits/page";
import "@/lib/stripe";
import { clearProPriceCache } from "@/lib/plan-pricing";

const text = (el: HTMLElement) => (el.textContent ?? "").replace(/\s+/g, " ");

/** Real numbers that must not appear where the module's numbers belong. */
const REAL = [
  /\b300 (AI |trial )?credits/,
  /\b1,000 (AI )?credits/,
  /\$7\.99|\$39\.99|\$3\.33/,
  /\b30 credits/,
  /\b10 per part/,
  /\b3 credits/,
];

beforeEach(() => {
  mocks.auth.mockResolvedValue({ userId: "user_1" });
  mocks.isPro.mockResolvedValue(false);
  mocks.getI18n.mockResolvedValue({ dict: getDictionary("en"), locale: "en", t: fmt, plural: pluralizer("en"), dir: "ltr" });
  for (const name of ["STRIPE_SECRET_KEY", "STRIPE_PRICE_PRO", "STRIPE_PRICE_PRO_ANNUAL", "STUDYOS_PRO_MONTHLY_PRICE", "STUDYOS_PRO_ANNUAL_PRICE"]) {
    vi.stubEnv(name, "");
  }
  mocks.stripe.reset();
  clearProPriceCache();
});

describe("pages follow the price list", () => {
  test("pricing", async () => {
    const page = text(render(await PricingPage({ searchParams: Promise.resolve({}) })).container);
    for (const expected of [
      "313 credits to try everything",
      "313 AI credits once, to try every feature",
      "1,234 AI credits for every paid month",
      "$8.49/month",
      "or $41.49 a year ($3.46 a month)",
      "37 credits",
      "4 credits",
      "11 per part",
      "never more than 31 on Free or 107 on Pro",
      "up to 2 a day",
      "1,111",
      "$12",
      // Examples, computed: 1,234 credits at 37 / 11 / 4.
      "33 workspace builds",
      "112 study-kit parts",
      "308 assistant messages",
    ]) {
      expect(page).toContain(expected);
    }
    for (const real of REAL) expect(page).not.toMatch(real);
  });

  test("landing", async () => {
    mocks.auth.mockResolvedValue({ userId: null });
    const page = text(render(await Home()).container);
    for (const expected of ["313 AI credits once", "it’s 313 trial credits, once", "1,234 AI credits for every paid month", "$8.49", "costs 4 credits", "31 credits on Free or 107 on Pro"]) {
      expect(page).toContain(expected);
    }
    for (const real of REAL) expect(page).not.toMatch(real);
  });

  test("terms", async () => {
    const page = text(render(await TermsPage()).container);
    for (const expected of [
      "one-time trial of 313 credits",
      "1,234 credits for each paid month",
      "costs 37 credits, one assistant message 4 credits, a study kit 11 credits for each part",
      "a rendered visual 5 credits",
      "more than 31 credits on Free or 107 credits on Pro",
      "up to 2 failed messages a day",
    ]) {
      expect(page).toContain(expected);
    }
    for (const real of REAL) expect(page).not.toMatch(real);
  });

  test("settings", async () => {
    const page = text(render(await SettingsPage()).container);
    expect(page).toContain("313 trial credits, once");
    expect(page).toContain("Pro adds 1,234 credits for each paid month");
    for (const real of REAL) expect(page).not.toMatch(real);
  });

  test("credits", async () => {
    const page = text(render(await CreditsPage({ searchParams: Promise.resolve({}) })).container);
    expect(page).toContain("1,111");
    expect(page).toContain("$12");
    // 1,111 credits at 37 a build and 4 a message.
    expect(page).toContain("Enough for 30 workspace builds or 277 assistant messages");
    for (const real of REAL) expect(page).not.toMatch(real);
  });
});
