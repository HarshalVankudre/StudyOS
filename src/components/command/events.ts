/**
 * Window events that let any part of the app open the shell's overlays
 * without prop drilling: the palette and shortcut sheet live in the /app
 * layout, the study hub and the getting-started guide inside a workspace.
 */
export const OPEN_PALETTE_EVENT = "studyos:open-palette";
export const OPEN_SHORTCUTS_EVENT = "studyos:open-shortcuts";
export const OPEN_STUDY_HUB_EVENT = "studyos:open-study-hub";
export const SHOW_GETTING_STARTED_EVENT = "studyos:show-getting-started";
export const OPEN_EXPORT_EVENT = "studyos:open-export";

export function emit(name: string) {
  window.dispatchEvent(new Event(name));
}

/** True on Apple platforms, where the command key is ⌘ rather than Ctrl. */
export function isApplePlatform(): boolean {
  if (typeof navigator === "undefined") return false;
  const platform =
    (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform ??
    navigator.platform ??
    "";
  return /mac|iphone|ipad|ipod/i.test(platform) || /Mac OS X|iPhone|iPad/.test(navigator.userAgent);
}

/** "⌘K" on Apple devices, "Ctrl+K" elsewhere. */
export function modKey(key: string, apple = isApplePlatform()): string {
  return apple ? `⌘${key}` : `Ctrl+${key}`;
}

/** True when the keyboard event's target takes text (typing must not trigger shortcuts). */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  if (target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return true;
  if (target instanceof HTMLInputElement) {
    return !["button", "checkbox", "radio", "range", "submit", "reset", "color", "file"].includes(target.type);
  }
  return false;
}
