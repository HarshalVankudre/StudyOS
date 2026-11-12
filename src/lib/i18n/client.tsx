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
import { useContext, useMemo } from "react";
import type { Locale } from "./config";
import { dirFor } from "./config";
import { I18nContext, type I18n } from "./context";
import type { Dictionary } from "./dictionaries/en";
import { fmt } from "./interpolate";
import { pluralizer } from "./plural";

export type { I18n } from "./context";
export { useOptionalI18n } from "./context";

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
    () => ({
      locale,
      dir: dirFor(locale),
      dict: dictionary,
      t: fmt,
      plural: pluralizer(locale),
    }),
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
