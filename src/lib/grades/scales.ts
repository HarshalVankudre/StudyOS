/**
 * Grading scales: how a course percentage is shown to a student.
 *
 * Every calculation in src/lib/grades works in percentages. A scale only maps
 * a percentage to what the student's school writes on a transcript: a letter
 * (US), grade points (US GPA), a degree class (UK) or a German grade 1.0-5.0.
 * Schools differ, so every threshold is editable: a block stores its own
 * `bands` when the student changes them, otherwise the preset's apply.
 *
 * Pure (no React, no DOM): safe for the server, the agent and the planner.
 */
import { MAX_GRADE_BANDS } from "@/lib/workspace/schema";
import type { GradeBand, GradeScalePreset } from "@/lib/workspace/types";

export const GRADE_SCALE_PRESETS: readonly GradeScalePreset[] = [
  "percent",
  "us_letter",
  "us_gpa",
  "uk_degree",
  "de_grade",
] as const;

/** What the student sees for a grade under a scale. */
export type GradeDisplay = "percent" | "label" | "points";

export interface ScaleDefinition {
  preset: GradeScalePreset;
  display: GradeDisplay;
  /** Best band first. Empty for the plain percentage scale. */
  bands: GradeBand[];
  /** Decimals for grade points (GPA 2, German 1). */
  pointsDecimals: number;
  /** German grades: 1.0 is best, so a smaller average is better. */
  lowerPointsBetter: boolean;
}

/** Localized labels for the UK classes (the other presets use symbols). */
export interface UkClassLabels {
  first: string;
  upperSecond: string;
  lowerSecond: string;
  third: string;
  fail: string;
}

const DEFAULT_UK_LABELS: UkClassLabels = {
  first: "First",
  upperSecond: "2:1",
  lowerSecond: "2:2",
  third: "Third",
  fail: "Fail",
};

/** A common US scale; many schools differ, hence editable. */
const US_BANDS: GradeBand[] = [
  { min: 93, label: "A", points: 4.0 },
  { min: 90, label: "A-", points: 3.7 },
  { min: 87, label: "B+", points: 3.3 },
  { min: 83, label: "B", points: 3.0 },
  { min: 80, label: "B-", points: 2.7 },
  { min: 77, label: "C+", points: 2.3 },
  { min: 73, label: "C", points: 2.0 },
  { min: 70, label: "C-", points: 1.7 },
  { min: 67, label: "D+", points: 1.3 },
  { min: 63, label: "D", points: 1.0 },
  { min: 60, label: "D-", points: 0.7 },
  { min: 0, label: "F", points: 0 },
];

/**
 * The linear German mapping many universities use with a 50 % pass mark
 * (1,0 from 95 %, then a step every 5 %, 5,0 = failed).
 */
const DE_BANDS: GradeBand[] = [
  { min: 95, label: "1,0", points: 1.0 },
  { min: 90, label: "1,3", points: 1.3 },
  { min: 85, label: "1,7", points: 1.7 },
  { min: 80, label: "2,0", points: 2.0 },
  { min: 75, label: "2,3", points: 2.3 },
  { min: 70, label: "2,7", points: 2.7 },
  { min: 65, label: "3,0", points: 3.0 },
  { min: 60, label: "3,3", points: 3.3 },
  { min: 55, label: "3,7", points: 3.7 },
  { min: 50, label: "4,0", points: 4.0 },
  { min: 0, label: "5,0", points: 5.0 },
];

function ukBands(labels: UkClassLabels): GradeBand[] {
  return [
    { min: 70, label: labels.first },
    { min: 60, label: labels.upperSecond },
    { min: 50, label: labels.lowerSecond },
    { min: 40, label: labels.third },
    { min: 0, label: labels.fail },
  ];
}

/** The preset's default bands (fresh copies; safe to edit). */
export function presetBands(preset: GradeScalePreset, uk: UkClassLabels = DEFAULT_UK_LABELS): GradeBand[] {
  switch (preset) {
    case "us_letter":
    case "us_gpa":
      return US_BANDS.map((b) => ({ ...b }));
    case "uk_degree":
      return ukBands(uk);
    case "de_grade":
      return DE_BANDS.map((b) => ({ ...b }));
    default:
      return [];
  }
}

