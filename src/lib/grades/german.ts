/**
 * The German grade average (Notenschnitt): module grades from 1,0 (best) to
 * 5,0, weighted by the module's credits (ECTS, "Leistungspunkte").
 *
 * The rules most examination regulations (Prüfungsordnungen) state:
 *   - a module is passed with 4,0 or better; anything worse (5,0) is failed,
 *     is not part of the average and earns no credits until it is retaken;
 *   - the average is weighted by credits;
 *   - only the first decimal counts, every further one is cut off without
 *     rounding ("alle weiteren Stellen werden ohne Rundung gestrichen"),
 *     so 1,89 is a 1,8.
 * Some programmes weight modules differently or drop the worst grades; the
 * calculator says so instead of guessing.
 *
 * Cutting off decimals must not depend on floating point (1,0 and 1,2 at 6
 * credits each average 1,1, which plain float division reads as 1,0999...),
 * so grades are integer tenths, credits integer hundredths, and the cuts are
 * integer divisions.
 *
 * Pure (no React, no DOM): the free calculator uses it, the in-app tracker
 * can later.
 */
import { parseLocaleNumber } from "./calc";

/** 4,0: the worst grade that passes, in tenths. */
export const PASS_LIMIT_TENTHS = 40;
const BEST_TENTHS = 10;
const WORST_TENTHS = 50;

/** A grade (1.7) as integer tenths (17), or null when it is not a German grade 1,0..5,0 in tenths. */
export function gradeToTenths(grade: number | null | undefined): number | null {
  if (typeof grade !== "number" || !Number.isFinite(grade)) return null;
  const tenths = Math.round(grade * 10);
  if (Math.abs(grade * 10 - tenths) > 1e-6) return null;
  return tenths >= BEST_TENTHS && tenths <= WORST_TENTHS ? tenths : null;
}

/**
 * A grade as a student types it: "1,7", "1.7", "2", "2,0". Any tenth from
 * 1,0 to 5,0 is accepted (averaged module grades such as 1,5 exist), nothing
 * else: null for "1,75", "0,7", "6", "", "gut".
 */
export function parseGermanGrade(text: string): number | null {
  const n = parseLocaleNumber(text);
  if (n === null) return null;
  const tenths = gradeToTenths(n);
  return tenths === null ? null : tenths / 10;
}

/** 4,0 or better. */
export function isPassingGrade(grade: number): boolean {
  const tenths = gradeToTenths(grade);
  return tenths !== null && tenths <= PASS_LIMIT_TENTHS;
}

export interface GermanModule {
  /** Credits (ECTS); null (or 0 and below) when unknown. */
  ects: number | null;
  /** The grade (1.0..5.0), or null while the module is still open. */
  grade: number | null;
  /** False: the module is left out entirely (an ungraded or optional module). */
  counts?: boolean;
}

export interface GermanAverage {
  /** The exact mean of the passed modules, or null when none is passed. */
  mean: number | null;
  /** The mean as it is reported: cut after the first decimal (1.8 for 1.89). */
  shown: number | null;
  /** `shown` in integer tenths (18). */
  shownTenths: number | null;
  /** The mean cut after the second decimal (1.89), for showing next to `shown`. */
  unrounded: number | null;
  /** By credits; "equal" when a passed module has no credits (then every module counts the same). */
  weighting: "ects" | "equal";
  /** Credits of the passed modules. */
  earnedEcts: number;
  /** Credits of the modules still open. */
  openEcts: number;
  passed: number;
  failed: number;
  open: number;
  /** Modules left out (`counts: false`). */
  excluded: number;
  /** Passed modules without credits (why the mean is unweighted). */
  passedWithoutEcts: number;
  /** Open modules without credits. */
  openWithoutEcts: number;
}

/** floor(a / b) for non-negative integers, exactly. */
function floorDiv(a: number, b: number): number {
  let q = Math.floor(a / b);
  while (q * b > a) q -= 1;
  while ((q + 1) * b <= a) q += 1;
  return q;
}

/** Credits as integer hundredths (7,5 LP -> 750), or null when unknown. */
function ectsUnits(ects: number | null | undefined): number | null {
  if (typeof ects !== "number" || !Number.isFinite(ects) || ects <= 0) return null;
  const units = Math.round(ects * 100);
  return units > 0 ? units : null;
}

interface Tally {
  passed: { tenths: number; units: number | null }[];
  failed: number;
  open: number;
  excluded: number;
  /** Credits of open modules, in hundredths. */
  openUnits: number;
  openWithoutEcts: number;
}

