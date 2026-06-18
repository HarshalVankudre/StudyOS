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

export function clerkLocalization(locale: Locale): LocalizationResource {
  return CLERK_LOCALIZATIONS[locale] ?? enUS;
}
