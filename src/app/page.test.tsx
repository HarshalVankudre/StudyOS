import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { LOCALES, type Locale } from "@/lib/i18n/config";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { en } from "@/lib/i18n/dictionaries/en";
import { fmt } from "@/lib/i18n/interpolate";
import { formatLongDay } from "@/lib/agents/daily-study/present";
import { FREE_SIGNUP_CREDITS } from "@/lib/credits";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  getI18n: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ prisma: {} }));
vi.mock("@clerk/nextjs/server", () => ({ auth: mocks.auth }));
vi.mock("@clerk/nextjs", () => ({
  UserButton: () => <div data-testid="user-button" />,
}));
vi.mock("next/form", () => ({
  default: (props: React.ComponentProps<"form">) => <form {...props} />,
}));
vi.mock("@/lib/i18n/server", () => ({ getI18n: mocks.getI18n }));
vi.mock("@/components/LanguageSwitcher", () => ({
  LanguageSwitcher: () => <div data-testid="language-switcher" />,
}));
vi.mock("@/components/ThemeToggle", () => ({
  ThemeToggle: () => <div data-testid="theme-toggle" />,
}));

import Home from "./page";

function useLocale(locale: Locale) {
  mocks.getI18n.mockResolvedValue({ dict: getDictionary(locale), locale, t: fmt, dir: locale === "ar" ? "rtl" : "ltr" });
}

describe("landing page", () => {
  beforeEach(() => {
    mocks.auth.mockResolvedValue({ userId: null });
    useLocale("en");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });

  test.each(LOCALES.map((l) => l.code))("renders completely in %s", async (locale) => {
    useLocale(locale);
    const { container } = render(await Home());
    const text = container.textContent ?? "";
    const dict = getDictionary(locale);
    expect(text).toContain(dict.landing.hero.titleLine1);
    expect(text).toContain(dict.landing.chapters.material.title);
    expect(text).not.toMatch(/undefined|NaN|\[object Object\]/);
    // Every {placeholder} was filled in.
    expect(text).not.toMatch(/\{[a-zA-Z]+\}/);
    // Every rendering is labelled as a sample.
    expect(screen.getAllByText(dict.landing.samples.tag).length).toBeGreaterThanOrEqual(6);
  });

  test("the hero form starts a build, and sign-up is the call to action", async () => {
    render(await Home());
    const prompt = screen.getByRole("textbox", { name: en.generate.describe.placeholder });
    expect(prompt).toHaveAttribute("name", "prompt");
    expect(prompt.closest("form")).toHaveAttribute("action", "/generate");
    expect(screen.getByRole("link", { name: en.landing.hero.seeIt })).toHaveAttribute("href", "#product");
    expect(screen.getByRole("link", { name: /build my workspace/i })).toHaveAttribute("href", "/sign-up");
  });

  test("makes no claim the product cannot back", async () => {
    const { container } = render(await Home());
    const text = container.textContent ?? "";
    for (const claim of [/9\.4/, /seconds/i, /smartest/i, /most capable/i, /priority support/i, /early access/i, /June/]) {
      expect(text).not.toMatch(claim);
    }
    expect(text).toContain("about a minute");
    expect(text).toContain(`${FREE_SIGNUP_CREDITS} AI credits when you sign up`);
  });

  test("sample dates follow the day the page is rendered", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2031-04-09T09:00:00Z"));
    const { container } = render(await Home());
    expect(container.textContent).toContain(formatLongDay("2031-04-09", "en"));
  });

  test("prices and the support address come from configuration", async () => {
    let { container, unmount } = render(await Home());
    expect(container.textContent).toContain("$5/month");
    expect(screen.getByRole("link", { name: en.landing.footer.support })).toHaveAttribute(
      "href",
      "mailto:harshalvankudre@gmail.com",
    );
    unmount();

    vi.stubEnv("STUDYOS_PRO_MONTHLY_PRICE", "7");
    vi.stubEnv("STUDYOS_SUPPORT_EMAIL", "help@studyos.app");
    ({ container, unmount } = render(await Home()));
    expect(container.textContent).toContain("$7/month");
    expect(container.textContent).not.toContain("$5");
    expect(screen.getByRole("link", { name: en.landing.footer.support })).toHaveAttribute(
      "href",
      "mailto:help@studyos.app",
    );
  });

  test("signed-in visitors go to the app", async () => {
    mocks.auth.mockResolvedValue({ userId: "user_1" });
    render(await Home());
    expect(screen.getAllByRole("link", { name: en.landing.nav.openApp })[0]).toHaveAttribute("href", "/app");
    expect(screen.getByRole("link", { name: /build my workspace/i })).toHaveAttribute("href", "/generate");
  });
});
