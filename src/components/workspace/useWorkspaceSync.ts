"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  getWorkspaceStateAction,
  getWorkspaceVersionAction,
  saveWorkspaceAction,
} from "@/app/app/actions";
import type { Removal } from "@/lib/workspace/history";
import type { Workspace } from "@/lib/workspace/types";
import { TAB_ALIVE_MS, WorkspaceSync, tabKey, type Notice } from "./workspace-sync";

const POLL_MS = 30_000;
/** How often an open tab says it is alive (its draft is not to be adopted). */
const HEARTBEAT_MS = 10_000;
const CHANNEL = "studyos-workspace";

/** Text fields keep their own native undo; the workspace history skips them. */
export function isTextEntry(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  if (target instanceof HTMLTextAreaElement) return true;
  if (target instanceof HTMLInputElement) {
    return ![
      "checkbox",
      "radio",
      "button",
      "submit",
      "reset",
      "range",
      "color",
      "file",
    ].includes(target.type);
  }
  return false;
}

const fieldIds = new WeakMap<Element, string>();
let nextFieldId = 0;

/** Stable key for the focused text field, so a typing burst is one undo step. */
export function focusedFieldKey(): string | null {
  if (typeof document === "undefined") return null;
  const el = document.activeElement;
  if (!el || !isTextEntry(el)) return null;
  let key = fieldIds.get(el);
  if (!key) {
    nextFieldId += 1;
    key = `field-${nextFieldId}`;
    fieldIds.set(el, key);
  }
  return key;
}

function safeLocalStorage(): Storage | null {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
  }
}

const TAB_ID_KEY = "studyos:tab-id";

/**
 * This tab's id, kept for the tab's lifetime (sessionStorage survives a
 * reload, so a reloaded tab finds its own draft). A duplicated tab copies
 * sessionStorage; it gets a fresh id when the original is still alive.
 */
function tabIdFor(storage: Storage | null): string {
  const fresh = () =>
    globalThis.crypto?.randomUUID?.() ?? `t-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  try {
    const session = typeof window !== "undefined" ? window.sessionStorage : null;
    const saved = session?.getItem(TAB_ID_KEY);
    const aliveAt = saved ? Number(storage?.getItem(tabKey(saved))) : NaN;
    const id = saved && !(Date.now() - aliveAt < TAB_ALIVE_MS) ? saved : fresh();
    session?.setItem(TAB_ID_KEY, id);
    return id;
  } catch {
    return fresh();
  }
}

/**
 * Hand the closing tab's last edits to the browser with a request that
 * outlives the page (the route applies them through the version-checked save
 * gate under the tab's save id, see /api/workspace/save).
 */
function sendWhileClosing(body: string): boolean {
  try {
    if (typeof fetch === "function") {
      void fetch("/api/workspace/save", {
        method: "POST",
        keepalive: true,
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body,
      }).catch(() => {});
      return true;
    }
  } catch {
    // fall through to sendBeacon
  }
  try {
    return typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function"
      ? navigator.sendBeacon("/api/workspace/save", new Blob([body], { type: "application/json" }))
      : false;
  } catch {
    return false;
  }
}

export interface SyncCallbacks {
  onRemoval: (removal: Removal, entryId: number) => void;
  onNotice: (notice: Notice) => void;
}

/**
 * React binding for WorkspaceSync: owns one engine per editor, keeps it in
 * sync with the page lifecycle (tab hidden/closed, focus, back online, other
 * tabs saving) and re-renders on every change.
 */
export function useWorkspaceSync(
  id: string,
  initialWorkspace: Workspace,
  initialVersion: number,
  callbacks: SyncCallbacks,
) {
  const callbacksRef = useRef(callbacks);
  useEffect(() => {
    callbacksRef.current = callbacks;
  });

  const [sync] = useState(
    () =>
      new WorkspaceSync(id, initialWorkspace, initialVersion, {
        save: saveWorkspaceAction,
        fetchState: getWorkspaceStateAction,
        fetchVersion: getWorkspaceVersionAction,
        tabId: tabIdFor(safeLocalStorage()),
      }),
  );
  const snapshot = useSyncExternalStore(
    sync.subscribe,
    sync.getSnapshot,
    sync.getSnapshot,
  );

  useEffect(() => {
    let channel: BroadcastChannel | null = null;
    try {
      channel =
        typeof BroadcastChannel !== "undefined" ? new BroadcastChannel(CHANNEL) : null;
    } catch {
      channel = null;
    }
    sync.setDeps({
      storage: safeLocalStorage(),
      isOnline: () => (typeof navigator === "undefined" ? true : navigator.onLine),
      onSaved: (version) => {
        try {
          channel?.postMessage({ id, version });
        } catch {
          // Channel already closed (editor unmounting): nothing to tell.
        }
      },
      onRemoval: (removal, entryId) =>
        callbacksRef.current.onRemoval(removal, entryId),
      onNotice: (notice) => callbacksRef.current.onNotice(notice),
      beacon: sendWhileClosing,
    });
    sync.start();

    const onChannel = (event: MessageEvent) => {
      const data = event.data as { id?: string; version?: number } | null;
      if (data?.id === id && data.version !== sync.version) void sync.checkRemote();
    };
    channel?.addEventListener("message", onChannel);

    // Leaving the tab (switching apps on a phone, closing it): write what is
    // still typed in a field and the local copy synchronously (the page may
    // be frozen right after), then save right away instead of waiting.
    const onVisibility = () => {
      if (document.visibilityState === "hidden") sync.prepareToLeave();
      else {
        sync.heartbeat();
        void sync.checkRemote();
      }
    };
    const onPageHide = () => {
      // Closing: the last edits go to the server with a request that
      // outlives the page; the local draft stays as the fallback.
      sync.prepareToLeave(true);
      // A clean exit: its draft may be recovered by the next tab at once;
      // `pageshow` marks it alive again if it comes back (back/forward cache).
      sync.releaseTab();
    };
    const onPageShow = () => sync.heartbeat();
    const onFocus = () => void sync.checkRemote();
    const onOnline = () => sync.retry();
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      // Ask "leave site?" only when something would not reach the server:
      // offline, a patch too large to send while closing, saving stuck, or
      // work that is not a document edit yet (an exam in progress).
      const sent = sync.prepareToLeave(true);
      if (!sync.hasUnsavedChanges || (sent && !sync.hasBufferedWork())) return;
      event.preventDefault();
      // Legacy browsers need returnValue set to show the "leave site?" prompt.
      event.returnValue = "";
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", onPageHide);
    window.addEventListener("pageshow", onPageShow);
    window.addEventListener("focus", onFocus);
    window.addEventListener("online", onOnline);
    window.addEventListener("beforeunload", onBeforeUnload);
    const poll = window.setInterval(() => {
      // Also while "gone": the workspace may be restored from the trash.
      if (document.visibilityState === "visible") void sync.checkRemote();
    }, POLL_MS);
    const alive = window.setInterval(() => {
      sync.heartbeat();
      // Edits left by a tab that crashed after this one opened.
      if (document.visibilityState === "visible") sync.adoptOrphans();
    }, HEARTBEAT_MS);

    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", onPageHide);
      window.removeEventListener("pageshow", onPageShow);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("beforeunload", onBeforeUnload);
      window.clearInterval(poll);
      window.clearInterval(alive);
      channel?.removeEventListener("message", onChannel);
      channel?.close();
      sync.dispose();
    };
  }, [id, sync]);

  return { sync, snapshot };
}
