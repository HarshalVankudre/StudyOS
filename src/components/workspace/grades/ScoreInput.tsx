"use client";

import { cn } from "@/lib/utils";
import { useCommittedDraft } from "../editor/useCommittedDraft";

/**
 * A score box made for thumbs: a decimal keypad on phones, a 44px target,
 * and it only writes when the student is done (Enter, or leaving the box),
 * so "42/" is never saved half-typed. Escape puts the stored value back.
 * `onCommit` returns false when the text could not be read; the box then
 * shows the stored value again.
 *
 * What is typed is registered with the sync engine like any buffered field
 * (editor/useCommittedDraft): written before the tab is hidden or closed,
 * before undo and before a merge, and counted by the leave prompt.
 */
export function ScoreInput({
  value,
  onCommit,
  label,
  placeholder,
  className,
}: {
  value: string;
  onCommit: (text: string) => boolean;
  label: string;
  placeholder?: string;
  className?: string;
}) {
  // Unchanged (only spaces added) or unreadable: show the stored value again.
  const { draft, change, commitNow, markCommitted } = useCommittedDraft(value, (text) =>
    text.trim() === value.trim() ? false : onCommit(text),
  );

  return (
    <input
      type="text"
      inputMode="decimal"
      enterKeyHint="done"
      autoComplete="off"
      aria-label={label}
      placeholder={placeholder}
      value={draft}
      onChange={(e) => change(e.target.value, true)}
      onFocus={(e) => e.currentTarget.select()}
      onBlur={commitNow}
      onKeyDown={(e) => {
        if (e.nativeEvent.isComposing) return;
        if (e.key === "Enter") {
          e.preventDefault();
          commitNow();
        } else if (e.key === "Escape") {
          markCommitted(value);
        }
      }}
      className={cn(
        "h-11 w-20 rounded-lg border border-line-strong bg-paper px-2 text-end font-mono text-sm tabular-nums text-ink outline-none transition placeholder:text-ink-faint focus:border-lime focus:ring-2 focus:ring-lime/30",
        className,
      )}
    />
  );
}
