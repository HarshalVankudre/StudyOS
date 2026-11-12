/**
 * Server-side locale resolution.
 *
 * Order of precedence:
 *   1. the `studyos_locale` cookie (the user's explicit choice), then
 *   2. the `Accept-Language` request header (their browser preference), then
 *   3. the visitor's country (geo-IP headers from the hosting platform), then
 *   4. the default locale (English).
 *
 * A browser set to English in Germany gets English: what the person chose
 * for their browser says more about them than where they are.
 *
 * Reading cookies/headers opts the route into dynamic rendering — which every
 * StudyOS route already is (they all read Clerk auth), so there's no extra cost.
 */
import { cookies, headers } from "next/headers";
import {
  DEFAULT_LOCALE,
  LOCALE_COOKIE,
  isLocale,
  dirFor,
  matchAcceptLanguage,
  type Locale,
} from "./config";
import { getDictionary, type Dictionary } from "./dictionaries";
import { countryFromHeaders, localeFromCountry } from "./geo";
import { fmt } from "./interpolate";
import { pluralizer, type PluralForms } from "./plural";

/** Resolve the active locale for the current request. */
export async function getLocale(): Promise<Locale> {
  // 1. The user's explicit choice (set by the language switcher) always wins.
  const cookieStore = await cookies();
  const fromCookie = cookieStore.get(LOCALE_COOKIE)?.value;
  if (isLocale(fromCookie)) return fromCookie;

  const headerList = await headers();

  // 2. The browser's language preference.
  const fromHeader = matchAcceptLanguage(headerList.get("accept-language"));
  if (fromHeader) return fromHeader;

  // 3. The visitor's country, resolved server-side from the IP by the hosting
  //    platform's geo headers (no browser geolocation prompt). Only reached
  //    when the browser states no language we support. `STUDYOS_GEO_COUNTRY`
  //    forces a country for local testing.
  const country =
    process.env.STUDYOS_GEO_COUNTRY ?? countryFromHeaders(headerList);
  const fromCountry = localeFromCountry(country);
  if (fromCountry) return fromCountry;

  // 4. Default to English.
  return DEFAULT_LOCALE;
}

export interface ServerI18n {
  locale: Locale;
  dir: "ltr" | "rtl";
  dict: Dictionary;
  t: (template: string, vars?: Record<string, string | number>) => string;
  /** A count string in the right plural form (see ./plural). */
  plural: (forms: PluralForms, count: number, vars?: Record<string, string | number>) => string;
}

/**
 * The active locale + its dictionary for use in Server Components, server
 * actions, and metadata. The client equivalent is `useI18n()` (./client).
 */
export async function getI18n(): Promise<ServerI18n> {
  const locale = await getLocale();
  return {
    locale,
    dir: dirFor(locale),
    dict: getDictionary(locale),
    t: fmt,
    plural: pluralizer(locale),
  };
}
