/**
 * First-visit language detection from the visitor's COUNTRY.
 *
 * The country is resolved SERVER-SIDE from the geo headers our hosting platform
 * injects based on the request IP (Vercel's `x-vercel-ip-country`, Cloudflare's
 * `cf-ipcountry`, etc.). That means there is NO browser geolocation prompt — the
 * lookup is invisible and instant. The country is only a fallback: the
 * student's own choice (the language cookie) comes first, then the languages
 * their browser asks for (`Accept-Language`), and only when neither names a
 * supported language is the country used, then English (see ./server.ts). A
 * browser set to English in Germany therefore gets English.
 *
 * Pure module (no server-only imports): `countryFromHeaders` takes a plain
 * `Headers` object so it can be unit-tested and reused anywhere.
 */
import { isLocale, type Locale } from "./config";

/**
 * Request headers (in priority order) that carry the visitor's ISO 3166-1
 * alpha-2 country code, set by the CDN/hosting platform from the client IP.
 */
const GEO_COUNTRY_HEADERS = [
  "x-vercel-ip-country", // Vercel
  "cf-ipcountry", // Cloudflare
  "x-country", // generic / Netlify-style proxies
  "x-geo-country",
  "x-appengine-country", // Google App Engine
];

/**
 * ISO 3166-1 alpha-2 country code → default locale.
 *
 * Only countries with a clear dominant language among our supported set are
 * listed. Multilingual countries (CH, BE, CA, …) and everything unlisted
 * resolve to no language here, which leaves English — so we never guess wrong
 * for, say, a French speaker in bilingual Belgium whose browser did not say.
 */
const COUNTRY_TO_LOCALE: Record<string, Locale> = {
  // ---- German ----
  DE: "de",
  AT: "de",
  LI: "de",

  // ---- Spanish ----
  ES: "es",
  MX: "es",
  AR: "es",
  CO: "es",
  CL: "es",
  PE: "es",
  VE: "es",
  EC: "es",
  GT: "es",
  CU: "es",
  BO: "es",
  DO: "es",
  HN: "es",
  PY: "es",
  SV: "es",
  NI: "es",
  CR: "es",
  PA: "es",
  UY: "es",
  PR: "es",
  GQ: "es",

  // ---- French ----
  FR: "fr",
  MC: "fr",
  LU: "fr",
  CI: "fr",
  SN: "fr",
  ML: "fr",
  CM: "fr",
  CD: "fr",
  CG: "fr",
  GA: "fr",
  BJ: "fr",
  BF: "fr",
  NE: "fr",
  TG: "fr",
  MG: "fr",

  // ---- Italian ----
  IT: "it",
  SM: "it",
  VA: "it",

  // ---- Portuguese ----
  PT: "pt",
  BR: "pt",
  AO: "pt",
  MZ: "pt",
  CV: "pt",

  // ---- Dutch ----
  NL: "nl",

  // ---- Chinese (Simplified) ----
  CN: "zh",
  SG: "zh",

  // ---- Japanese ----
  JP: "ja",

  // ---- Arabic ----
  SA: "ar",
  AE: "ar",
  EG: "ar",
  DZ: "ar",
  IQ: "ar",
  MA: "ar",
  SD: "ar",
  YE: "ar",
  SY: "ar",
  TN: "ar",
  JO: "ar",
  LY: "ar",
  LB: "ar",
  PS: "ar",
  OM: "ar",
  KW: "ar",
  MR: "ar",
  QA: "ar",
  BH: "ar",
  DJ: "ar",
  KM: "ar",
};

/** Read the visitor's country code from the platform geo headers, if present. */
export function countryFromHeaders(headerList: Headers): string | null {
  for (const name of GEO_COUNTRY_HEADERS) {
    const value = headerList.get(name);
    if (value && value.trim()) return value.trim();
  }
  return null;
}

/** Map an ISO country code to a supported locale, or null if unsupported. */
export function localeFromCountry(
  country: string | null | undefined,
): Locale | null {
  if (!country) return null;
  const locale = COUNTRY_TO_LOCALE[country.trim().toUpperCase()];
  return locale && isLocale(locale) ? locale : null;
}
