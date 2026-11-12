"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

/**
 * A score box made for thumbs: a decimal keypad on phones, a 44px target,
 * and it only writes when the student is done (Enter, or leaving the box),
 * so "42/" is never saved half-typed. Escape puts the stored value back.
 * `onCommit` returns false when the text could not be read; the box then
 * shows the stored value again.
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
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? value;

  const commit = () => {
    if (draft === null) return;
    if (draft.trim() !== value.trim()) onCommit(draft);
    setDraft(null);
  };

  return (
    <input
      type="text"
      inputMode="decimal"
      enterKeyHint="done"
      autoComplete="off"
      aria-label={label}
      placeholder={placeholder}
      value={shown}
      onChange={(e) => setDraft(e.target.value)}
      onFocus={(e) => e.currentTarget.select()}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.nativeEvent.isComposing) return;
        if (e.key === "Enter") {
          e.preventDefault();
          commit();
        } else if (e.key === "Escape") {
          setDraft(null);
        }
      }}
      className={cn(
        "h-11 w-20 rounded-lg border border-line-strong bg-paper px-2 text-end font-mono text-sm tabular-nums text-ink outline-none transition placeholder:text-ink-faint focus:border-lime focus:ring-2 focus:ring-lime/30",
        className,
      )}
    />
  );
}
