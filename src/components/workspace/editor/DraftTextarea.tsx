"use client";

import type { ComponentProps } from "react";
import { useCommittedDraft } from "./useCommittedDraft";

/**
 * The multi-line DraftInput (flashcard sides, quiz prompts and answers):
 * typing stays local and is written to the workspace after a pause, on blur
 * and on unmount, so a burst of typing is one write, one undo step and one
 * save instead of one per key. Buffered typing is registered with the sync
 * engine (written before the tab is hidden or closed, before undo/redo and
 * before a merge) and the field follows outside changes when it holds no
 * uncommitted typing.
 */
export function DraftTextarea({
  value,
  onCommit,
  onBlur,
  ...rest
}: Omit<ComponentProps<"textarea">, "value" | "onChange"> & {
  value: string;
  onCommit: (value: string) => void;
}) {
  const { draft, change, commitNow } = useCommittedDraft(value, onCommit);
  return (
    <textarea
      {...rest}
      value={draft}
      onChange={(e) => change(e.target.value)}
      onBlur={(e) => {
        commitNow();
        onBlur?.(e);
      }}
    />
  );
}
