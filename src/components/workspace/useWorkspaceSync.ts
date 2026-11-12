"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  getWorkspaceStateAction,
  getWorkspaceVersionAction,
  saveWorkspaceAction,
} from "@/app/app/actions";
import type { Removal } from "@/lib/workspace/history";
import type { Workspace } from "@/lib/workspace/types";
import { WorkspaceSync, type Notice } from "./workspace-sync";

const POLL_MS = 30_000;
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
    });
    sync.recoverDraft();

    const onChannel = (event: MessageEvent) => {
      const data = event.data as { id?: string; version?: number } | null;
      if (data?.id === id && data.version !== sync.version) void sync.checkRemote();
    };
    channel?.addEventListener("message", onChannel);

    // Leaving the tab (switching apps on a phone, closing it): keep a local
    // copy of unsaved edits and save right away instead of waiting.
    const onHide = () => {
      if (!sync.hasUnsavedChanges) return;
      sync.writeDraft();
      void sync.flush();
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") onHide();
      else void sync.checkRemote();
    };
    const onFocus = () => void sync.checkRemote();
    const onOnline = () => sync.retry();
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!sync.hasUnsavedChanges) return;
      sync.writeDraft();
      void sync.flush();
      event.preventDefault();
      // Legacy browsers need returnValue set to show the "leave site?" prompt.
      event.returnValue = "";
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", onHide);
    window.addEventListener("focus", onFocus);
    window.addEventListener("online", onOnline);
    window.addEventListener("beforeunload", onBeforeUnload);
    const poll = window.setInterval(() => {
      if (document.visibilityState === "visible") void sync.checkRemote();
    }, POLL_MS);

    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", onHide);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("beforeunload", onBeforeUnload);
      window.clearInterval(poll);
      channel?.removeEventListener("message", onChannel);
      channel?.close();
      sync.dispose();
    };
  }, [id, sync]);

  return { sync, snapshot };
}
