"use client";

import { useState } from "react";
import { RichText } from "@/components/RichText";
import { cn } from "@/lib/utils";

export type BlockTextProps = {
  value: string;
  onCommit: (text: string) => void;
  placeholder?: string;
  className?: string;
};

/**
 * Live-split read/edit control for a single line of note-block text.
 * - Idle: renders `value` typeset via RichText (placeholder when empty).
 * - Focused: shows the raw <input> plus a live RichText preview of the draft;
 *   commits the draft on blur and returns to the typeset render.
 * The same `className` styles both modes so typography never shifts. The parent
 * remounts this component (key bump) after AI edits, resetting local state.
 */
export function BlockText({ value, onCommit, placeholder, className }: BlockTextProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  const startEditing = () => {
    setDraft(value);
    setEditing(true);
  };

  if (!editing) {
    const isEmpty = value.trim() === "";
    return (
      <div
        tabIndex={0}
        onClick={startEditing}
        onFocus={startEditing}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            startEditing();
          }
        }}
        className={cn("cursor-text", className)}
      >
        {isEmpty ? (
          <span className="text-ink-soft/40">{placeholder}</span>
        ) : (
          <RichText text={value} className={className} />
        )}
      </div>
    );
  }

  return (
    <div className={className}>
      {draft.trim() !== "" && (
        <div className="pointer-events-none mb-1 opacity-90">
          <RichText text={draft} className={className} />
        </div>
      )}
      <input
        autoFocus
        value={draft}
        placeholder={placeholder}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          onCommit(draft);
          setEditing(false);
        }}
        className={cn(className, "w-full")}
      />
    </div>
  );
}
