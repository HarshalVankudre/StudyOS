"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";

/**
 * App-wide theme controller (next-themes). Toggles the `.dark` class on <html>,
 * which flips the design tokens defined in globals.css. We intentionally do NOT
 * disable transitions on change so the editorial 0.4s background/color crossfade
 * (see `body` in globals.css) plays when switching.
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="light"
      enableSystem={false}
    >
      {children}
    </NextThemesProvider>
  );
}
