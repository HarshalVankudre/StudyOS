"use client";

/**
 * Client-side i18n: a React context that carries the *active* locale and its
 * dictionary down to every client component.
 *
 * The active dictionary is loaded on the server (in the root layout) and passed
 * in as a prop, so the browser only ever downloads ONE language's strings — not
 * all ten. Client components never import `dictionaries/index`; they read the
 * dictionary through `useI18n()`.
 */
import { createContext, useContext, useMemo } from "react";
import type { Locale } from "./config";
import { dirFor } from "./config";
import type { Dictionary } from "./dictionaries/en";
import { fmt } from "./interpolate";

export interface I18n {
  locale: Locale;
  dir: "ltr" | "rtl";
  /** The active language's full dictionary (typed). */
  dict: Dictionary;
  /** Interpolate `{placeholders}` in a dictionary string. */
  t: (template: string, vars?: Record<string, string | number>) => string;
}

const I18nContext = createContext<I18n | null>(null);

export function I18nProvider({
  locale,
  dictionary,
  children,
}: {
  locale: Locale;
  dictionary: Dictionary;
  children: React.ReactNode;
}) {
  const value = useMemo<I18n>(
    () => ({ locale, dir: dirFor(locale), dict: dictionary, t: fmt }),
    [locale, dictionary],
  );
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

/** Access the active locale, its dictionary, and the `t()` interpolator. */
export function useI18n(): I18n {
  const ctx = useContext(I18nContext);
  if (!ctx) {
    throw new Error("useI18n must be used within <I18nProvider>");
  }
  return ctx;
}
