/**
 * Regional conventions for the active language.
 *
 * The interface language is a bare code ("en", "de", "ar"). Week start and
 * date order also depend on the region: English in the UK starts weeks on
 * Monday and writes 17/11/2026, English in the US starts on Sunday and writes
 * 11/17/2026. When the browser tells us the student's region, these helpers
 * use it, still in the interface language.
 *
 * Browser-only input: on the server (or before hydration) `navigator` is
 * missing and the bare language is used, so call the browser-dependent forms
 * only in client-side effects or client-only rendering to avoid hydration
 * mismatches.
 */

/** The browser's preferred language tags, most preferred first ([] on the server). */
export function browserLanguages(): readonly string[] {
  if (typeof navigator === "undefined") return [];
  if (navigator.languages?.length) return navigator.languages;
  return navigator.language ? [navigator.language] : [];
}

function canonical(tag: string): string | null {
  try {
    return new Intl.Locale(tag).toString();
  } catch {
    return null;
  }
}

function regionOf(tag: string): string | undefined {
  try {
    return new Intl.Locale(tag).region;
  } catch {
    return undefined;
  }
}

/**
 * The interface language with the student's region, e.g. "en" + browser
 * ["en-GB"] -> "en-GB", "en" + ["de-DE"] -> "en-DE". Falls back to `language`.
 */
export function regionalLocale(language: string, preferred: readonly string[] = browserLanguages()): string {
  const base = language.split("-")[0].toLowerCase();
  if (regionOf(language)) return language;
  const same = preferred.find((tag) => tag.split("-")[0].toLowerCase() === base && regionOf(tag));
  if (same) return canonical(same) ?? language;
  const region = preferred.map(regionOf).find(Boolean);
  return (region && canonical(`${base}-${region}`)) || language;
}

// Regions whose week starts on Sunday or Saturday (CLDR), for engines without
// Intl.Locale week info. Everything else starts on Monday.
const SUNDAY = new Set(["US", "CA", "MX", "BR", "JP", "KR", "TW", "HK", "IL", "SA", "IN", "PH", "ZA", "PE", "CO", "VE", "GT", "PA", "DO", "PR", "TH", "ID"]);
const SATURDAY = new Set(["EG", "DZ", "IQ", "JO", "KW", "LY", "OM", "QA", "SY", "SD", "BH", "AE", "AF", "IR", "DJ"]);
// A bare language's most likely region, matching Intl.Locale#maximize().
const LIKELY_REGION: Record<string, string> = { en: "US", ja: "JP", pt: "BR", zh: "CN", ar: "EG" };

/**
 * First day of the week for the interface language in the student's region:
 * 0 Sunday, 1 Monday, 6 Saturday.
 */
export function weekStartFor(locale: string, preferred: readonly string[] = browserLanguages()): number {
  const tag = regionalLocale(locale, preferred);
  try {
    const loc = new Intl.Locale(tag) as Intl.Locale & {
      getWeekInfo?: () => { firstDay: number };
      weekInfo?: { firstDay: number };
    };
    const info = loc.getWeekInfo?.() ?? loc.weekInfo;
    if (info?.firstDay) return info.firstDay % 7;
  } catch {
    // Older engines: use the table below.
  }
  const region = regionOf(tag) ?? LIKELY_REGION[tag.split("-")[0].toLowerCase()];
  if (region && SUNDAY.has(region)) return 0;
  if (region && SATURDAY.has(region)) return 6;
  return 1;
}
