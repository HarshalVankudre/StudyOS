import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { fmt } from "@/lib/i18n/interpolate";
import {
  ACTION_PRICES,
  FREE_FAILURES_PER_DAY,
  PRO_MONTHLY_CREDITS,
  REFERRAL_CREDITS,
  REFERRAL_MAX_PER_DAY,
  REFERRAL_MAX_REWARDS,
  TRIAL_CREDITS,
  TURN_CREDIT_CAP,
} from "@/lib/price-list";

const mocks = vi.hoisted(() => ({ getI18n: vi.fn() }));

vi.mock("@/lib/db", () => ({ prisma: {} }));
vi.mock("@/lib/i18n/server", () => ({ getI18n: mocks.getI18n }));

import LegalNoticePage from "./legal-notice/page";
import PrivacyPage from "./privacy/page";
import sitemap from "./sitemap";
import TermsPage from "./terms/page";

const OPERATOR_VARS = [
  "STUDYOS_OPERATOR_NAME",
  "STUDYOS_OPERATOR_ADDRESS",
  "STUDYOS_OPERATOR_EMAIL",
  "STUDYOS_OPERATOR_PHONE",
  "STUDYOS_OPERATOR_REGISTER",
  "STUDYOS_OPERATOR_VAT_ID",
  "STUDYOS_OPERATOR_RESPONSIBLE",
];

function configureOperator(extra: Record<string, string> = {}) {
  vi.stubEnv("STUDYOS_OPERATOR_NAME", "Example Learning GmbH");
  vi.stubEnv("STUDYOS_OPERATOR_ADDRESS", "Musterstraße 1|10115 Berlin|Germany");
  for (const [name, value] of Object.entries(extra)) vi.stubEnv(name, value);
}

const textOf = (container: HTMLElement) => (container.textContent ?? "").replace(/\s+/g, " ");

