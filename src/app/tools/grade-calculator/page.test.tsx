import { render, screen, within } from "@testing-library/react";
import type { ResolvingMetadata } from "next";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { I18nProvider } from "@/lib/i18n/client";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { fmt } from "@/lib/i18n/interpolate";
import { pluralizer } from "@/lib/i18n/plural";
import { GRADE_CALCULATOR_PATH } from "@/lib/tools/catalog";

const mocks = vi.hoisted(() => ({ getI18n: vi.fn(), auth: vi.fn() }));

vi.mock("@/lib/db", () => ({ prisma: {} }));
vi.mock("@/lib/i18n/server", () => ({ getI18n: mocks.getI18n }));
vi.mock("@clerk/nextjs/server", () => ({ auth: mocks.auth }));
vi.mock("@/lib/ai/plans", () => ({ modelForPlan: () => "claude-haiku-5-5" }));
vi.mock("@/components/LanguageSwitcher", () => ({ LanguageSwitcher: () => null }));
vi.mock("@/components/ThemeToggle", () => ({ ThemeToggle: () => null }));

import sitemap from "../../sitemap";
import GradeCalculatorPage, { generateMetadata } from "./page";

const en = getDictionary("en");
const T = en.tools.gradeCalculator;
const parent = Promise.resolve({ openGraph: null, twitter: null }) as unknown as ResolvingMetadata;

function setLocale(locale: "en" | "de" | "ar") {
  mocks.getI18n.mockResolvedValue({
    dict: getDictionary(locale),
    locale,
    t: fmt,
    plural: pluralizer(locale),
    dir: locale === "ar" ? "rtl" : "ltr",
  });
}

/** The page as the browser gets it: the root layout provides the language to client components. */
async function renderPage(locale: "en" | "de" | "ar" = "en") {
  setLocale(locale);
  const page = await GradeCalculatorPage();
  return render(
    <I18nProvider locale={locale} dictionary={getDictionary(locale)}>
      {page}
    </I18nProvider>,
  );
}

beforeEach(() => {
  mocks.auth.mockResolvedValue({ userId: null });
  window.history.replaceState(null, "", GRADE_CALCULATOR_PATH);
});

describe("the grade calculator page", () => {
  test("has its heading, the calculator and the questions, in plain text", async () => {
    await renderPage();
    expect(screen.getByRole("heading", { level: 1, name: T.title })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: T.workTitle })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: T.resultTitle })).toBeInTheDocument();
    for (const item of T.faq) {
      expect(screen.getByRole("heading", { level: 3, name: item.question })).toBeInTheDocument();
      expect(screen.getByText(item.answer)).toBeInTheDocument();
    }
  });

  test("has its own title, description and canonical address", async () => {
    setLocale("en");
    const meta = await generateMetadata({}, parent);
    expect(meta.title).toBe(T.metaTitle);
    expect(meta.description).toBe(T.metaDescription);
    expect(meta.alternates?.canonical).toBe(GRADE_CALCULATOR_PATH);
    expect(meta.openGraph).toMatchObject({ url: GRADE_CALCULATOR_PATH, title: T.metaTitle });
  });

  test("invites a visitor to sign up, and sends a signed-in student to their grades", async () => {
    const { unmount } = await renderPage();
    expect(screen.getByRole("link", { name: new RegExp(T.ctaSignedOut) })).toHaveAttribute("href", "/sign-up");
    expect(screen.queryByRole("link", { name: new RegExp(T.ctaSignedIn) })).not.toBeInTheDocument();
    unmount();

    mocks.auth.mockResolvedValue({ userId: "user_1" });
    await renderPage();
    expect(screen.getByRole("link", { name: new RegExp(T.ctaSignedIn) })).toHaveAttribute("href", "/app/grades");
    expect(screen.queryByRole("link", { name: new RegExp(T.ctaSignedOut) })).not.toBeInTheDocument();
  });

  test("describes itself to search engines as a free web app with an FAQ", async () => {
    vi.stubEnv("APP_URL", "https://studyos.example");
    const { container } = await renderPage();
    const data = JSON.parse(container.querySelector('script[type="application/ld+json"]')!.textContent!) as Record<string, unknown>[];
    const app = data.find((d) => d["@type"] === "WebApplication")!;
    expect(app).toMatchObject({
      name: T.footerLink,
      url: `https://studyos.example${GRADE_CALCULATOR_PATH}`,
      isAccessibleForFree: true,
      offers: { "@type": "Offer", price: "0" },
    });
    const faq = data.find((d) => d["@type"] === "FAQPage")!;
    expect(faq.mainEntity).toEqual(
      T.faq.map((item) => ({ "@type": "Question", name: item.question, acceptedAnswer: { "@type": "Answer", text: item.answer } })),
    );
    vi.unstubAllEnvs();
  });

  test("is written for German students' searches in German", async () => {
    setLocale("de");
    const D = getDictionary("de").tools.gradeCalculator;
    const meta = await generateMetadata({}, parent);
    expect(meta.title).toBe(D.metaTitle);
    expect(String(meta.title)).toMatch(/Notenschnitt/);
    expect(String(meta.description)).toMatch(/ECTS/);
    expect(D.faq.map((f) => f.question).join(" ")).toMatch(/Notenschnitt/);
  });

  test("is linked from the footer of the public pages", async () => {
    await renderPage();
    const footer = screen.getByRole("contentinfo");
    expect(within(footer).getByRole("link", { name: T.footerLink })).toHaveAttribute("href", GRADE_CALCULATOR_PATH);
  });

  test("is written in the visitor's language, right to left included", async () => {
    const de = getDictionary("de").tools.gradeCalculator;
    const { unmount } = await renderPage("de");
    expect(screen.getByRole("heading", { level: 1, name: de.title })).toBeInTheDocument();
    // German students average their module grades by credits first.
    expect(screen.getByRole("heading", { level: 2, name: de.ects.workTitle })).toBeInTheDocument();
    unmount();

    const ar = getDictionary("ar").tools.gradeCalculator;
    const { container } = await renderPage("ar");
    expect(screen.getByRole("heading", { level: 1, name: ar.title })).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/\{\w+\}/);
  });
});

describe("the sitemap", () => {
  test("lists the grade calculator once", () => {
    vi.stubEnv("APP_URL", "https://studyos.example");
    const urls = sitemap().map((entry) => entry.url);
    expect(urls.filter((u) => u === `https://studyos.example${GRADE_CALCULATOR_PATH}`)).toHaveLength(1);
    expect(new Set(urls).size).toBe(urls.length);
    vi.unstubAllEnvs();
  });
});
