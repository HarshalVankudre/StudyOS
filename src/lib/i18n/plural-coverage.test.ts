/**
 * Every count string in every language, rendered at the counts students
 * actually see. A missing plural form, a leftover placeholder or an English
 * "1 credits" fails here instead of shipping.
 */
import { describe, expect, it } from "vitest";
import { getDictionary } from "./dictionaries";
import { LOCALES, type Locale } from "./config";
import { fmt } from "./interpolate";
import { plural, pluralCategory, type PluralCategory } from "./plural";
import { formatDuration } from "@/lib/agents/daily-study/present";

const CATEGORIES = new Set<string>(["zero", "one", "two", "few", "many", "other"]);
const SAMPLES = [0, 1, 2, 3, 11, 100];
const codes = LOCALES.map((l) => l.code as Locale);

type Forms = Partial<Record<PluralCategory, string>> & { other: string };

/** Every plural-forms object in a dictionary, by dotted path. */
function pluralEntries(node: unknown, path = "", out = new Map<string, Forms>()): Map<string, Forms> {
  if (!node || typeof node !== "object") return out;
  const record = node as Record<string, unknown>;
  const keys = Object.keys(record);
  if (
    keys.length > 0 &&
    "other" in record &&
    keys.every((k) => CATEGORIES.has(k) && typeof record[k] === "string")
  ) {
    out.set(path, record as Forms);
    return out;
  }
  for (const [key, value] of Object.entries(record)) pluralEntries(value, path ? `${path}.${key}` : key, out);
  return out;
}

const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]);

const english = pluralEntries(getDictionary("en"));

/** Strings whose English singular and plural read the same on purpose. */
const SAME_IN_ENGLISH = new Set(["counts.showMore", "counts.streak"]);
/** Strings whose singular and plural legitimately match in one language (an invariant abbreviation). */
const SAME_BY_DESIGN: Partial<Record<Locale, Set<string>>> = {
  de: new Set(["grades.creditWeighted"]), // "LP"
  // "à vérifier" / "da controllare" / "om na te kijken" have no number; Italian
  // loanwords ("flashcard", "workspace") do not inflect.
  fr: new Set(["feeds.buttonFlagged"]),
  it: new Set(["grades.creditWeighted", "feeds.buttonFlagged", "counts.flashcards", "safety.trashCount"]),
  nl: new Set(["grades.creditWeighted", "feeds.buttonFlagged"]), // "EC"
};
/** Arabic strings where 3–10 and 100+ legitimately read the same (definite or noun-free phrasing). */
const ARABIC_FEW_EQUALS_OTHER = new Set(["today.overloadTitle"]);

