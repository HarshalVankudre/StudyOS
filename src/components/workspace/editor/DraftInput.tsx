"use client";

import type { InputHTMLAttributes } from "react";
import { useCommittedDraft } from "./useCommittedDraft";

/**
 * A single-line input (page title, page icon, callout emoji) that writes to
 * the workspace after a typing pause or on blur, not on every keystroke.
 */
export function DraftInput({
  value,
  onCommit,
  onBlur,
  ...rest
}: Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange"> & {
  value: string;
  onCommit: (value: string) => void;
}) {
  const { draft, change, commitNow } = useCommittedDraft(value, onCommit);
  return (
    <input
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
