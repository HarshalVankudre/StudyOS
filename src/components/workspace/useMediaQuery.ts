"use client";

import { useCallback, useSyncExternalStore } from "react";

/** Phone-width screens: below Tailwind's `sm` breakpoint. */
export const NARROW_QUERY = "(max-width: 639px)";

/**
 * Whether a CSS media query matches, following changes (rotation, window
 * resizing). False on the server and during hydration, so server and first
 * client render agree.
 */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (typeof window === "undefined" || !window.matchMedia) return () => {};
      const media = window.matchMedia(query);
      media.addEventListener?.("change", onChange);
      return () => media.removeEventListener?.("change", onChange);
    },
    [query],
  );
  return useSyncExternalStore(
    subscribe,
    () => (typeof window !== "undefined" && window.matchMedia ? window.matchMedia(query).matches : false),
    () => false,
  );
}

/** True on phone-width screens. */
export function useNarrowScreen(): boolean {
  return useMediaQuery(NARROW_QUERY);
}
