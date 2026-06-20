"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";

/**
 * App-wide theme controller (next-themes). Dark is the default: `:root` in
 * globals.css holds the dark token ramp, and the `.light` class on <html>
 * overrides it with light tokens. We intentionally do NOT disable transitions
 * on change so the editorial 0.4s background/color crossfade (see `body` in
 * globals.css) plays when switching.
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="dark"
      enableSystem={false}
    >
      {children}
    </NextThemesProvider>
  );
}
