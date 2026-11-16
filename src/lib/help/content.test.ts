import { describe, expect, test, vi } from "vitest";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { LOCALES } from "@/lib/i18n/config";
import { fmt } from "@/lib/i18n/interpolate";
import { pluralizer } from "@/lib/i18n/plural";
import { HELP_ARTICLES, HELP_SLUGS, HELP_TOPICS, helpPath, isHelpSlug } from "./catalog";
import { helpArticles, helpSearchText, helpValues, type HelpI18n } from "./content";

vi.mock("@/lib/ai/plans", () => ({ modelForPlan: () => "claude-haiku-5-5" }));

const CODES = LOCALES.map((l) => l.code);

function i18n(locale: (typeof CODES)[number]): HelpI18n {
  return { dict: getDictionary(locale), locale, t: fmt, plural: pluralizer(locale) };
}

const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]);

/** Every string of one article's copy, as written in a dictionary. */
function copyStrings(copy: { title: string; summary: string; intro: string; steps: string[]; sections: { heading: string; text: string }[] }) {
  return [copy.title, copy.summary, copy.intro, ...copy.steps, ...copy.sections.flatMap((s) => [s.heading, s.text])];
}

describe("the help catalog", () => {
  test("every slug is unique and addressable", () => {
    expect(new Set(HELP_SLUGS).size).toBe(HELP_SLUGS.length);
    for (const slug of HELP_SLUGS) {
      expect(slug).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
      expect(isHelpSlug(slug)).toBe(true);
      expect(helpPath(slug)).toBe(`/help/${slug}`);
    }
    expect(isHelpSlug("nope")).toBe(false);
    expect(helpPath()).toBe("/help");
  });

  test("related articles exist and never point at the article itself", () => {
    for (const { slug, related } of HELP_ARTICLES) {
      expect(related.length).toBeGreaterThan(0);
      for (const other of related) {
        expect(isHelpSlug(other)).toBe(true);
        expect(other).not.toBe(slug);
      }
    }
  });

  test("every topic has at least one article", () => {
    for (const topic of HELP_TOPICS) {
      expect(HELP_ARTICLES.some((a) => a.topic === topic)).toBe(true);
    }
  });
});

describe.each(CODES)("help articles in %s", (locale) => {
  const en = getDictionary("en").help.articles;
  const copy = getDictionary(locale).help.articles;
  const articles = helpArticles(i18n(locale), { billing: true });

  test("has copy for every article, shaped like the English one", () => {
    expect(Object.keys(copy).sort()).toEqual([...HELP_SLUGS].sort());
    for (const slug of HELP_SLUGS) {
      expect(copy[slug].steps.length, `${slug} steps`).toBe(en[slug].steps.length);
      expect(copy[slug].sections.length, `${slug} sections`).toBe(en[slug].sections.length);
      for (const text of copyStrings(copy[slug])) expect(text.trim().length, slug).toBeGreaterThan(0);
    }
  });

  test("uses only placeholders the product fills, and never writes their numbers in", () => {
    const known = new Set(Object.keys(helpValues(i18n(locale))));
    for (const slug of HELP_SLUGS) {
      const local = copyStrings(copy[slug]);
      const english = copyStrings(en[slug]);
      for (const name of local.flatMap(placeholders)) expect(known.has(name), `{${name}} in ${slug}`).toBe(true);
      // The same facts as English: a translation that drops a placeholder has
      // either lost the fact or typed the number in.
      expect(new Set(local.flatMap(placeholders)), slug).toEqual(new Set(english.flatMap(placeholders)));
    }
  });

  test("renders with every placeholder filled", () => {
    expect(articles.map((a) => a.slug)).toEqual([...HELP_SLUGS]);
    for (const article of articles) {
      expect(helpSearchText(article), article.slug).not.toMatch(/\{\w+\}/);
      expect(article.note).toBeNull();
    }
  });

  test("says purchases are not on sale yet while billing is off", () => {
    const off = helpArticles(i18n(locale), { billing: false });
    const noted = off.filter((a) => a.note);
    expect(noted.map((a) => a.slug)).toEqual(["plans-and-credits"]);
    expect(noted[0].note).toBe(getDictionary(locale).spend.purchasesComingSoon);
  });

  test("has the index's own strings", () => {
    const H = getDictionary(locale).help;
    for (const topic of HELP_TOPICS) expect(H.topics[topic].trim()).not.toBe("");
    expect(placeholders(H.articleTitle)).toEqual(["title"]);
    expect(placeholders(H.stuckBody)).toEqual(["email"]);
    expect(new Set(placeholders(H.resultCount))).toEqual(new Set(["query", "count"]));
    expect(placeholders(H.noResultsTitle)).toEqual(["query"]);
    expect(new Set(placeholders(H.costRange))).toEqual(new Set(["price", "max"]));
  });
});
