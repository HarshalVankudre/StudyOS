/**
 * Dictionary registry.
 *
 * Maps each locale code to its dictionary. All ten are statically imported, so
 * this module pulls in every language — keep it to SERVER code paths only
 * (root layout, ./server.ts, and the AI layer). Client components must read
 * strings through `useI18n()` (../client.tsx), which carries only the active
 * language. Importing this file from a client component would bundle all ten.
 */
import { DEFAULT_LOCALE, type Locale } from "../config";
import { en, type Dictionary } from "./en";
import { es } from "./es";
import { de } from "./de";
import { fr } from "./fr";
import { it } from "./it";
import { pt } from "./pt";
import { nl } from "./nl";
import { zh } from "./zh";
import { ja } from "./ja";
import { ar } from "./ar";

const DICTIONARIES: Record<Locale, Dictionary> = {
  en,
  es,
  de,
  fr,
  it,
  pt,
  nl,
  zh,
  ja,
  ar,
};

/** The full dictionary for a locale (falls back to English). */
export function getDictionary(locale: Locale): Dictionary {
  return DICTIONARIES[locale] ?? DICTIONARIES[DEFAULT_LOCALE];
}

export type { Dictionary };
