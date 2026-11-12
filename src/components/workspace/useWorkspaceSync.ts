"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { unstable_isUnrecognizedActionError } from "next/navigation";
import {
  getWorkspaceStateAction,
  getWorkspaceVersionAction,
  saveWorkspaceAction,
} from "@/app/app/actions";
import { RUN_RESULTS_REPLAY, runResultsReplayer } from "@/lib/study/quiz";
import type { Removal } from "@/lib/workspace/history";
import type { Workspace } from "@/lib/workspace/types";
import { gradeReplayer } from "./study/gradeEdit";
import { WorkspaceSync, type Notice } from "./workspace-sync";

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

/**
 * The server no longer knows the action this tab called: a newer build was
 * deployed and this tab still runs the previous one. Nothing it sends will be
 * accepted any more, so the engine stops and the student is asked to reload
 * (their unsaved edits are in the local draft).
 */
function isOutdatedBuild(error: unknown): boolean {
  try {
    return unstable_isUnrecognizedActionError(error);
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

  // A fresh engine (and tab id) per page load: a reloaded or duplicated tab is
  // a new tab; what the previous one left behind is recovered from its draft.
  const [sync] = useState(() => {
    const guarded =
      <A extends unknown[], R>(call: (...args: A) => Promise<R>) =>
      async (...args: A): Promise<R> => {
        try {
          return await call(...args);
        } catch (error) {
          if (isOutdatedBuild(error)) engine.markOutdated();
          throw error;
        }
      };
    const engine: WorkspaceSync = new WorkspaceSync(id, initialWorkspace, initialVersion, {
      save: guarded(saveWorkspaceAction),
      fetchState: guarded(getWorkspaceStateAction),
      fetchVersion: guarded(getWorkspaceVersionAction),
      replayers: { grade: gradeReplayer, [RUN_RESULTS_REPLAY]: runResultsReplayer },
    });
    return engine;
  });
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
    sync.start();

    const onChannel = (event: MessageEvent) => {
      const data = event.data as { id?: string; version?: number } | null;
      if (data?.id === id && data.version !== sync.version) void sync.checkRemote();
    };
    channel?.addEventListener("message", onChannel);

    // Leaving the tab (switching apps on a phone, closing it): write what is
    // still typed in a field and the local copy synchronously (the page may
    // be frozen or gone right after), then save right away instead of
    // waiting. Nothing else is sent while closing: what the save does not
    // get through stays in this browser's draft and is merged the next time
    // the workspace is opened here.
    const onVisibility = () => {
      if (document.visibilityState === "hidden") sync.prepareToLeave();
      else {
        sync.heartbeat();
        void sync.checkRemote();
      }
    };
    const onPageHide = () => {
      sync.prepareToLeave();
      // A clean exit: its draft may be recovered by the next tab at once;
      // `pageshow` marks it alive again if it comes back (back/forward cache).
      sync.releaseTab();
    };
    const onPageShow = () => {
      // Shown again (also restored from the back/forward cache): alive, and
      // whatever happened meanwhile (another tab taking the draft over, saves
      // from other devices) is read before anything else is built on top.
      sync.heartbeat();
      void sync.checkRemote();
    };
    const onFocus = () => void sync.checkRemote();
    const onOnline = () => sync.retry();
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      // Ask "leave site?" whenever something has not reached the server yet
      // (the edits would stay on this device only until it is opened again).
      sync.prepareToLeave();
      if (!sync.hasUnsavedChanges) return;
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
      // The editor is gone from this page (navigated elsewhere in the app):
      // what it could not save is in its draft, free to be taken over at once
      // by the editor that opens next (`start` marks this one alive again if
      // it is the same one remounting).
      sync.releaseTab();
    };
  }, [id, sync]);

  return { sync, snapshot };
}
