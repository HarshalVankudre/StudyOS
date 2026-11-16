import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { fmt } from "@/lib/i18n/interpolate";
import { pluralizer } from "@/lib/i18n/plural";

const mocks = vi.hoisted(() => ({ cookie: undefined as string | undefined, locale: "en" as "en" | "ar" }));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (name === "studyos_ref" && mocks.cookie ? { name, value: mocks.cookie } : undefined),
  }),
}));
vi.mock("@/lib/i18n/server", () => ({
  getI18n: async () => ({
    dict: getDictionary(mocks.locale),
    locale: mocks.locale,
    t: fmt,
    plural: pluralizer(mocks.locale),
    dir: mocks.locale === "ar" ? "rtl" : "ltr",
  }),
}));
vi.mock("@clerk/nextjs", () => ({ SignUp: () => <div data-testid="clerk-sign-up" /> }));
vi.mock("@/components/LanguageSwitcher", () => ({ LanguageSwitcher: () => null }));

import Page from "./page";
import { referralCookieKey, signReferralCookie } from "@/lib/referral/cookie";

const KEY = referralCookieKey({ CLERK_SECRET_KEY: "sk_test_signup" })!;

beforeEach(() => {
  vi.stubEnv("CLERK_SECRET_KEY", "sk_test_signup");
  mocks.cookie = undefined;
  mocks.locale = "en";
});
afterEach(() => vi.unstubAllEnvs());

describe("the sign-up page", () => {
  it("tells a visitor who came through an invite link what they will get", async () => {
    mocks.cookie = signReferralCookie("K7MPQ2XR", new Date(), KEY);
    render(await Page());
    expect(screen.getByTestId("invited-note")).toHaveTextContent(
      "You were invited: you’ll get 100 credits as a bonus after your first workspace.",
    );
    expect(screen.getByTestId("clerk-sign-up")).toBeInTheDocument();
  });

  it("in the visitor's language, with the count in its plural form", async () => {
    mocks.cookie = signReferralCookie("K7MPQ2XR", new Date(), KEY);
    mocks.locale = "ar";
    render(await Page());
    expect(screen.getByTestId("invited-note")).toHaveTextContent("100 رصيد");
  });

  it("says nothing without a valid invite (none, forged, or expired)", async () => {
    for (const cookie of [
      undefined,
      signReferralCookie("K7MPQ2XR", new Date(), referralCookieKey({ CLERK_SECRET_KEY: "other" })!),
      signReferralCookie("K7MPQ2XR", new Date(Date.now() - 31 * 24 * 60 * 60 * 1000), KEY),
    ]) {
      mocks.cookie = cookie;
      const view = render(await Page());
      expect(screen.queryByTestId("invited-note")).toBeNull();
      view.unmount();
    }
  });
});
