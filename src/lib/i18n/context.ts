"use client";

/**
 * The i18n React context on its own, so shared UI primitives (the dialog's
 * close label) can read it optionally without depending on ./client, which
 * many tests replace with a stub.
 */
import { createContext, useContext } from "react";
import type { Locale } from "./config";
import type { Dictionary } from "./dictionaries/en";
import type { PluralForms } from "./plural";

export interface I18n {
  locale: Locale;
  dir: "ltr" | "rtl";
  /** The active language's full dictionary (typed). */
  dict: Dictionary;
  /** Interpolate `{placeholders}` in a dictionary string. */
  t: (template: string, vars?: Record<string, string | number>) => string;
  /** A count string in the right plural form (see ./plural): `plural(dict.counts.cards, n)`. */
  plural: (forms: PluralForms, count: number, vars?: Record<string, string | number>) => string;
}

export const I18nContext = createContext<I18n | null>(null);

/**
 * The i18n context, or null outside an <I18nProvider>. For shared UI
 * primitives that must also render in isolation (they fall back to English).
 */
export function useOptionalI18n(): I18n | null {
  return useContext(I18nContext);
}
