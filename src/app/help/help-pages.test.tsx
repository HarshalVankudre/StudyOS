import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ResolvingMetadata } from "next";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { fmt } from "@/lib/i18n/interpolate";
import { pluralizer } from "@/lib/i18n/plural";
import { HELP_SLUGS } from "@/lib/help/catalog";
import { TRIAL_CREDITS } from "@/lib/price-list";

const mocks = vi.hoisted(() => ({ getI18n: vi.fn(), auth: vi.fn() }));

vi.mock("@/lib/db", () => ({ prisma: {} }));
vi.mock("@/lib/i18n/server", () => ({ getI18n: mocks.getI18n }));
vi.mock("@clerk/nextjs/server", () => ({ auth: mocks.auth }));
vi.mock("@/lib/ai/plans", () => ({ modelForPlan: () => "claude-haiku-5-5" }));
vi.mock("@/components/LanguageSwitcher", () => ({ LanguageSwitcher: () => null }));
vi.mock("@/components/ThemeToggle", () => ({ ThemeToggle: () => null }));

import sitemap from "../sitemap";
import HelpArticlePage, { generateMetadata as articleMetadata } from "./[slug]/page";
import HelpPage, { generateMetadata as indexMetadata } from "./page";

const en = getDictionary("en");
const parent = Promise.resolve({ openGraph: null, twitter: null }) as unknown as ResolvingMetadata;
const article = (slug: string) => HelpArticlePage({ params: Promise.resolve({ slug }) });

function useLocale(locale: "en" | "de" | "ar") {
  mocks.getI18n.mockResolvedValue({
    dict: getDictionary(locale),
    locale,
    t: fmt,
    plural: pluralizer(locale),
    dir: locale === "ar" ? "rtl" : "ltr",
  });
}

beforeEach(() => {
  useLocale("en");
  mocks.auth.mockResolvedValue({ userId: null });
  for (const name of ["STRIPE_SECRET_KEY", "STRIPE_PRICE_PRO"]) vi.stubEnv(name, "");
});
afterEach(() => vi.unstubAllEnvs());

describe("the help centre index", () => {
  test("lists every article under its topic and links each to its own page", async () => {
    render(await HelpPage());
    expect(screen.getByRole("heading", { level: 1, name: en.help.title })).toBeInTheDocument();
    for (const slug of HELP_SLUGS) {
      const link = screen.getByRole("link", { name: new RegExp(en.help.articles[slug].title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")) });
      expect(link).toHaveAttribute("href", `/help/${slug}`);
    }
    for (const topic of Object.values(en.help.topics)) {
      expect(screen.getByRole("heading", { name: topic })).toBeInTheDocument();
    }
  });

  test("the search box narrows the list, and says so when nothing matches", async () => {
    const user = userEvent.setup();
    render(await HelpPage());
    const box = screen.getByRole("searchbox", { name: en.help.searchLabel });

    await user.type(box, "streak freeze");
    expect(await screen.findByRole("link", { name: new RegExp(en.help.articles.flashcards.title) })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: new RegExp(en.help.articles.grades.title) })).not.toBeInTheDocument();

    await user.clear(box);
    await user.type(box, "zzzqqq");
    expect(await screen.findByRole("heading", { name: fmt(en.help.noResultsTitle, { query: "zzzqqq" }) })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: en.help.showAll }));
    expect(await screen.findByRole("link", { name: new RegExp(en.help.articles.grades.title) })).toBeInTheDocument();
  });

  test("offers sign-up to a visitor and the app to a signed-in student", async () => {
    const { unmount } = render(await HelpPage());
    expect(screen.getByRole("link", { name: en.landing.nav.getStarted })).toHaveAttribute("href", "/sign-up");
    unmount();

    mocks.auth.mockResolvedValue({ userId: "user_1" });
    render(await HelpPage());
    expect(screen.getByRole("link", { name: en.common.openApp })).toHaveAttribute("href", "/app");
    expect(screen.queryByRole("link", { name: en.landing.nav.getStarted })).not.toBeInTheDocument();
  });

  test("has its own title, description and canonical address", async () => {
    const meta = await indexMetadata({}, parent);
    expect(meta.title).toBe(en.help.metaTitle);
    expect(meta.description).toBe(en.help.metaDescription);
    expect(meta.alternates?.canonical).toBe("/help");
  });
});

describe("a help article", () => {
  test.each(HELP_SLUGS)("%s renders with its numbers filled in", async (slug) => {
    const { container } = render(await article(slug));
    expect(screen.getByRole("heading", { level: 1, name: en.help.articles[slug].title })).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/\{\w+\}/);
    expect(screen.getByRole("link", { name: new RegExp(en.help.home) })).toHaveAttribute("href", "/help");
  });

  test("states the product's real numbers", async () => {
    const { container } = render(await article("plans-and-credits"));
    expect(container.textContent).toContain(`New accounts get ${TRIAL_CREDITS} credits once`);
    // Billing is off here: Pro and packs are announced, not sold.
    expect(screen.getByRole("note")).toHaveTextContent(en.spend.purchasesComingSoon);
  });

  test("shows its steps in order and links its related articles", async () => {
    const { container } = render(await article("getting-started"));
    const steps = within(container.querySelector("ol")!).getAllByRole("listitem");
    expect(steps).toHaveLength(en.help.articles["getting-started"].steps.length);
    expect(steps[0]).toHaveTextContent(/^1/);
    const related = screen.getByRole("heading", { name: en.help.relatedTitle }).closest("section")!;
    expect(within(related).getAllByRole("link").map((a) => a.getAttribute("href"))).toEqual([
      "/help/plans-and-credits",
      "/help/import-deadlines",
      "/help/notion-anki-quizlet",
    ]);
  });

  test("an unknown slug is a 404", async () => {
    await expect(article("no-such-article")).rejects.toThrow(/NEXT_HTTP_ERROR_FALLBACK;404|NEXT_NOT_FOUND/);
  });

  test("is written in the visitor's language", async () => {
    useLocale("de");
    const de = getDictionary("de");
    render(await article("flashcards"));
    expect(screen.getByRole("heading", { level: 1, name: de.help.articles.flashcards.title })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: de.help.relatedTitle })).toBeInTheDocument();
  });

  test("has its own title, description and canonical address", async () => {
    const meta = await articleMetadata({ params: Promise.resolve({ slug: "grades" }) }, parent);
    expect(meta.title).toBe(fmt(en.help.articleTitle, { title: en.help.articles.grades.title }));
    expect(meta.alternates?.canonical).toBe("/help/grades");
    expect(String(meta.description)).not.toMatch(/\{\w+\}/);
  });
});

describe("the sitemap", () => {
  test("lists the help centre and every article", () => {
    vi.stubEnv("APP_URL", "https://studyos.example");
    const urls = sitemap().map((entry) => entry.url);
    expect(urls).toContain("https://studyos.example/help");
    for (const slug of HELP_SLUGS) expect(urls).toContain(`https://studyos.example/help/${slug}`);
    expect(new Set(urls).size).toBe(urls.length);
  });
});
