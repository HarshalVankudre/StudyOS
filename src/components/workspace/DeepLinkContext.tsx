"use client";

/**
 * Hand-off from the editor's URL state (lib/workspace/deep-link.ts) to the
 * page and database views: "bring this block into view" or "open this row".
 * A target is claimed exactly once, by the first view that can show it, so a
 * database embedded twice on a page opens its row only once.
 */
import { createContext, useContext, useEffect, type RefObject } from "react";

export type DeepLinkFocus =
  | { seq: number; kind: "block"; blockId: string }
  | { seq: number; kind: "row"; databaseId: string; rowId: string };

export interface DeepLinkApi {
  focus: DeepLinkFocus | null;
  /** True for the first caller per target; later callers get false. */
  claim: (seq: number) => boolean;
}

const NONE: DeepLinkApi = { focus: null, claim: () => false };

const DeepLinkContext = createContext<DeepLinkApi>(NONE);

export const DeepLinkProvider = DeepLinkContext.Provider;

export function useDeepLink(): DeepLinkApi {
  return useContext(DeepLinkContext);
}

const FLASH_CLASSES = ["rounded-md", "bg-lime-faint", "ring-2", "ring-lime/60", "transition-colors"];
const FLASH_MS = 2200;

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
    : false;
}

/** Scroll an element into the middle of the view and highlight it briefly. */
export function revealElement(element: HTMLElement): void {
  element.scrollIntoView?.({
    block: "center",
    behavior: prefersReducedMotion() ? "auto" : "smooth",
  });
  element.classList.add(...FLASH_CLASSES);
  element.setAttribute("data-deep-link-target", "true");
  window.setTimeout(() => {
    element.classList.remove(...FLASH_CLASSES);
    element.removeAttribute("data-deep-link-target");
  }, FLASH_MS);
}

/**
 * For a page: when the link targets one of its blocks, scroll to it and
 * highlight it. `listRef` holds the page's block rows (`[data-block-id]`).
 */
export function useBlockDeepLink(listRef: RefObject<HTMLElement | null>): void {
  const { focus, claim } = useDeepLink();
  useEffect(() => {
    if (focus?.kind !== "block") return;
    const rows = listRef.current?.querySelectorAll<HTMLElement>("[data-block-id]") ?? [];
    const target = Array.from(rows).find((el) => el.dataset.blockId === focus.blockId);
    if (!target || !claim(focus.seq)) return;
    revealElement(target);
  }, [claim, focus, listRef]);
}
