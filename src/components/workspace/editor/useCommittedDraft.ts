"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { usePendingFieldRegistry } from "./pendingFields";

/** Commit a typing burst once the student pauses this long. */
export const COMMIT_DELAY_MS = 1000;

export interface CommittedDraft {
  /** What the field shows. */
  draft: string;
  /** The user typed: show it now, commit after a pause (unless `hold`). */
  change: (text: string, hold?: boolean) => void;
  /** Commit the draft now if it differs from the stored value. */
  commitNow: () => void;
  /**
   * Show `text` and treat it as already stored: the caller wrote it to the
   * workspace itself (e.g. as part of an Enter split), so no extra commit.
   */
  markCommitted: (text: string) => void;
}

/**
 * Local draft for a text field backed by the workspace store.
 *
 * Typing only changes local state; the draft is written through `onCommit`
 * after a pause, on blur (`commitNow`) and on unmount, so the workspace
 * history sees one step per burst of typing rather than one per keystroke.
 *
 * Inside the editor the field registers with the sync engine (see
 * pendingFields.ts), which writes the buffered typing first whenever it
 * matters: before the tab is hidden or closed, before undo/redo, and before
 * merging a newer version from elsewhere. Nothing typed is ever left behind.
 *
 * When the stored value changes from elsewhere (AI edit, undo, a merge) and
 * the field holds no uncommitted typing, the draft follows it.
 */
export function useCommittedDraft(
  value: string,
  /** Returning false: the text was not stored (unreadable); the field shows the stored value again. */
  onCommit: (text: string) => void | boolean,
  delay: number = COMMIT_DELAY_MS,
): CommittedDraft {
  const sync = usePendingFieldRegistry();
  const rev = sync?.rev ?? 0;
  const [draft, setDraft] = useState(value);
  const [seen, setSeen] = useState(value);
  const [seenRev, setSeenRev] = useState(rev);
  // Set by a commit until the field is typed in again: the stored value that
  // results (possibly normalised, "1." stored as 1) is what the field shows.
  const [follow, setFollow] = useState(false);
  if (rev !== seenRev) {
    // Undo, redo or a merge: the engine wrote this field's typing just before,
    // so show what is stored now (even if it equals what was stored before
    // the commit, as when undo reverts the typing at once).
    setSeenRev(rev);
    setSeen(value);
    setDraft(value);
  } else if (value !== seen) {
    setSeen(value);
    if (draft === seen || follow) {
      setDraft(value);
      setFollow(false);
    }
  }

  const draftRef = useRef(value);
  const committedRef = useRef(value);
  const onCommitRef = useRef(onCommit);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useLayoutEffect(() => {
    onCommitRef.current = onCommit;
  });
  useLayoutEffect(() => {
    committedRef.current = value;
  }, [value, seenRev]);
  useLayoutEffect(() => {
    draftRef.current = draft;
  }, [draft]);

  const commitNow = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const text = draftRef.current;
    const stored = committedRef.current;
    if (text !== stored) {
      committedRef.current = text;
      setFollow(true);
      if (onCommitRef.current(text) === false) {
        committedRef.current = stored;
        draftRef.current = stored;
        setDraft(stored);
        setFollow(false);
      }
    }
  }, []);

  const change = useCallback(
    (text: string, hold = false) => {
      draftRef.current = text;
      setDraft(text);
      setFollow(false);
      if (timer.current) clearTimeout(timer.current);
      timer.current = hold ? null : setTimeout(commitNow, delay);
    },
    [commitNow, delay],
  );

  const markCommitted = useCallback((text: string) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    draftRef.current = text;
    committedRef.current = text;
    setDraft(text);
  }, []);

  // Let the sync engine write buffered typing when it needs to.
  const register = sync?.register;
  useEffect(() => {
    if (!register) return;
    return register({
      commit: () => commitNow(),
      hasPending: () => draftRef.current !== committedRef.current,
    });
  }, [register, commitNow]);

  // Never lose typing when the field goes away (page switch, AI remount).
  useEffect(() => () => commitNow(), [commitNow]);

  return { draft, change, commitNow, markCommitted };
}
