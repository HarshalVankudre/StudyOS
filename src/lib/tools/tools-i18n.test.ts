import { describe, expect, test } from "vitest";
import { LOCALES } from "@/lib/i18n/config";
import { getDictionary } from "@/lib/i18n/dictionaries";

const CODES = LOCALES.map((l) => l.code);
const placeholders = (text: string) => new Set([...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]));

/** Every string of a namespace by dotted path ("gradeCalculator.faq.0.answer"). */
function strings(node: unknown, path = "", out = new Map<string, string>()): Map<string, string> {
  if (typeof node === "string") out.set(path, node);
  else if (node && typeof node === "object") {
    for (const [key, value] of Object.entries(node)) strings(value, path ? `${path}.${key}` : key, out);
  }
  return out;
}

const english = strings(getDictionary("en").tools);

describe.each(CODES)("the tools namespace in %s", (locale) => {
  const local = strings(getDictionary(locale).tools);

  test("has every string English has, and no others (lists the same length)", () => {
    expect([...local.keys()].sort()).toEqual([...english.keys()].sort());
  });

  test("every string is written and keeps English's placeholders", () => {
    for (const [path, text] of local) {
      expect(text.trim().length, path).toBeGreaterThan(0);
      expect(text, path).toBe(text.trim());
      expect(placeholders(text), path).toEqual(placeholders(english.get(path) ?? ""));
    }
  });

  test.skipIf(locale === "en")("is translated, not copied from English", () => {
    const T = getDictionary(locale).tools.gradeCalculator;
    const E = getDictionary("en").tools.gradeCalculator;
    for (const key of ["title", "subtitle", "metaDescription", "workTitle", "resultTitle", "ctaTitle", "faqTitle"] as const) {
      expect(T[key], key).not.toBe(E[key]);
    }
    T.faq.forEach((item, i) => expect(item.answer, `faq ${i}`).not.toBe(E.faq[i].answer));
  });

  test("names the questions it answers in the FAQ, each once", () => {
    const { faq } = getDictionary(locale).tools.gradeCalculator;
    expect(new Set(faq.map((f) => f.question)).size).toBe(faq.length);
  });
});
