/**
 * Maps a StudyOS locale to the matching Clerk UI localization, so the hosted
 * <SignIn /> / <SignUp /> components and the <UserButton /> menu render in the
 * user's language too. Imported only by the root layout (server side); Clerk
 * serializes just the selected one to the client.
 */
import {
  enUS,
  esES,
  deDE,
  frFR,
  itIT,
  ptBR,
  nlNL,
  zhCN,
  jaJP,
  arSA,
} from "@clerk/localizations";
import type { Locale } from "./config";

// Derive the type from a real localization object so we don't depend on
// `@clerk/types` resolving separately.
type LocalizationResource = typeof enUS;

const CLERK_LOCALIZATIONS: Record<Locale, LocalizationResource> = {
  en: enUS,
  es: esES,
  de: deDE,
  fr: frFR,
  it: itIT,
  pt: ptBR,
  nl: nlNL,
  zh: zhCN,
  ja: jaJP,
  ar: arSA,
};

/** Our product name, which Clerk would otherwise take from its dashboard. */
export const CLERK_APP_NAME = "StudyOS";

/**
 * Clerk's strings say "Sign in to {{applicationName}}", filled from the name
 * set in Clerk's dashboard (and "My Application" when none is set). Put our
 * own name into every such string so the cards read right regardless of that
 * setting. The oauthConsent screens are left alone: there the placeholder is
 * the third-party app asking for access, not us.
 */
function withAppName<T>(value: T, path: string[] = []): T {
  if (typeof value === "string") {
    return value.replaceAll("{{applicationName}}", CLERK_APP_NAME) as T;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  if (path[0] === "oauthConsent") return value;
  const out: Record<string, unknown> = {};
  for (const [key, inner] of Object.entries(value)) out[key] = withAppName(inner, [...path, key]);
  return out as T;
}

const NAMED = new Map<Locale, LocalizationResource>();

export function clerkLocalization(locale: Locale): LocalizationResource {
  const base = CLERK_LOCALIZATIONS[locale] ?? enUS;
  let named = NAMED.get(locale);
  if (!named) {
    named = withAppName(base);
    NAMED.set(locale, named);
  }
  return named;
}
