"use client";

import type { ComponentProps } from "react";
import { useCommittedDraft } from "./useCommittedDraft";

/**
 * A single-line input (page title, page icon, callout emoji, database cells)
 * that writes to the workspace after a typing pause or on blur, not on every
 * keystroke. Buffered typing is registered with the sync engine, so it is
 * written before the tab is hidden or closed, before undo/redo and before a
 * newer version is merged in. It follows outside changes to `value` (undo,
 * the AI agent, another tab) whenever it holds no uncommitted typing, so it
 * never needs remounting.
 */
export function DraftInput({
  value,
  onCommit,
  onBlur,
  onKeyDown,
  commitOnPause = true,
  revertOnEscape = false,
  ...rest
}: Omit<ComponentProps<"input">, "value" | "onChange"> & {
  value: string;
  onCommit: (value: string) => void;
  /**
   * Commit after a typing pause (default). Off for values that are only
   * meaningful once complete (numbers, dates): they commit on blur, Enter,
   * or when the engine asks.
   */
  commitOnPause?: boolean;
  /** Escape puts the stored value back and leaves the field. */
  revertOnEscape?: boolean;
}) {
  const { draft, change, commitNow, markCommitted } = useCommittedDraft(value, onCommit);
  return (
    <input
      {...rest}
      value={draft}
      onChange={(e) => change(e.target.value, !commitOnPause)}
      onKeyDown={(e) => {
        if (revertOnEscape && e.key === "Escape") {
          markCommitted(value);
          e.currentTarget.blur();
        }
        onKeyDown?.(e);
      }}
      onBlur={(e) => {
        commitNow();
        onBlur?.(e);
      }}
    />
  );
}
