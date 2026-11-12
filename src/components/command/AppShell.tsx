"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState, useSyncExternalStore } from "react";
import { InstallHint } from "@/components/onboarding/InstallHint";
import { CommandPalette, workspaceIdFromPath } from "./CommandPalette";
import {
  isApplePlatform,
  isTypingTarget,
  OPEN_PALETTE_EVENT,
  OPEN_SHORTCUTS_EVENT,
} from "./events";
import { SearchButton } from "./SearchButton";
import { ShortcutSheet } from "./ShortcutSheet";

const noop = () => () => {};

/**
 * Everything every /app page shares: the ⌘/Ctrl+K palette, the "?" shortcut
 * sheet, the phone install hint and the offline service worker. A floating
 * search button serves touch screens (workspace pages on larger screens have
 * one in their header instead).
 */
export function AppShell() {
  const pathname = usePathname();
  const apple = useSyncExternalStore(noop, isApplePlatform, () => false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing) return;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setShortcutsOpen(false);
        setPaletteOpen((v) => !v);
        return;
      }
      if (e.key === "?" && !mod && !e.altKey && !isTypingTarget(e.target)) {
        e.preventDefault();
        setPaletteOpen(false);
        setShortcutsOpen(true);
      }
    };
    const openPalette = () => {
      setShortcutsOpen(false);
      setPaletteOpen(true);
    };
    const openShortcuts = () => {
      setPaletteOpen(false);
      setShortcutsOpen(true);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener(OPEN_PALETTE_EVENT, openPalette);
    window.addEventListener(OPEN_SHORTCUTS_EVENT, openShortcuts);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener(OPEN_PALETTE_EVENT, openPalette);
      window.removeEventListener(OPEN_SHORTCUTS_EVENT, openShortcuts);
    };
  }, []);

  // Offline fallback only (public/sw.js never caches pages or API responses).
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" }).catch(() => {});
  }, []);

  return (
    <>
      {paletteOpen && (
        <CommandPalette
          open
          onOpenChange={setPaletteOpen}
          onShowShortcuts={() => setShortcutsOpen(true)}
          apple={apple}
        />
      )}
      <ShortcutSheet open={shortcutsOpen} onOpenChange={setShortcutsOpen} apple={apple} />
      {/* Workspace pages have search in their header (a button from the sm
          breakpoint up, the "More actions" menu on phones). */}
      {!workspaceIdFromPath(pathname) && <SearchButton variant="floating" />}
      <InstallHint />
    </>
  );
}
