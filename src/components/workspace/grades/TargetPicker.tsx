"use client";

import { useI18n } from "@/lib/i18n/client";
import { bandName, formatPercent, parseLocaleNumber, targetChoices, type ScaleDefinition } from "@/lib/grades";
import { ScoreInput } from "./ScoreInput";

/**
 * Choose a target: a grade of the scale ("B+", "2:1", "1,7") when it has
 * grades, otherwise a percentage. Stored as a percentage either way.
 */
export function TargetPicker({
  scale,
  value,
  label,
  onChange,
  inheritedLabel,
}: {
  scale: ScaleDefinition;
  value: number | null;
  label: string;
  onChange: (target: number | null) => void;
  /** Shown for "no own target" when a default applies (per-course pickers). */
  inheritedLabel?: string;
}) {
  const { dict, locale } = useI18n();
  const g = dict.grades;

  if (scale.bands.length === 0) {
    const fmt = (n: number) => new Intl.NumberFormat(locale, { maximumFractionDigits: 2, useGrouping: false }).format(n);
    return (
      <span className="flex items-center gap-1.5">
        <ScoreInput
          value={value === null ? "" : fmt(value)}
          label={label}
          placeholder={inheritedLabel ?? g.noTarget}
          className="w-24"
          onCommit={(text) => {
            const trimmed = text.replace(/[%٪]/g, "").trim();
            if (trimmed === "") {
              onChange(null);
              return true;
            }
            const n = parseLocaleNumber(trimmed);
            if (n === null || n < 0 || n > 1000) return false;
            onChange(n);
            return true;
          }}
        />
        <span className="text-sm text-ink-soft">%</span>
      </span>
    );
  }

  const choices = targetChoices(scale);
  // A stored target between two grades (e.g. after a scale change) still shows.
  const matches = value !== null && choices.some((b) => b.min === value);
  return (
    <select
      aria-label={label}
      value={value === null ? "" : String(value)}
      onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
      className="h-11 w-full min-w-0 rounded-lg border border-line-strong bg-paper px-2 text-sm text-ink outline-none focus:border-lime focus:ring-2 focus:ring-lime/30 sm:w-auto"
    >
      <option value="">{inheritedLabel ?? g.noTarget}</option>
      {value !== null && !matches && <option value={String(value)}>{formatPercent(value, locale)}</option>}
      {choices.map((b) => (
        <option key={b.min} value={String(b.min)}>
          {`${bandName(b, scale, locale)} (${formatPercent(b.min, locale)})`}
        </option>
      ))}
    </select>
  );
}
