/**
 * StudyOS internationalization — locale configuration.
 *
 * This module is intentionally PURE (no server-only imports, no React) so it can
 * be imported anywhere: server components, client components, server actions,
 * and the AI layer. The only place locale is *resolved* (from the cookie /
 * Accept-Language header) is `./server.ts`.
 *
 * Adding a language is a three-step job:
 *   1. add an entry to `LOCALES` here,
 *   2. add `dictionaries/<code>.ts` (copy en.ts and translate),
 *   3. register it in `dictionaries/index.ts` and `clerk.ts`.
 * Everything else (switcher, html lang/dir, AI prompts) picks it up automatically.
 */

export interface LocaleMeta {
  /** BCP-47-ish short code used in the cookie and `<html lang>`. */
  code: string;
  /** Language name in English — used in AI prompts ("Write in German."). */
  englishName: string;
  /** Language name in its own script — shown in the switcher. */
  nativeName: string;
  /** Flag emoji for the switcher. */
  flag: string;
  /** Text direction. Arabic is the only right-to-left locale here. */
  dir: "ltr" | "rtl";
}

/**
 * Supported languages, in the order shown in the switcher.
 * English first (the default/source language), then the rest.
 */
export const LOCALES = [
  { code: "en", englishName: "English", nativeName: "English", flag: "🇬🇧", dir: "ltr" },
  { code: "es", englishName: "Spanish", nativeName: "Español", flag: "🇪🇸", dir: "ltr" },
  { code: "de", englishName: "German", nativeName: "Deutsch", flag: "🇩🇪", dir: "ltr" },
  { code: "fr", englishName: "French", nativeName: "Français", flag: "🇫🇷", dir: "ltr" },
  { code: "it", englishName: "Italian", nativeName: "Italiano", flag: "🇮🇹", dir: "ltr" },
  { code: "pt", englishName: "Portuguese", nativeName: "Português", flag: "🇧🇷", dir: "ltr" },
  { code: "nl", englishName: "Dutch", nativeName: "Nederlands", flag: "🇳🇱", dir: "ltr" },
  { code: "zh", englishName: "Chinese (Simplified)", nativeName: "中文", flag: "🇨🇳", dir: "ltr" },
  { code: "ja", englishName: "Japanese", nativeName: "日本語", flag: "🇯🇵", dir: "ltr" },
  { code: "ar", englishName: "Arabic", nativeName: "العربية", flag: "🇸🇦", dir: "rtl" },
] as const satisfies readonly LocaleMeta[];

/** A supported locale code, e.g. `"en" | "es" | ... | "ar"`. */
export type Locale = (typeof LOCALES)[number]["code"];

/** The source language. Used as the fallback whenever resolution fails. */
export const DEFAULT_LOCALE: Locale = "en";

/** Name of the cookie that stores the chosen locale. */
export const LOCALE_COOKIE = "studyos_locale";

/** A year, in seconds — how long the locale cookie persists. */
export const LOCALE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

const BY_CODE: Record<string, LocaleMeta> = Object.fromEntries(
  LOCALES.map((l) => [l.code, l]),
);

/** Type guard: is this arbitrary string one of our supported locales? */
export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && value in BY_CODE;
}

/** Full metadata for a locale (always defined for a valid `Locale`). */
export function localeMeta(locale: Locale): LocaleMeta {
  return BY_CODE[locale] ?? BY_CODE[DEFAULT_LOCALE];
}

/** Text direction for a locale — drives `<html dir>`. */
export function dirFor(locale: Locale): "ltr" | "rtl" {
  return localeMeta(locale).dir;
}

/** English name of the language, for AI prompts. */
export function englishName(locale: Locale): string {
  return localeMeta(locale).englishName;
}

/**
 * Best-effort match of an `Accept-Language` header to a supported locale.
 * Looks at each ranked language tag and matches on the primary subtag, so
 * `pt-BR` → `pt`, `zh-Hans-CN` → `zh`, etc. Returns null when nothing matches.
 */
export function matchAcceptLanguage(header: string | null | undefined): Locale | null {
  if (!header) return null;
  const tags = header
    .split(",")
    .map((part) => {
      const [tag, q] = part.trim().split(";q=");
      return { tag: tag.toLowerCase(), q: q ? Number(q) : 1 };
    })
    .filter((t) => t.tag)
    .sort((a, b) => b.q - a.q);

  for (const { tag } of tags) {
    if (isLocale(tag)) return tag;
    const primary = tag.split("-")[0];
    if (isLocale(primary)) return primary;
  }
  return null;
}
