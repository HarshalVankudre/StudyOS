import { describe, expect, it } from "vitest";
import { plural, pluralCategory, type PluralForms } from "./plural";
import { getDictionary } from "./dictionaries";
import { LOCALES, type Locale } from "./config";

const cards: PluralForms = { one: "{count} card", other: "{count} cards" };

describe("plural", () => {
  it("picks one / other in English and formats the number", () => {
    expect(plural("en", cards, 1)).toBe("1 card");
    expect(plural("en", cards, 0)).toBe("0 cards");
    expect(plural("en", cards, 2)).toBe("2 cards");
    expect(plural("en", cards, 1234)).toBe("1,234 cards");
  });

  it("fills extra placeholders", () => {
    expect(plural("en", { one: "{count} row in {table}", other: "{count} rows in {table}" }, 3, { table: "Tasks" })).toBe(
      "3 rows in Tasks",
    );
  });

  it("uses all six Arabic categories", () => {
    expect([0, 1, 2, 3, 11, 100].map((n) => pluralCategory("ar", n))).toEqual([
      "zero",
      "one",
      "two",
      "few",
      "many",
      "other",
    ]);
    const forms = getDictionary("ar").counts.cards;
    expect(plural("ar", forms, 1)).toBe("بطاقة واحدة");
    expect(plural("ar", forms, 2)).toBe("بطاقتان");
    expect(plural("ar", forms, 0)).toBe("لا بطاقات");
  });

  it("falls back to `other` for a category a language leaves out", () => {
    expect(pluralCategory("ja", 1)).toBe("other");
    expect(plural("ja", getDictionary("ja").counts.cards, 1)).toBe("カード 1 枚");
    expect(plural("fr", { other: "{count} x" }, 1)).toBe("1 x");
  });

  it("treats French 0 as singular", () => {
    expect(plural("fr", getDictionary("fr").counts.cards, 0)).toBe("0 carte");
  });

  it("never throws on bad input", () => {
    expect(plural("en", cards, Number.NaN)).toBe("0 cards");
    expect(plural("not a locale!!", cards, 1)).toBe("1 card");
  });

  it("every language gives every count a non-empty `other` form with {count}", () => {
    for (const { code } of LOCALES) {
      const counts = getDictionary(code as Locale).counts;
      for (const [key, forms] of Object.entries(counts)) {
        expect(forms.other, `${code}.counts.${key}`).toMatch(/\{count\}/);
      }
    }
  });
});
