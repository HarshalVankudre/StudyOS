/**
 * The credits and settings pages show the credit pack's price only when its
 * checkout can charge it (lib/plan-pricing.ts getCreditPackPricing `offered`):
 * with billing on and a Stripe Price that cannot be sold, they say it is not
 * available instead of showing a price and a Buy button. And beside the
 * pack's price they say whether it includes VAT while Stripe Tax is on.
 */
import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { en } from "@/lib/i18n/dictionaries/en";
import { fmt } from "@/lib/i18n/interpolate";
import { pluralizer } from "@/lib/i18n/plural";
import type { createFakeStripe } from "@/test/billing-fakes";

const mocks = vi.hoisted(() => ({
  getI18n: vi.fn(),
  stripe: null as unknown as ReturnType<typeof createFakeStripe>,
}));

vi.mock("@/lib/stripe", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/stripe")>();
  const { createFakeStripe } = await import("@/test/billing-fakes");
  mocks.stripe = createFakeStripe();
  return { ...actual, stripe: mocks.stripe.stripe };
});
vi.mock("@/lib/db", () => ({ prisma: {} }));
vi.mock("next/navigation", () => ({ redirect: () => { throw new Error("redirect"); } }));
vi.mock("@clerk/nextjs/server", () => ({
  auth: async () => ({ userId: "user_1" }),
  currentUser: async () => ({ firstName: "Ada", lastName: "L", emailAddresses: [{ emailAddress: "ada@example.com" }] }),
}));
vi.mock("@/lib/i18n/server", () => ({ getI18n: mocks.getI18n }));
vi.mock("@/lib/billing", () => ({ isPro: async () => false, getUserPlan: async () => "free" }));
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
vi.mock("@/components/account/DeleteAccountButton", () => ({ DeleteAccountButton: () => null }));
vi.mock("@/components/account/SignOutButton", () => ({ SignOutButton: () => null }));
vi.mock("@/components/account/DownloadDataButton", () => ({ DownloadDataButton: () => null }));
vi.mock("@/components/account/CalendarSubscribe", () => ({ CalendarSubscribe: () => null }));
vi.mock("@/components/account/ManageAccountButton", () => ({ ManageAccountButton: () => null }));
vi.mock("@/components/notifications/NotificationSettings", () => ({ NotificationSettings: () => null }));

import CreditsPage from "@/app/app/credits/page";
import SettingsPage from "@/app/app/settings/page";
import "@/lib/stripe";
import { clearProPriceCache } from "@/lib/plan-pricing";
import { CREDIT_PACK_SIZE } from "@/lib/price-list";

const credits = async () => render(await CreditsPage({ searchParams: Promise.resolve({}) }));
const settings = async () => render(await SettingsPage());
const buyButton = () =>
  screen.queryByRole("button", { name: new RegExp(`${CREDIT_PACK_SIZE.toLocaleString("en")}`) });

function billingOn(pack: Record<string, unknown> | null) {
  vi.stubEnv("STRIPE_SECRET_KEY", "sk_test");
  vi.stubEnv("STRIPE_PRICE_PRO", "price_month");
  mocks.stripe.setPrice("price_month", { unit_amount: 700, currency: "eur" });
  if (pack) {
    vi.stubEnv("STRIPE_PRICE_CREDIT_PACK", "price_pack");
    mocks.stripe.setPrice("price_pack", { type: "one_time", recurring: null, unit_amount: 999, currency: "eur", ...pack });
  }
}

beforeEach(() => {
  mocks.getI18n.mockResolvedValue({ dict: getDictionary("en"), locale: "en", t: fmt, plural: pluralizer("en"), dir: "ltr" });
  for (const name of [
    "STRIPE_SECRET_KEY",
    "STRIPE_PRICE_PRO",
    "STRIPE_PRICE_PRO_ANNUAL",
    "STRIPE_PRICE_CREDIT_PACK",
    "STRIPE_AUTOMATIC_TAX",
    "STRIPE_TAX_BEHAVIOR",
  ]) {
    vi.stubEnv(name, "");
  }
  mocks.stripe.reset();
  clearProPriceCache();
});
afterEach(() => vi.unstubAllEnvs());

describe("a pack its Stripe Price cannot sell", () => {
  test("credits page: no price, no Buy button, only that it is not available", async () => {
    billingOn({ active: false });
    const { container } = await credits();
    expect(screen.queryByTestId("pack-price")).toBeNull();
    expect(container.textContent).not.toContain("9.99");
    expect(buyButton()).toBeNull();
    expect(screen.getByTestId("pack-unavailable")).toHaveTextContent(en.credits.unavailable);
    expect(screen.getByTestId("pack-unavailable")).toHaveTextContent(en.credits.packUnavailableNote);
  });

  test("settings page: the same", async () => {
    billingOn({ currency_options: { eur: {}, usd: {} } });
    const { container } = await settings();
    expect(container.textContent).not.toContain("9.99");
    expect(buyButton()).toBeNull();
    expect(screen.getByTestId("pack-unavailable")).toHaveTextContent(en.credits.unavailable);
  });

  test("when it can be sold, both pages show its price and the Buy button", async () => {
    billingOn({});
    let view = await credits();
    expect(screen.getByTestId("pack-price")).toHaveTextContent("€9.99");
    expect(buyButton()).toBeInTheDocument();
    expect(screen.queryByTestId("pack-unavailable")).toBeNull();
    view.unmount();
    view = await settings();
    expect(buyButton()).toHaveTextContent("€9.99");
    expect(screen.queryByTestId("pack-unavailable")).toBeNull();
  });

  test("with billing off nothing changes: the price is shown, marked coming soon", async () => {
    const { container } = await credits();
    expect(screen.getByTestId("pack-price")).toBeInTheDocument();
    expect(screen.getByTestId("coming-soon")).toBeInTheDocument();
    expect(screen.queryByTestId("pack-unavailable")).toBeNull();
    expect(container.textContent).not.toContain(en.credits.unavailable);
  });
});

describe("the VAT note beside the settings page's pack button", () => {
  test("is shown while Stripe Tax is on, as on the pricing page", async () => {
    billingOn(null);
    let view = await settings();
    expect(screen.queryByTestId("vat-note")).toBeNull();
    view.unmount();
    vi.stubEnv("STRIPE_AUTOMATIC_TAX", "1");
    view = await settings();
    expect(screen.getByTestId("vat-note")).toHaveTextContent(en.checkout.vatIncluded);
    view.unmount();
    vi.stubEnv("STRIPE_TAX_BEHAVIOR", "exclusive");
    await settings();
    expect(screen.getByTestId("vat-note")).toHaveTextContent(en.checkout.vatExcluded);
  });
});
