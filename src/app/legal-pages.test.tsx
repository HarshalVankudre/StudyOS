import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { fmt } from "@/lib/i18n/interpolate";
import { FREE_MONTHLY_CREDITS, FREE_SIGNUP_CREDITS, PRO_MONTHLY_CREDITS } from "@/lib/credits";

const mocks = vi.hoisted(() => ({ getI18n: vi.fn() }));

vi.mock("@/lib/db", () => ({ prisma: {} }));
vi.mock("@/lib/i18n/server", () => ({ getI18n: mocks.getI18n }));

import PrivacyPage from "./privacy/page";
import TermsPage from "./terms/page";

describe("legal pages", () => {
  beforeEach(() => {
    mocks.getI18n.mockResolvedValue({ dict: getDictionary("en"), locale: "en", t: fmt, dir: "ltr" });
  });
  afterEach(() => vi.unstubAllEnvs());

  test("terms state the credit rules the code implements", async () => {
    const { container } = render(await TermsPage());
    const text = (container.textContent ?? "").replace(/\s+/g, " ");
    expect(text).toContain(`New accounts receive ${FREE_SIGNUP_CREDITS} credits`);
    expect(text).toContain(`below ${FREE_MONTHLY_CREDITS} credits receives ${FREE_MONTHLY_CREDITS} credits`);
    expect(text).toContain(`${PRO_MONTHLY_CREDITS.toLocaleString("en-US")} credits for each paid month`);
    expect(text).toContain("nothing resets the balance");
    expect(text).not.toMatch(/do not stack/i);
  });

  test("privacy covers self-serve export and deletion, study material and calendar links", async () => {
    const { container } = render(await PrivacyPage());
    const text = (container.textContent ?? "").replace(/\s+/g, " ");
    expect(text).toContain("Download my data");
    expect(text).toContain("Delete account");
    expect(text).toContain("Study material");
    expect(text).toContain("Calendar links");
    expect(text).toContain("sent to our AI provider");
  });

  test("both use the configured support address", async () => {
    vi.stubEnv("STUDYOS_SUPPORT_EMAIL", "help@studyos.app");
    for (const Page of [TermsPage, PrivacyPage]) {
      const { container, unmount } = render(await Page());
      expect(container.innerHTML).not.toContain("gmail.com");
      expect(screen.getAllByRole("link", { name: "help@studyos.app" }).length).toBeGreaterThan(0);
      unmount();
    }
  });

  test("other languages get localized chrome and an English-only note", async () => {
    const de = getDictionary("de");
    mocks.getI18n.mockResolvedValue({ dict: de, locale: "de", t: fmt, dir: "ltr" });
    render(await PrivacyPage());
    expect(screen.getByText(de.legal.englishOnly)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: de.legal.terms })).toHaveAttribute("href", "/terms");
  });
});