/**
 * Clean a stored or edited band list: finite thresholds only, best (highest
 * minimum) first, no two bands on the same minimum. Never empty for a banded
 * scale: a list with nothing usable falls back to the preset.
 */
export function normalizeBands(bands: readonly GradeBand[]): GradeBand[] {
  const seen = new Set<number>();
  return bands
    .filter((b) => Number.isFinite(b.min))
    .map((b) => ({ ...b, label: b.label.trim() }))
    .sort((a, b) => b.min - a.min)
    .filter((b) => {
      if (seen.has(b.min)) return false;
      seen.add(b.min);
      return true;
    })
    .slice(0, MAX_GRADE_BANDS);
}

/** The scale a block uses: its preset, with its own edited bands when present. */
export function resolveScale(
  preset: GradeScalePreset | undefined,
  bands?: readonly GradeBand[],
  uk?: UkClassLabels,
): ScaleDefinition {
  const p = preset ?? "percent";
  const defaults = presetBands(p, uk);
  const custom = bands && bands.length > 0 && p !== "percent" ? normalizeBands(bands) : [];
  return {
    preset: p,
    display: p === "percent" ? "percent" : p === "us_gpa" || p === "de_grade" ? "points" : "label",
    bands: custom.length > 0 ? custom : defaults,
    pointsDecimals: p === "de_grade" ? 1 : 2,
    lowerPointsBetter: p === "de_grade",
  };
}

/**
 * The band a percentage falls in: the best band whose minimum it reaches.
 * Below every minimum it is the lowest band. Null for an unbanded scale.
 */
export function bandFor(percent: number, scale: ScaleDefinition): GradeBand | null {
  if (scale.bands.length === 0) return null;
  for (const band of scale.bands) {
    if (percent >= band.min - 1e-9) return band;
  }
  return scale.bands[scale.bands.length - 1];
}

/** Grade points for a percentage (GPA-style scales), or null. */
export function pointsFor(percent: number, scale: ScaleDefinition): number | null {
  const band = bandFor(percent, scale);
  return band?.points ?? null;
}

/**
 * Bands a student can pick as a target: every band but the lowest (nobody
 * aims for "F"). Ordered best first.
 */
export function targetChoices(scale: ScaleDefinition): GradeBand[] {
  return scale.bands.length > 1 ? scale.bands.slice(0, -1) : scale.bands;
}

// ---------------------------------------------------------------------------
// Formatting (Intl only; locale-aware decimal separators)
// ---------------------------------------------------------------------------

/** "87.5%", "87,5 %", ... in the student's locale. */
export function formatPercent(value: number, locale: string, maxDecimals = 1): string {
  return new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: maxDecimals }).format(
    value / 100,
  );
}

export function formatPoints(value: number, scale: ScaleDefinition, locale: string): string {
  const d = scale.pointsDecimals;
  // German averages are cut, not rounded, after the first decimal (1,79 -> 1,7).
  const shown = scale.lowerPointsBetter ? Math.floor(value * 10 ** d + 1e-9) / 10 ** d : value;
  return new Intl.NumberFormat(locale, { minimumFractionDigits: d, maximumFractionDigits: d }).format(shown);
}

/** A band's name as the student sees it (points scales show the points). */
export function bandName(band: GradeBand, scale: ScaleDefinition, locale: string): string {
  if (scale.display === "points" && band.points !== undefined) {
    return formatPoints(band.points, scale, locale);
  }
  return band.label;
}

/** How a single course percentage is written under the scale. */
export function formatGrade(percent: number, scale: ScaleDefinition, locale: string): string {
  if (scale.display === "percent") return formatPercent(percent, locale);
  const band = bandFor(percent, scale);
  if (!band) return formatPercent(percent, locale);
  return bandName(band, scale, locale);
}