function tally(modules: readonly GermanModule[]): Tally {
  const t: Tally = { passed: [], failed: 0, open: 0, excluded: 0, openUnits: 0, openWithoutEcts: 0 };
  for (const m of modules) {
    if (m.counts === false) {
      t.excluded += 1;
      continue;
    }
    const tenths = gradeToTenths(m.grade);
    const units = ectsUnits(m.ects);
    if (tenths === null) {
      // No grade (or not a German grade): still open.
      t.open += 1;
      if (units === null) t.openWithoutEcts += 1;
      else t.openUnits += units;
    } else if (tenths > PASS_LIMIT_TENTHS) {
      t.failed += 1;
    } else {
      t.passed.push({ tenths, units });
    }
  }
  return t;
}

/** Sum of weight x grade (in tenths) and sum of weights of the passed modules, weighted as the average is. */
function sums(t: Tally): { earned: number; weight: number; weighting: GermanAverage["weighting"] } {
  const byEcts = t.passed.every((p) => p.units !== null);
  let earned = 0;
  let weight = 0;
  for (const p of t.passed) {
    const w = byEcts ? (p.units as number) : 1;
    earned += w * p.tenths;
    weight += w;
  }
  return { earned, weight, weighting: byEcts ? "ects" : "equal" };
}

/** The Notenschnitt of the passed modules, with what is earned and what is still open. */
export function germanAverage(modules: readonly GermanModule[]): GermanAverage {
  const t = tally(modules);
  const { earned, weight, weighting } = sums(t);
  const has = weight > 0;
  const shownTenths = has ? floorDiv(earned, weight) : null;
  return {
    mean: has ? earned / weight / 10 : null,
    shown: shownTenths === null ? null : shownTenths / 10,
    shownTenths,
    unrounded: has ? floorDiv(earned * 10, weight) / 100 : null,
    weighting,
    earnedEcts: t.passed.reduce((s, p) => s + (p.units ?? 0), 0) / 100,
    openEcts: t.openUnits / 100,
    passed: t.passed.length,
    failed: t.failed,
    open: t.open,
    excluded: t.excluded,
    passedWithoutEcts: t.passed.filter((p) => p.units === null).length,
    openWithoutEcts: t.openWithoutEcts,
  };
}

/** What the open modules need for a target average. */
export type GermanNeeded =
  /** No modules at all. */
  | { kind: "empty" }
  /** Nothing is open any more: the average is final (null when nothing was passed). */
  | { kind: "complete"; reached: boolean; shown: number | null }
  /** Some module (passed or open) has no credits, so the weighted answer cannot be given. */
  | { kind: "missingEcts"; count: number }
  /** Even 4,0 in every open module reaches the target. */
  | { kind: "secured" }
  /**
   * An average of `grade` or better across the open modules (weighted by
   * their credits) reaches the target; one tenth worse does not.
   */
  | { kind: "needed"; grade: number }
  /** Even 1,0 in every open module falls short; `best` is the best average still possible. */
  | { kind: "unreachable"; best: number };

/**
 * The average the open modules need for the reported (cut-off) average to be
 * `target` or better, i.e. for the exact mean to stay below target + 0,1.
 * Failed modules are not counted: a retake is a module still open. Null when
 * `target` is not a passing German grade.
 */
export function neededAverage(modules: readonly GermanModule[], target: number): GermanNeeded | null {
  const goalTenths = gradeToTenths(target);
  if (goalTenths === null || goalTenths > PASS_LIMIT_TENTHS) return null;
  const t = tally(modules);
  if (t.passed.length + t.failed + t.open === 0) return { kind: "empty" };
  if (t.open === 0) {
    const { shownTenths } = germanAverage(modules);
    return {
      kind: "complete",
      reached: shownTenths !== null && shownTenths <= goalTenths,
      shown: shownTenths === null ? null : shownTenths / 10,
    };
  }
  const missing = t.openWithoutEcts + t.passed.filter((p) => p.units === null).length;
  if (missing > 0) return { kind: "missingEcts", count: missing };

  const { earned, weight } = sums(t);
  const open = t.openUnits;
  const total = weight + open;
  // Reported grade <= goal  <=>  exact mean < goal + 1 tenth  <=>  earned + x * open < (goal + 1) * total.
  const bound = (goalTenths + 1) * total;
  if (earned + PASS_LIMIT_TENTHS * open < bound) return { kind: "secured" };
  if (earned + BEST_TENTHS * open >= bound) {
    return { kind: "unreachable", best: floorDiv(earned + BEST_TENTHS * open, total) / 10 };
  }
  // The largest x (in tenths) with x * open < bound - earned.
  const room = bound - earned;
  const x = floorDiv(room, open) - (room % open === 0 ? 1 : 0);
  return { kind: "needed", grade: x / 10 };
}

/** A grade as written in the student's language: "1,7" in German, "1.7" in English. */
export function formatGermanGrade(grade: number, locale: string, decimals = 1): string {
  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
    useGrouping: false,
  }).format(grade);
}
