"use client";

/**
 * Where keyboard focus goes when a dialog closes.
 *
 * Radix only returns focus to a <DialogTrigger>, and none of our dialogs use
 * one (they open from state), so without this focus fell to <body> on close
 * and keyboard and screen-reader users lost their place. Each dialog records,
 * when it opens, the element that opened it plus, when that element sat inside
 * another dialog, that dialog's own return targets (the study hub opens a
 * session and closes itself: the session then returns to whatever opened the
 * hub). On close the first of them still on the page gets focus.
 */

const CONTENT_SELECTOR = '[data-slot="dialog-content"]';
const chains = new WeakMap<Element, HTMLElement[]>();

let lastFocused: HTMLElement | null = null;
let listening = false;

function listen() {
  if (listening || typeof document === "undefined") return;
  listening = true;
  document.addEventListener(
    "focusin",
    (event) => {
      if (event.target instanceof HTMLElement) lastFocused = event.target;
    },
    true,
  );
}
listen();

function isUsable(el: HTMLElement): boolean {
  if (!el.isConnected) return false;
  if ((el as HTMLButtonElement).disabled) return false;
  if (el.closest("[inert], [aria-hidden='true']")) return false;
  return true;
}

/**
 * A menu item that opened a dialog is gone once its menu closed; the menu's
 * button (Radix menus are labelled by their trigger) is the next best place.
 */
function menuTrigger(el: HTMLElement): HTMLElement[] {
  const id = el.closest('[role="menu"][aria-labelledby]')?.getAttribute("aria-labelledby");
  const trigger = id ? document.getElementById(id) : null;
  return trigger ? [trigger] : [];
}

/**
 * Call when a dialog's content mounts, before it moves focus inside itself.
 * `content` is the dialog content element.
 */
export function rememberOpener(content: Element): void {
  listen();
  const active = document.activeElement;
  // Clicking a button that unmounts in the same render (a menu item, a button
  // inside the dialog being swapped for this one) leaves focus on <body>; the
  // last element that held focus, now detached, is then the opener. (A
  // still-attached one means the student clicked elsewhere since: no opener.)
  const opener =
    active instanceof HTMLElement && active !== document.body && !content.contains(active)
      ? active
      : lastFocused && !lastFocused.isConnected
        ? lastFocused
        : null;
  if (!opener) {
    chains.set(content, []);
    return;
  }
  // `closest` still walks a detached subtree, so this works for a dialog that
  // was just removed as this one opened.
  const host = opener.closest(CONTENT_SELECTOR);
  chains.set(content, [opener, ...((host && chains.get(host)) || [])]);
}

/**
 * Call when the dialog has closed. Returns true when it moved focus. Leaves
 * focus alone when something else already took it (another dialog opened).
 */
export function restoreFocus(content: Element | null, fallback?: () => HTMLElement | null | undefined): boolean {
  const active = document.activeElement;
  const free = !active || active === document.body || (content?.contains(active) ?? false);
  const chain = (content && chains.get(content)) || [];
  if (content) chains.delete(content);
  if (!free) return false;
  const extra = fallback?.();
  const candidates = chain.flatMap((el) => [el, ...(el.isConnected ? [] : menuTrigger(el))]);
  const target = [...candidates, ...(extra ? [extra] : [])].find(isUsable);
  if (!target) return false;
  target.focus();
  return true;
}
