"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

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
 * after a pause, on blur (`commitNow`), when the tab is hidden (callers) and
 * on unmount, so the workspace history sees one step per burst of typing
 * rather than one per keystroke, and nothing typed is ever dropped.
 *
 * When the stored value changes from elsewhere (AI edit, undo) and the field
 * holds no uncommitted typing, the draft follows it.
 */
export function useCommittedDraft(
  value: string,
  onCommit: (text: string) => void,
  delay: number = COMMIT_DELAY_MS,
): CommittedDraft {
  const [draft, setDraft] = useState(value);
  const [seen, setSeen] = useState(value);
  if (value !== seen) {
    setSeen(value);
    if (draft === seen) setDraft(value);
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
  }, [value]);
  useLayoutEffect(() => {
    draftRef.current = draft;
  }, [draft]);

  const commitNow = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const text = draftRef.current;
    if (text !== committedRef.current) {
      committedRef.current = text;
      onCommitRef.current(text);
    }
  }, []);

  const change = useCallback(
    (text: string, hold = false) => {
      draftRef.current = text;
      setDraft(text);
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

  // Never lose typing when the field goes away (page switch, AI remount).
  useEffect(() => () => commitNow(), [commitNow]);

  return { draft, change, commitNow, markCommitted };
}
