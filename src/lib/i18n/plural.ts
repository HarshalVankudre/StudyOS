/**
 * Plural-aware count strings.
 *
 * A dictionary entry for a count carries one string per plural category the
 * language needs (CLDR categories, as `Intl.PluralRules` reports them):
 *   English, German, …   one / other
 *   Arabic               zero / one / two / few / many / other
 *   Japanese, Chinese    other
 * `other` is always required and is the fallback for any category a language
 * leaves out. `{count}` is filled with the number formatted for the language;
 * any other `{placeholders}` come from `vars`.
 *
 *   plural("en", { one: "{count} card", other: "{count} cards" }, 1) // "1 card"
 */
import { fmt } from "./interpolate";

export type PluralCategory = "zero" | "one" | "two" | "few" | "many" | "other";

export type PluralForms = Partial<Record<Exclude<PluralCategory, "other">, string>> & {
  other: string;
};

const rulesCache = new Map<string, Intl.PluralRules>();
const numberCache = new Map<string, Intl.NumberFormat>();

function rulesFor(locale: string): Intl.PluralRules {
  let rules = rulesCache.get(locale);
  if (!rules) {
    try {
      rules = new Intl.PluralRules(locale);
    } catch {
      rules = new Intl.PluralRules("en");
    }
    rulesCache.set(locale, rules);
  }
  return rules;
}

function numberFor(locale: string): Intl.NumberFormat {
  let format = numberCache.get(locale);
  if (!format) {
    try {
      format = new Intl.NumberFormat(locale);
    } catch {
      format = new Intl.NumberFormat("en");
    }
    numberCache.set(locale, format);
  }
  return format;
}

/** The plural category `count` falls in for `locale`. */
export function pluralCategory(locale: string, count: number): PluralCategory {
  return rulesFor(locale).select(count) as PluralCategory;
}

/** Pick the form for `count` and fill `{count}` (locale-formatted) and `vars`. */
export function plural(
  locale: string,
  forms: PluralForms,
  count: number,
  vars?: Record<string, string | number>,
): string {
  const safe = Number.isFinite(count) ? count : 0;
  const template = forms[pluralCategory(locale, safe)] ?? forms.other;
  return fmt(template, { ...vars, count: numberFor(locale).format(safe) });
}

/** `plural` bound to one locale: what `useI18n().plural` and `getI18n().plural` are. */
export function pluralizer(
  locale: string,
): (forms: PluralForms, count: number, vars?: Record<string, string | number>) => string {
  return (forms, count, vars) => plural(locale, forms, count, vars);
}
