"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";

/**
 * App-wide theme controller (next-themes). Light is the default: `:root` in
 * globals.css holds the paper-and-ink tokens, and the `.dark` class on <html>
 * overrides them with the dark ramp. We intentionally do NOT disable transitions
 * on change so the editorial 0.4s background/color crossfade (see `body` in
 * globals.css) plays when switching.
 *
 * next-themes renders an inline <script> that applies the saved theme before
 * first paint. It only ever runs from the server HTML; when React has to build
 * the tree in the browser instead (a server render that failed, for example),
 * a script it creates never executes and React logs an error for it. Marking
 * it as a data block on the client keeps that case quiet, as the Next.js guide
 * on preventing flash before hydration recommends. next-themes already sets
 * suppressHydrationWarning on the tag, which covers the differing `type`.
 */
const THEME_SCRIPT_PROPS = {
  type: typeof window === "undefined" ? "text/javascript" : "text/plain",
};

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="light"
      enableSystem={false}
      scriptProps={THEME_SCRIPT_PROPS}
    >
      {children}
    </NextThemesProvider>
  );
}
