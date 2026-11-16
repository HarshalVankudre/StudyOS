"use client";

import { useId } from "react";
import { RotateCcw } from "lucide-react";
import { useI18n } from "@/lib/i18n/client";
import type { GradeBand, GradeScalePreset, GradesBlock } from "@/lib/workspace/types";
import { GRADE_SCALE_PRESETS, parseLocaleNumber, type ScaleDefinition } from "@/lib/grades";
import { DraftInput } from "../editor/DraftInput";
import { ScoreInput } from "./ScoreInput";
import { TargetPicker } from "./TargetPicker";

const FIELD =
  "h-11 w-full min-w-0 rounded-lg border border-line-strong bg-paper px-2 text-sm text-ink outline-none focus:border-lime-deep focus:ring-2 focus:ring-lime-deep/30";

type Entry = NonNullable<GradesBlock["entry"]>;

/**
 * With German grades: module grades typed directly (one module per row) or
 * percentages and points mapped to grades. A radio pair, so the choice reads
 * as a sentence on a phone.
 */
export function EntryChoice({ value, onChange }: { value: Entry; onChange: (entry: Entry) => void }) {
  const { dict } = useI18n();
  const M = dict.grades.modules;
  const name = useId();
  return (
    <fieldset className="flex min-w-0 flex-col gap-2 text-sm">
      <legend className="mb-1 font-semibold text-ink">{M.entryLegend}</legend>
      {(["grade", "percent"] as const).map((entry) => (
        <label
          key={entry}
          className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border border-line-strong bg-card px-3 py-2 text-ink transition hover:bg-hover has-[:checked]:border-lime-deep has-[:checked]:bg-lime-faint"
        >
          <input
            type="radio"
            name={name}
            value={entry}
            checked={value === entry}
            onChange={() => onChange(entry)}
            className="size-4 shrink-0 accent-lime-deep"
          />
          <span className="min-w-0">{entry === "grade" ? M.entryGrade : M.entryPercent}</span>
        </label>
      ))}
    </fieldset>
  );
}

/**
 * Grading scale (with editable thresholds, since schools differ), the default
 * target, and a way back into column setup. With German grades, how grades
 * are entered; module grades have no thresholds and no percentage target.
 */
export function GradesSettings({
  scale,
  customBands,
  defaultTarget,
  entry,
  onScale,
  onBands,
  onDefaultTarget,
  onEntry,
  onEditColumns,
}: {
  scale: ScaleDefinition;
  /** How grades are entered (only offered with German grades). */
  entry: Entry;
  /** True when the block stores its own thresholds. */
  customBands: boolean;
  defaultTarget: number | null;
  onScale: (preset: GradeScalePreset) => void;
  /** New thresholds, or null to go back to the preset's. */
  onBands: (bands: GradeBand[] | null) => void;
  onDefaultTarget: (target: number | null) => void;
  onEntry: (entry: Entry) => void;
  onEditColumns: () => void;
}) {
  const { dict, t, locale } = useI18n();
  const g = dict.grades;
  const fmt = (n: number) => new Intl.NumberFormat(locale, { maximumFractionDigits: 2, useGrouping: false }).format(n);

  const editBand = (index: number, patch: Partial<GradeBand>) =>
    onBands(scale.bands.map((b, i) => (i === index ? { ...b, ...patch } : b)));
  const german = scale.preset === "de_grade";
  const modules = german && entry === "grade";

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
        {!modules && (
          <div className="flex min-w-0 flex-col gap-1 text-sm">
            <span className="font-semibold text-ink">{g.defaultTarget}</span>
            <TargetPicker
              scale={scale}
              value={defaultTarget}
              label={g.defaultTarget}
              onChange={onDefaultTarget}
            />
          </div>
        )}
      </div>

      {german && <EntryChoice value={entry} onChange={onEntry} />}

      {!modules && scale.bands.length > 0 && (
        <fieldset className="flex flex-col gap-2">
          <legend className="text-sm font-semibold text-ink">{g.thresholds}</legend>
          <p className="text-xs text-ink-soft">{g.thresholdsHint}</p>
          <ul className="grid gap-2 sm:grid-cols-2">
            {scale.bands.map((band, i) => {
              const name = scale.display === "points" && band.points !== undefined ? fmt(band.points) : band.label;
              return (
                <li key={i} className="flex items-center gap-2">
                  <DraftInput
                    value={band.label}
                    onCommit={(value) => editBand(i, { label: value.slice(0, 40) })}
                    maxLength={40}
                    aria-label={t(g.bandLabelAria, { index: i + 1 })}
                    className="h-11 w-24 min-w-0 rounded-lg border border-line-strong bg-paper px-2 text-sm font-semibold text-ink outline-none focus:border-lime-deep"
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
