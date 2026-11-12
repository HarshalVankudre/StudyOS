"use client";

/**
 * The editor's URL state: which page is open, and what a deep link asked to
 * bring into view. Contract (lib/workspace/deep-link.ts):
 *
 *   /app/<workspaceId>?page=<pageId>[&block=<blockId> | &db=<databaseId>&row=<rowId>]
 *
 * Moving between pages pushes `?page=` onto the history (so Back returns to
 * the previous page and a reload stays put); Back/Forward and links that
 * change the query (search, the Today plan) re-resolve it. Once a block or
 * row target has been shown, the URL is trimmed back to `?page=` so a reload
 * does not reopen it.
 */
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  readDeepLinkParams,
  resolveDeepLink,
  type ResolvedDeepLink,
} from "@/lib/workspace/deep-link";
import type { Workspace } from "@/lib/workspace/types";
import type { DeepLinkApi, DeepLinkFocus } from "./DeepLinkContext";

interface LocationState {
  /** The query string this state was resolved from. */
  key: string;
  pageId: string | undefined;
  focus: DeepLinkFocus | null;
  seq: number;
}

function toFocus(focus: ResolvedDeepLink["focus"], seq: number): DeepLinkFocus | null {
  if (!focus) return null;
  return focus.kind === "block"
    ? { seq, kind: "block", blockId: focus.blockId }
    : { seq, kind: "row", databaseId: focus.databaseId, rowId: focus.rowId };
}

function writePageToUrl(pageId: string, mode: "push" | "replace"): void {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  const next = `${url.pathname}?page=${encodeURIComponent(pageId)}`;
  if (`${url.pathname}${url.search}` === next) return;
  if (mode === "push") window.history.pushState(null, "", next);
  else window.history.replaceState(null, "", next);
}

export function useEditorLocation(workspace: Workspace) {
  const searchParams = useSearchParams();
  const key = searchParams?.toString() ?? "";

  const [state, setState] = useState<LocationState>(() => {
    const resolved = resolveDeepLink(workspace, readDeepLinkParams(searchParams));
    return { key, pageId: resolved.pageId, focus: toFocus(resolved.focus, 1), seq: 1 };
  });

  // The query changed from outside (Back/Forward, a deep link from search or
  // the Today plan): follow it. Adjusting state while rendering, as React
  // recommends for state derived from a changing input.
  if (key !== state.key) {
    const params = readDeepLinkParams(searchParams);
    if (params.page && params.page === state.pageId && !params.block && !params.row) {
      setState({ ...state, key });
    } else {
      const resolved = resolveDeepLink(workspace, params);
      const seq = state.seq + 1;
      setState({ key, pageId: resolved.pageId, focus: toFocus(resolved.focus, seq), seq });
    }
  }

  const pageId = state.pageId;
  const pageRef = useRef(pageId);
  useLayoutEffect(() => {
    pageRef.current = pageId;
  });

  /** Open a page; "push" adds a history entry, "replace" does not. */
  const goToPage = useCallback((nextPageId: string | undefined, mode: "push" | "replace" = "push") => {
    if (!nextPageId) return;
    setState((s) => ({ ...s, pageId: nextPageId, focus: null }));
    writePageToUrl(nextPageId, mode);
  }, []);

  const claimed = useRef(new Set<number>());
  const claim = useCallback((seq: number) => {
    if (claimed.current.has(seq)) return false;
    claimed.current.add(seq);
    // Shown once: keep only the page in the URL.
    if (pageRef.current) writePageToUrl(pageRef.current, "replace");
    return true;
  }, []);

  const deepLink = useMemo<DeepLinkApi>(() => ({ focus: state.focus, claim }), [claim, state.focus]);

  return { pageId, goToPage, deepLink };
}
