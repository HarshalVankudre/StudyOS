/**
 * Server-side locale resolution.
 *
 * Order of precedence:
 *   1. the `studyos_locale` cookie (the user's explicit choice), then
 *   2. the `Accept-Language` request header (their browser preference), then
 *   3. the default locale (English).
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
import { fmt } from "./interpolate";

/** Resolve the active locale for the current request. */
export async function getLocale(): Promise<Locale> {
  const cookieStore = await cookies();
  const fromCookie = cookieStore.get(LOCALE_COOKIE)?.value;
  if (isLocale(fromCookie)) return fromCookie;

  const headerList = await headers();
  const fromHeader = matchAcceptLanguage(headerList.get("accept-language"));
  if (fromHeader) return fromHeader;

  return DEFAULT_LOCALE;
}

export interface ServerI18n {
  locale: Locale;
  dir: "ltr" | "rtl";
  dict: Dictionary;
  t: (template: string, vars?: Record<string, string | number>) => string;
}

/**
 * The active locale + its dictionary for use in Server Components, server
 * actions, and metadata. The client equivalent is `useI18n()` (./client).
 */
export async function getI18n(): Promise<ServerI18n> {
  const locale = await getLocale();
  return { locale, dir: dirFor(locale), dict: getDictionary(locale), t: fmt };
}