describe("plural coverage", () => {
  it("finds the converted count strings", () => {
    expect(english.size).toBeGreaterThan(40);
  });

  it("every language has every count string, as plural forms", () => {
    for (const code of codes) {
      const entries = pluralEntries(getDictionary(code));
      expect([...entries.keys()].sort(), code).toEqual([...english.keys()].sort());
    }
  });

  for (const code of codes) {
    it(`${code}: renders each count string at ${SAMPLES.join(", ")} with its own form`, () => {
      const entries = pluralEntries(getDictionary(code));
      for (const [path, forms] of entries) {
        const vars = Object.fromEntries(
          placeholders(english.get(path)!.other)
            .filter((p) => p !== "count")
            .map((p) => [p, `«${p}»`]),
        );
        const allowed = new Set(Object.values(english.get(path)!).flatMap(placeholders));
        for (const [category, template] of Object.entries(forms)) {
          for (const p of placeholders(template!)) {
            expect(allowed.has(p) || p === "count", `${code} ${path}.${category} uses unknown {${p}}`).toBe(true);
          }
        }
        expect(forms.other, `${code} ${path}.other`).toMatch(/\{count\}/);
        for (const n of SAMPLES) {
          const category = pluralCategory(code, n);
          expect(forms[category], `${code} ${path} has no "${category}" form (needed for ${n})`).toBeTruthy();
          const text = plural(code, forms, n, vars);
          expect(text, `${code} ${path} at ${n}`).not.toMatch(/\{\w+\}/);
          expect(text.trim().length, `${code} ${path} at ${n}`).toBeGreaterThan(0);
          // From 3 up a student must see the number itself.
          if (n >= 3) expect(text, `${code} ${path} at ${n}`).toContain(new Intl.NumberFormat(code).format(n));
        }
      }
    });
  }

  it("English singular and plural differ (no “1 credits”)", () => {
    for (const [path, forms] of english) {
      if (SAME_IN_ENGLISH.has(path)) continue;
      expect(forms.one, `en ${path}.one`).toBeTruthy();
      expect(forms.one, `en ${path}`).not.toBe(forms.other);
    }
  });

  it("other one/other languages distinguish singular wherever English does", () => {
    const same: string[] = [];
    for (const code of ["es", "de", "fr", "it", "pt", "nl"] as Locale[]) {
      for (const [path, forms] of pluralEntries(getDictionary(code))) {
        if (SAME_IN_ENGLISH.has(path) || SAME_BY_DESIGN[code]?.has(path)) continue;
        if (!forms.one || forms.one === forms.other) same.push(`${code} ${path}`);
      }
    }
    expect(same).toEqual([]);
  });

  it("Arabic gives each of its six categories its own wording where grammar needs it", () => {
    for (const [path, forms] of pluralEntries(getDictionary("ar"))) {
      for (const c of ["zero", "one", "two", "few", "many"] as const) {
        expect(forms[c], `ar ${path}.${c}`).toBeTruthy();
      }
      // One and two never take the 100+ wording ("1 رصيدًا", "2 أرصدة"). Zero
      // must be written out, but may share the 100+ wording ("0 بطاقة").
      for (const c of ["one", "two"] as const) {
        expect(forms[c], `ar ${path}.${c}`).not.toBe(forms.other);
      }
      expect(forms.one, `ar ${path}`).not.toBe(forms.two);
      // 3–10 take a plural noun, 100+ a singular one ("3 أيام" but "100 يوم").
      if (!ARABIC_FEW_EQUALS_OTHER.has(path)) expect(forms.few, `ar ${path}`).not.toBe(forms.other);
    }
  });

  it("Arabic counts read correctly at the numbers QA found wrong", () => {
    const ar = getDictionary("ar");
    expect(plural("ar", ar.today.examIn, 15)).toBe("بعد 15 يومًا");
    expect(plural("ar", ar.today.examIn, 3)).toBe("بعد 3 أيام");
    expect(plural("ar", ar.today.examIn, 100)).toBe("بعد 100 يوم");
    expect(plural("ar", ar.counts.credits, 1)).toBe("رصيد واحد");
    expect(plural("ar", ar.counts.credits, 2)).toBe("رصيدان");
    expect(plural("ar", ar.counts.credits, 11)).toBe("11 رصيدًا");
    expect(plural("ar", ar.materials.doneCost, 2)).toBe("التكلفة: رصيدان.");
    expect(plural("ar", ar.counts.flashcards, 4)).toBe("4 بطاقات تعليمية");
    expect(plural("ar", ar.counts.practiceQuestions, 3)).toBe("3 أسئلة تدريبية");
  });
});

describe("abbreviations before a full stop", () => {
  it("fmt never doubles a full stop after a value that ends in one", () => {
    expect(fmt("about {t}. Start early.", { t: "40 Min." })).toBe("about 40 Min. Start early.");
    expect(fmt("{t}.", { t: "2 h" })).toBe("2 h.");
    expect(fmt("{a}{b}", { a: "x.", b: ".y" })).toBe("x..y");
  });

  it("no language renders the Today overload body with a doubled full stop", () => {
    for (const code of codes) {
      const T = getDictionary(code).today;
      for (const minutes of [40, 60, 160]) {
        const time = formatDuration(minutes, T);
        const text = fmt(T.overloadBody, { needed: time, available: time });
        expect(text, `${code} ${minutes}`).not.toMatch(/[^.]\.\.(?!\.)/);
      }
    }
  });
});
