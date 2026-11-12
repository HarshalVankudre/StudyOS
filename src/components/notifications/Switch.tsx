"use client";

import { cn } from "@/lib/utils";

/** An accessible on/off switch (role="switch"), large enough to tap. */
export function Switch({
  checked,
  onChange,
  labelledBy,
  describedBy,
  disabled,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  labelledBy: string;
  describedBy?: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="group inline-flex min-h-11 min-w-14 shrink-0 items-center justify-center rounded-full disabled:opacity-50"
    >
      <span
        className={cn(
          "relative inline-block h-6 w-11 rounded-full border transition-colors",
          checked ? "border-lime bg-lime" : "border-line-strong bg-surface-2",
        )}
      >
        <span
          className={cn(
            "absolute top-0.5 h-[18px] w-[18px] rounded-full shadow-sm transition-all",
            checked ? "bg-lime-on start-[22px]" : "bg-ink-faint start-0.5",
          )}
        />
      </span>
    </button>
  );
}
