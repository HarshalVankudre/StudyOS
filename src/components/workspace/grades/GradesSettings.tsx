"use client";

import { RotateCcw } from "lucide-react";
import { useI18n } from "@/lib/i18n/client";
import type { GradeBand, GradeScalePreset } from "@/lib/workspace/types";
import { GRADE_SCALE_PRESETS, parseLocaleNumber, type ScaleDefinition } from "@/lib/grades";
import { ScoreInput } from "./ScoreInput";
import { TargetPicker } from "./TargetPicker";

const FIELD =
  "h-11 w-full min-w-0 rounded-lg border border-line-strong bg-paper px-2 text-sm text-ink outline-none focus:border-lime focus:ring-2 focus:ring-lime/30";

/**
 * Grading scale (with editable thresholds, since schools differ), the default
 * target, and a way back into column setup.
 */
export function GradesSettings({
  scale,
  customBands,
  defaultTarget,
  onScale,
  onBands,
  onDefaultTarget,
  onEditColumns,
}: {
  scale: ScaleDefinition;
  /** True when the block stores its own thresholds. */
  customBands: boolean;
  defaultTarget: number | null;
  onScale: (preset: GradeScalePreset) => void;
  /** New thresholds, or null to go back to the preset's. */
  onBands: (bands: GradeBand[] | null) => void;
  onDefaultTarget: (target: number | null) => void;
  onEditColumns: () => void;
}) {
  const { dict, t, locale } = useI18n();
  const g = dict.grades;
  const fmt = (n: number) => new Intl.NumberFormat(locale, { maximumFractionDigits: 2, useGrouping: false }).format(n);

  const editBand = (index: number, patch: Partial<GradeBand>) =>
    onBands(scale.bands.map((b, i) => (i === index ? { ...b, ...patch } : b)));

  return (
    <div className="flex flex-col gap-4 border-b border-line bg-hover/40 px-3 py-4 sm:px-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex min-w-0 flex-col gap-1 text-sm">
          <span className="font-semibold text-ink">{g.scaleLabel}</span>
          <select
            value={scale.preset}
            onChange={(e) => onScale(e.target.value as GradeScalePreset)}
            className={FIELD}
          >
            {GRADE_SCALE_PRESETS.map((p) => (
              <option key={p} value={p}>
                {g.presets[p]}
              </option>
            ))}
          </select>
        </label>
        <div className="flex min-w-0 flex-col gap-1 text-sm">
          <span className="font-semibold text-ink">{g.defaultTarget}</span>
          <TargetPicker
            scale={scale}
            value={defaultTarget}
            label={g.defaultTarget}
            onChange={onDefaultTarget}
          />
        </div>
      </div>

      {scale.bands.length > 0 && (
        <fieldset className="flex flex-col gap-2">
          <legend className="text-sm font-semibold text-ink">{g.thresholds}</legend>
          <p className="text-xs text-ink-soft">{g.thresholdsHint}</p>
          <ul className="grid gap-2 sm:grid-cols-2">
            {scale.bands.map((band, i) => {
              const name = scale.display === "points" && band.points !== undefined ? fmt(band.points) : band.label;
              return (
                <li key={i} className="flex items-center gap-2">
                  <input
                    value={band.label}
                    onChange={(e) => editBand(i, { label: e.target.value.slice(0, 40) })}
                    aria-label={t(g.bandLabelAria, { index: i + 1 })}
                    className="h-11 w-24 min-w-0 rounded-lg border border-line-strong bg-paper px-2 text-sm font-semibold text-ink outline-none focus:border-lime"
                  />
                  <span className="text-xs text-ink-soft">≥</span>
                  {/* The lowest band starts at 0: everything below the others. */}
                  {i === scale.bands.length - 1 ? (
                    <span className="w-20 text-end font-mono text-sm text-ink-soft">{fmt(band.min)}</span>
                  ) : (
                    <ScoreInput
                      value={fmt(band.min)}
                      label={t(g.bandMinAria, { label: name })}
                      onCommit={(text) => {
                        const n = parseLocaleNumber(text.replace(/%/g, ""));
                        // Two grades cannot start at the same percentage.
                        if (n === null || n < 0 || n > 1000) return false;
                        if (scale.bands.some((b, j) => j !== i && b.min === n)) return false;
                        editBand(i, { min: n });
                        return true;
                      }}
                    />
                  )}
                  <span className="text-xs text-ink-soft">%</span>
                  {band.points !== undefined && (
                    <ScoreInput
                      value={fmt(band.points)}
                      label={t(g.bandPointsAria, { label: name })}
                      className="w-16"
                      onCommit={(text) => {
                        const n = parseLocaleNumber(text);
                        if (n === null || Math.abs(n) > 100) return false;
                        editBand(i, { points: n });
                        return true;
                      }}
                    />
                  )}
                </li>
              );
            })}
          </ul>
          {customBands && (
            <button
              type="button"
              onClick={() => onBands(null)}
              className="flex min-h-11 w-fit items-center gap-1.5 rounded-lg border border-line-strong bg-card px-3 text-sm font-semibold text-ink transition hover:bg-hover"
            >
              <RotateCcw className="size-4" aria-hidden />
              {g.resetBands}
            </button>
          )}
        </fieldset>
      )}

      <button
        type="button"
        onClick={onEditColumns}
        className="flex min-h-11 w-fit items-center rounded-lg border border-line-strong bg-card px-3 text-sm font-semibold text-ink transition hover:bg-hover"
      >
        {g.editColumns}
      </button>
    </div>
  );
}
