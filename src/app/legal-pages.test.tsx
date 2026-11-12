import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { fmt } from "@/lib/i18n/interpolate";
import {
  ACTION_PRICES,
  FREE_FAILURES_PER_DAY,
  PRO_MONTHLY_CREDITS,
  TRIAL_CREDITS,
  TURN_CREDIT_CAP,
} from "@/lib/price-list";

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
    expect(text).toContain(`New accounts receive a one-time trial of ${TRIAL_CREDITS} credits. The Free plan includes no further credits.`);
    expect(text).toContain(`${PRO_MONTHLY_CREDITS.toLocaleString("en-US")} credits for each paid month`);
    expect(text).toContain("it does not unlock additional features");
    expect(text).toContain(
      `building a workspace (its setup questions included) costs ${ACTION_PRICES.build} credits, one assistant message ${ACTION_PRICES.message} credits, a study kit ${ACTION_PRICES.studyKitPart} credits for each part of your material it processes, and a rendered visual ${ACTION_PRICES.render} credits`,
    );
    expect(text).toContain(`never costs more than ${TURN_CREDIT_CAP.free} credits on Free or ${TURN_CREDIT_CAP.pro} credits on Pro`);
    expect(text).toContain(`up to ${FREE_FAILURES_PER_DAY} failed messages a day`);
    expect(text).toContain("that action is charged what it actually costs, and the most it can cost is shown before you start it");
    expect(text).toContain("never more than its price");
    expect(text).not.toMatch(/calendar month|below 150|Credit consumption scales/i);
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
