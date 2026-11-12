/**
 * Turns grade results into the sentences the block shows, in the student's
 * language and grading scale. No React: unit-testable on its own.
 */
import type { Dictionary } from "@/lib/i18n/dictionaries/en";
import {
  bandFor,
  bandName,
  formatGrade,
  formatPercent,
  type CourseGrade,
  type GradeNote,
  type ScaleDefinition,
} from "@/lib/grades";

type T = (template: string, vars?: Record<string, string | number>) => string;
type G = Dictionary["grades"];

/**
 * A target as the student chose it. A grade of the scale ("First", "B+",
 * "1,7") is named with its own threshold: "First (70%)". A raw percentage is
 * named as the percentage, with the grade it falls in only as information:
 * "80% (a First on your scale)", never "First (80%)", which would claim the
 * grade needs 80%. The arithmetic always uses the stored target itself.
 */
export function targetText(target: number, scale: ScaleDefinition, locale: string, g?: G, t?: T): string {
  const band = bandFor(target, scale);
  if (!band || scale.display === "percent" || scale.bands.length === 0) return formatPercent(target, locale);
  if (Math.abs(band.min - target) < 1e-9) return `${bandName(band, scale, locale)} (${formatPercent(band.min, locale)})`;
  const percent = formatPercent(target, locale);
  return g && t ? t(g.targetAside, { percent, grade: bandName(band, scale, locale) }) : percent;
}

/** "82.1% (B-)" or "82.1%". */
export function gradeWithPercent(percent: number, scale: ScaleDefinition, locale: string): string {
  if (scale.display === "percent") return formatPercent(percent, locale);
  return `${formatPercent(percent, locale)} (${formatGrade(percent, scale, locale)})`;
}

/** The answer to "what do I need?" for one course. */
export function outlookText(
  grade: CourseGrade,
  target: number | null,
  scale: ScaleDefinition,
  locale: string,
  g: G,
  t: T,
): string {
  const o = grade.outlook;
  if (target === null || !o) return grade.totalWeight > 0 ? g.outlook.pick : "";
  const goal = targetText(target, scale, locale, g, t);
  switch (o.kind) {
    case "needed":
      return grade.decidedWeight > 0
        ? t(g.outlook.needed, {
            target: goal,
            average: formatPercent(o.average, locale),
            remaining: formatPercent((grade.remainingWeight / grade.totalWeight) * 100, locale, 0),
          })
        : t(g.outlook.neededNoScores, { target: goal, average: formatPercent(o.average, locale) });
    case "secured":
      return t(g.outlook.secured, { target: goal });
    case "unreachable":
      return t(g.outlook.unreachable, {
        target: goal,
        average: formatPercent(o.average, locale),
        best: gradeWithPercent(o.best, scale, locale),
      });
    case "met":
      return t(g.outlook.met, { final: gradeWithPercent(o.final, scale, locale), target: goal });
    case "missed":
      return t(g.outlook.missed, {
        final: gradeWithPercent(o.final, scale, locale),
        target: goal,
        short: formatPercent(target - o.final, locale),
      });
  }
}

/** One assumption the calculation made, as a sentence. */
export function noteText(note: GradeNote, locale: string, g: G, t: T): string {
  switch (note.code) {
    case "weights_sum":
      return t(g.notes.weightsSum, { sum: formatPercent(note.sum, locale) });
    case "unweighted_split":
      return t(g.notes.unweightedSplit, { count: note.count, each: formatPercent(note.each, locale) });
    case "unweighted_ignored":
      return t(g.notes.unweightedIgnored, { count: note.count });
    case "points_based":
      return g.notes.pointsBased;
    case "equal_weights":
      return g.notes.equalWeights;
    case "extra_credit":
      return g.notes.extraCredit;
    case "invalid_max":
      return t(g.notes.invalidMax, { count: note.count });
    case "uncategorized":
      return t(g.notes.uncategorized, { count: note.count });
  }
}