describe("legal pages", () => {
  beforeEach(() => {
    mocks.getI18n.mockResolvedValue({ dict: getDictionary("en"), locale: "en", t: fmt, dir: "ltr" });
    // Whatever the machine's .env says: unconfigured unless a test sets them.
    for (const name of OPERATOR_VARS) vi.stubEnv(name, "");
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

  test("terms give EU/UK consumers the withdrawal right, addressed to the operator once configured", async () => {
    const unconfigured = textOf(render(await TermsPage()).container);
    expect(unconfigured).toContain("Right of withdrawal (consumers in the EU, EEA and UK)");
    expect(unconfigured).toContain("Pro credits of that period you had not used are removed from your balance");
    expect(unconfigured).toContain("within 14 days without giving any reason");
    expect(unconfigured).toContain("Model withdrawal form");
    expect(unconfigured).toContain("the right of withdrawal ends when the credits are added to your balance");

    configureOperator({ STUDYOS_OPERATOR_EMAIL: "legal@example.org" });
    const configured = textOf(render(await TermsPage()).container);
    expect(configured).toContain("To: Example Learning GmbH, Musterstraße 1, 10115 Berlin, Germany, legal@example.org");
  });

  test("terms never cap liability the law does not allow to be capped", async () => {
    const text = textOf(render(await TermsPage()).container);
    expect(text).toContain("for intent or gross negligence, for injury to life, body or health");
  });

  test("terms state the invite rules the referral code implements", async () => {
    const text = textOf(render(await TermsPage()).container);
    expect(text).toContain(`you each receive ${REFERRAL_CREDITS} credits`);
    expect(text).toContain(`up to ${REFERRAL_MAX_REWARDS} friends, and for ${REFERRAL_MAX_PER_DAY} in any 24 hours`);
    expect(text).toContain("Invite credits have no cash value");
  });

  test("privacy lists every cookie StudyOS sets, shared pages and invites", async () => {
    const text = textOf(render(await PrivacyPage()).container);
    for (const cookie of ["studyos_locale", "studyos_tz", "__Host-studyos_ref"]) expect(text).toContain(cookie);
    expect(text).toContain("one mailbox can earn the invite bonus only once");
    expect(text).toContain("no advertising or analytics cookies");
    expect(text).toContain("Shared pages");
    expect(text).toContain("The person who invited you sees only counts, never who you are.");
    expect(text).toContain("your shared links and the reports about them, your invite code and invite records");
  });

  test("privacy explains the optional answer about why an account was deleted", async () => {
    const text = textOf(render(await PrivacyPage()).container);
    expect(text).toContain("Why you left");
    expect(text).toContain("without your name, email or account");
    expect(text).toContain("deleted after 2 years");
  });

  test("privacy states a legal basis for each use", async () => {
    const text = textOf(render(await PrivacyPage()).container);
    expect(text).toContain("Article 6(1) GDPR");
    for (const point of ["(point a)", "(point b)", "(point c)", "(point f)"]) expect(text).toContain(point);
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

  test("privacy states where StudyOS runs today, and the transfers it relies on", async () => {
    const { container } = render(await PrivacyPage());
    const text = textOf(container);
    expect(text).toContain("Effective November 13, 2026");
    expect(text).toContain("rented from Hetzner Online GmbH in its data centre in Helsinki, Finland (EU)");
    expect(text).toContain("The public website pages (the landing page, pricing and the legal pages) are served by Vercel");
    expect(text).toContain("Google Cloud Storage only when that optional feature is switched on");
    expect(text).not.toMatch(/Neon|AWS|runs on Google Cloud/);
    // Both AI configurations (lib/ai/provider.ts).
    expect(text).toContain("that provider is Anthropic");
    expect(text).toContain("or OpenRouter, which passes the request to the company that runs the chosen model");
    expect(text).toContain("EU–US Data Privacy Framework");
    expect(text).toContain("Standard Contractual Clauses");
    expect(text).toContain("lodge a complaint with a data protection supervisory authority");
  });

  test("privacy covers notifications, feedback and focus sessions, in collection, export and deletion", async () => {
    const { container } = render(await PrivacyPage());
    const text = textOf(container);
    for (const category of ["Notifications", "Feedback", "Focus sessions"]) {
      expect(screen.getByText(category, { selector: "strong" })).toBeInTheDocument();
    }
    expect(text).toContain("the push service run by your browser’s maker (Google, Mozilla, Apple or Microsoft");
    expect(text).toContain("encrypted so that only your device can read it");
    // "Download my data" and "Delete account" both list them.
    const download = text.slice(text.indexOf("Download my data"), text.indexOf("Delete account"));
    expect(download).toMatch(/focus sessions.*notification settings and devices.*the feedback you sent/);
    const erase = text.slice(text.indexOf("Delete account"));
    expect(erase).toMatch(/focus sessions.*notification settings, push subscriptions and reminder log, the feedback you sent/);
  });

  test("privacy names the controller once the legal notice is configured", async () => {
    const before = render(await PrivacyPage());
    expect(textOf(before.container)).not.toContain("The controller responsible for your data");
    before.unmount();

    configureOperator();
    const { container } = render(await PrivacyPage());
    expect(textOf(container)).toContain(
      "The controller responsible for your data is Example Learning GmbH, Musterstraße 1, 10115 Berlin, Germany",
    );
    expect(screen.getByRole("link", { name: "legal notice" })).toHaveAttribute("href", "/legal-notice");
  });

  test("the legal notice does not exist until a name and an address are set", async () => {
    await expect(LegalNoticePage()).rejects.toMatchObject({ digest: expect.stringMatching(/404/) });
    vi.stubEnv("STUDYOS_OPERATOR_NAME", "Example Learning GmbH");
    await expect(LegalNoticePage()).rejects.toMatchObject({ digest: expect.stringMatching(/404/) });

    // No footer link and no sitemap entry either.
    const { unmount } = render(await TermsPage());
    expect(screen.queryByRole("link", { name: "Legal notice" })).toBeNull();
    unmount();
    expect(sitemap().map((e) => e.url)).not.toContainEqual(expect.stringMatching(/\/legal-notice$/));
  });

  test("the configured legal notice shows the operator, contact and optional entries", async () => {
    configureOperator({
      STUDYOS_OPERATOR_EMAIL: "legal@example.com",
      STUDYOS_OPERATOR_PHONE: "+49 30 1234-567",
      STUDYOS_OPERATOR_REGISTER: "Amtsgericht Berlin-Charlottenburg, HRB 12345",
      STUDYOS_OPERATOR_VAT_ID: "DE123456789",
      STUDYOS_OPERATOR_RESPONSIBLE: "Erika Mustermann",
    });
    const { container } = render(await LegalNoticePage());
    const text = textOf(container);
    expect(screen.getByRole("heading", { level: 1, name: "Legal Notice" })).toBeInTheDocument();
    expect(text).toContain("Information pursuant to § 5 of the German Digital Services Act (DDG)");
    expect(text).toContain("Example Learning GmbH");
    for (const line of ["Musterstraße 1", "10115 Berlin", "Germany"]) expect(screen.getByText(line)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "legal@example.com" })).toHaveAttribute("href", "mailto:legal@example.com");
    expect(screen.getByRole("link", { name: "+49 30 1234-567" })).toHaveAttribute("href", "tel:+49301234567");
    expect(text).toContain("Amtsgericht Berlin-Charlottenburg, HRB 12345");
    expect(text).toContain("§ 27a of the German Value Added Tax Act (UStG): DE123456789");
    expect(text).toContain("§ 18(2) of the German Interstate Media Treaty (MStV): Erika Mustermann");
    expect(text).toContain(
      "We are neither obliged nor willing to take part in dispute resolution proceedings before a consumer arbitration board.",
    );
    // The ODR platform closed in July 2025: no link to it.
    expect(text).not.toMatch(/ec\.europa\.eu\/consumers\/odr|online dispute resolution platform/i);
    // A notice has no effective date.
    expect(text).not.toMatch(/Effective /);
    expect(screen.getByRole("link", { name: "Legal notice" })).toHaveAttribute("href", "/legal-notice");
  });

  test("a minimal legal notice falls back to the support address and leaves optional entries out", async () => {
    configureOperator({ STUDYOS_SUPPORT_EMAIL: "help@studyos.app" });
    const { container } = render(await LegalNoticePage());
    const text = textOf(container);
    expect(screen.getAllByRole("link", { name: "help@studyos.app" }).length).toBeGreaterThan(0);
    expect(text).not.toMatch(/Phone:|Register entry|VAT ID|Responsible for content/);
    expect(sitemap().map((e) => e.url)).toContainEqual(expect.stringMatching(/\/legal-notice$/));
  });

  test("the legal notice is linked from the legal pages' footer in the visitor's language", async () => {
    configureOperator();
    const de = getDictionary("de");
    mocks.getI18n.mockResolvedValue({ dict: de, locale: "de", t: fmt, dir: "ltr" });
    render(await TermsPage());
    expect(de.legal.notice).toBe("Impressum");
    expect(screen.getByRole("link", { name: "Impressum" })).toHaveAttribute("href", "/legal-notice");
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
