/**
 * The free grade calculator (/tools/grade-calculator): its state, how that
 * state is written into the page address, and how it is fed to the grade
 * math the app uses. No maths of its own.
 *
 * Two modes:
 *   course  one course: work with weights in percent and scores, what the
 *           rest needs for a target (lib/grades/calc.ts);
 *   ects    the German grade average (Notenschnitt): modules with credits
 *           (ECTS) and grades 1,0..5,0, what the open modules need
 *           (lib/grades/german.ts). The default for German visitors.
 *
 * The state lives only in the address's fragment (#...), which browsers
 * never send to a server: a calculation can be bookmarked or shared as a
 * link, and nothing is stored anywhere (no cookie, no browser storage).
 *
 *   #m=course&s=us_letter&t=87&r=20~92~Problem+sets&r=40~~Final
 *   #m=ects&t=2.0&r=9~2,3~Mathematik+I&r=6~~Statistik
 *
 *   m  the mode; written whenever there is anything to write, so a link
 *      opens the same mode in every language (absent: the visitor's default)
 *   s  the grading scale of the course mode (absent: percentage)
 *   t  the target, as typed (course) or a grade such as 2.0 (ects)
 *   r  one row each, as typed: weight ~ score ~ name (course) or
 *      credits ~ grade ~ name (ects)
 *
 * Only the mode on screen is in the address; the other keeps what was typed
 * in it until the page is left.
 *
 * A link can come from anyone, so reading one never throws, keeps at most
 * MAX_ROWS rows, cuts every text to its box's length and ignores what it
 * does not know.
 *
 * Pure (no React, no DOM): unit-tested on its own.
 */
import { computeCourseGrade, parseLocaleNumber, parseScoreInput, type CourseGrade, type GradeItemInput } from "@/lib/grades/calc";
import {
  formatGermanGrade,
  germanAverage,
  neededAverage,
  parseGermanGrade,
  PASS_LIMIT_TENTHS,
  type GermanAverage,
  type GermanModule,
  type GermanNeeded,
} from "@/lib/grades/german";
import { GRADE_SCALE_PRESETS, resolveScale, targetChoices } from "@/lib/grades/scales";
import type { GradeScalePreset } from "@/lib/workspace/types";

/** Rows a calculation can have (more is a syllabus, not a course). */
export const MAX_ROWS = 40;
/** Rows a fresh calculator starts with. */
export const START_ROWS = 4;
/** Longest name of a row. */
export const MAX_NAME_LENGTH = 80;
/** Longest weight, credits, grade or target ("12,5 %"). */
export const MAX_NUMBER_LENGTH = 12;
/** Longest score ("42,5 / 50"). */
export const MAX_SCORE_LENGTH = 20;
/** Longest address fragment read at all; anything beyond is ignored. */
export const MAX_FRAGMENT_LENGTH = 8_000;
/** Most credits one module can carry (a typo above that, not a module). */
export const MAX_MODULE_ECTS = 999;

export const CALC_MODES = ["course", "ects"] as const;
export type CalcMode = (typeof CALC_MODES)[number];

/** German visitors average module grades by credits; everyone else starts with one course. */
export function defaultModeFor(locale: string): CalcMode {
  return locale === "de" ? "ects" : "course";
}

export interface CalcRow {
  /** Stable React key; not part of the address. */
  id: number;
  name: string;
  /** Course mode: percent of the course grade. ECTS mode: the module's credits. As typed. */
  weight: string;
  /** Course mode: the score ("42/50", "84%", "84"). ECTS mode: the grade ("1,7"). Empty = not graded yet. */
  score: string;
}

export interface CalcState {
  mode: CalcMode;
  /** Course mode: the grading scale. */
  scale: GradeScalePreset;
  /** Course mode: the target, as typed (percentage scale) or a grade's minimum (other scales). */
  target: string;
  /** Course mode: the graded work. */
  rows: CalcRow[];
  /** ECTS mode: the target average ("2.0", or "" for none) and the modules. */
  modules: { target: string; rows: CalcRow[] };
}

export function emptyRows(count: number, firstId = 0): CalcRow[] {
  return Array.from({ length: count }, (_, i) => ({ id: firstId + i, name: "", weight: "", score: "" }));
}

export function initialState(mode: CalcMode = "course"): CalcState {
  return {
    mode,
    scale: "percent",
    target: "",
    rows: emptyRows(START_ROWS),
    modules: { target: "", rows: emptyRows(START_ROWS) },
  };
}

export function isBlankRow(row: Pick<CalcRow, "name" | "weight" | "score">): boolean {
  return row.name.trim() === "" && row.weight.trim() === "" && row.score.trim() === "";
}

/** The rows of the mode on screen. */
export function activeRows(state: CalcState): CalcRow[] {
  return state.mode === "ects" ? state.modules.rows : state.rows;
}

/** The id for a new row. */
export function nextRowId(rows: readonly CalcRow[]): number {
  return rows.reduce((max, r) => Math.max(max, r.id), -1) + 1;
}

// ---------------------------------------------------------------------------
// The address
// ---------------------------------------------------------------------------

const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;
// Control characters (a pasted line break, a NUL) never belong in a one-line box.
const CONTROL = /[\u0000-\u001f\u007f]/g;

/** At most `max` characters, never half of one (a cut emoji would break encoding). */
function clip(text: string, max: number): string {
  const clean = text.replace(CONTROL, " ").replace(LONE_SURROGATE, "�");
  return clean.length <= max ? clean : clean.slice(0, max).replace(LONE_SURROGATE, "");
}

/** One value: percent-encoded, but readable ("Problem+sets", "42/50"); "~" is reserved. */
function encodePart(text: string): string {
  return encodeURIComponent(text.replace(LONE_SURROGATE, "�"))
    .replace(/%20/g, "+")
    .replace(/%2F/gi, "/")
    .replace(/%2C/gi, ",")
    .replace(/~/g, "%7E");
}

function decodePart(text: string): string {
  try {
    return decodeURIComponent(text.replace(/\+/g, " "));
  } catch {
    // A broken escape ("%E0%A4") reads as nothing rather than failing the page.
    return "";
  }
}

function isPreset(value: string): value is GradeScalePreset {
  return (GRADE_SCALE_PRESETS as readonly string[]).includes(value);
}

function isMode(value: string): value is CalcMode {
  return (CALC_MODES as readonly string[]).includes(value);
}

/** A target average as stored: a passing German grade written "2.0", or "" for none. */
export function moduleTarget(text: string): string {
  const grade = parseGermanGrade(text);
  return grade !== null && Math.round(grade * 10) <= PASS_LIMIT_TENTHS ? grade.toFixed(1) : "";
}

/**
 * The address fragment for a state (without "#"); empty for a blank
 * calculator in the visitor's default mode. Blank rows at the end are left out.
 */
export function encodeState(state: CalcState, defaultMode: CalcMode): string {
  const ects = state.mode === "ects";
  const parts: string[] = [];
  if (!ects && state.scale !== "percent") parts.push(`s=${state.scale}`);
  const target = ects ? state.modules.target : state.target;
  if (target.trim() !== "") parts.push(`t=${encodePart(clip(target, MAX_NUMBER_LENGTH))}`);
  const rows = activeRows(state).slice(0, MAX_ROWS);
  let end = rows.length;
  while (end > 0 && isBlankRow(rows[end - 1])) end -= 1;
  for (const row of rows.slice(0, end)) {
    parts.push(
      `r=${encodePart(clip(row.weight, MAX_NUMBER_LENGTH))}~${encodePart(clip(row.score, MAX_SCORE_LENGTH))}~${encodePart(
        clip(row.name, MAX_NAME_LENGTH),
      )}`,
    );
  }
  if (parts.length === 0 && state.mode === defaultMode) return "";
  return [`m=${state.mode}`, ...parts].join("&");
}

/**
 * The state an address fragment describes ("#..." or without "#"). Never
 * throws; anything unknown or malformed is ignored, and a fragment without
 * rows starts with blank ones.
 */
export function decodeState(fragment: string, defaultMode: CalcMode): CalcState {
  const text = (fragment.startsWith("#") ? fragment.slice(1) : fragment).slice(0, MAX_FRAGMENT_LENGTH);
  let mode = defaultMode;
  let scale: GradeScalePreset = "percent";
  let target = "";
  const rows: CalcRow[] = [];
  for (const part of text.split("&")) {
    const eq = part.indexOf("=");
    if (eq <= 0) continue;
    const key = part.slice(0, eq);
    const value = part.slice(eq + 1);
    if (key === "m") {
      if (isMode(value)) mode = value;
    } else if (key === "s") {
      if (isPreset(value)) scale = value;
    } else if (key === "t") {
      target = clip(decodePart(value), MAX_NUMBER_LENGTH);
    } else if (key === "r" && rows.length < MAX_ROWS) {
      const [weight = "", score = "", ...name] = value.split("~");
      rows.push({
        id: rows.length,
        weight: clip(decodePart(weight), MAX_NUMBER_LENGTH),
        score: clip(decodePart(score), MAX_SCORE_LENGTH),
        name: clip(decodePart(name.join("~")), MAX_NAME_LENGTH),
      });
    }
  }
  const state = initialState(mode);
  const list = rows.length > 0 ? rows : emptyRows(START_ROWS);
  if (mode === "ects") {
    state.modules = { target: moduleTarget(target), rows: list };
  } else {
    state.scale = scale;
    state.target = target;
    state.rows = list;
  }
  return state;
}

// ---------------------------------------------------------------------------
// One course
// ---------------------------------------------------------------------------

/** A percentage as typed ("85", "85,5", "85 %"); null when empty, undefined when unreadable. */
function readPercent(text: string): number | null | undefined {
  const t = text.replace(/[%٪]/g, "").trim();
  if (t === "") return null;
  const n = parseLocaleNumber(t);
  return n === null || n < 0 ? undefined : n;
}

/** A target above this is a typo, not a goal (the app's target box uses the same bound). */
const MAX_TARGET = 1000;

export interface CalcResult {
  grade: CourseGrade;
  /** The target in percent, or null (none, or unreadable). */
  target: number | null;
  /** Rows whose weight or score could not be read, by row id (they count as left empty). */
  invalidWeight: Set<number>;
  invalidScore: Set<number>;
  invalidTarget: boolean;
  /** Rows that take part (not blank). */
  counted: number;
}

/** The course mode's rows as the grade math sees them, and its answer. */
export function calculate(state: Pick<CalcState, "rows" | "target">): CalcResult {
  const invalidWeight = new Set<number>();
  const invalidScore = new Set<number>();
  const items: GradeItemInput[] = [];
  for (const row of state.rows) {
    if (isBlankRow(row)) continue;
    const weight = readPercent(row.weight);
    if (weight === undefined) invalidWeight.add(row.id);
    const parsed = parseScoreInput(row.score);
    if (!parsed) invalidScore.add(row.id);
    const scored = parsed?.kind === "score" ? parsed : null;
    items.push({
      id: String(row.id),
      name: row.name.trim(),
      weight: weight ?? null,
      score: scored ? scored.score : null,
      maxScore: scored?.maxScore ?? null,
    });
  }
  const typed = readPercent(state.target);
  const invalidTarget = typed === undefined || (typed !== null && typed > MAX_TARGET);
  const target = invalidTarget ? null : (typed ?? null);
  return {
    grade: computeCourseGrade(items, { target }),
    target,
    invalidWeight,
    invalidScore,
    invalidTarget,
    counted: items.length,
  };
}

// ---------------------------------------------------------------------------
// The German grade average
// ---------------------------------------------------------------------------

export interface ModulesResult {
  average: GermanAverage;
  /** Null without a target. */
  needed: GermanNeeded | null;
  /** The target average, or null. */
  target: number | null;
  /** Rows whose credits or grade could not be read, by row id (they count as left empty). */
  invalidEcts: Set<number>;
  invalidGrade: Set<number>;
  /** Rows graded worse than 4,0, by row id. */
  failed: Set<number>;
  /** Rows that take part (not blank). */
  counted: number;
}

/** The ECTS mode's modules as lib/grades/german sees them, and its answer. */
export function calculateModules(modules: CalcState["modules"]): ModulesResult {
  const invalidEcts = new Set<number>();
  const invalidGrade = new Set<number>();
  const failed = new Set<number>();
  const list: GermanModule[] = [];
  for (const row of modules.rows) {
    if (isBlankRow(row)) continue;
    const ectsText = row.weight.trim();
    const ects = ectsText === "" ? null : parseLocaleNumber(ectsText);
    const ectsOk = ects !== null && ects > 0 && ects <= MAX_MODULE_ECTS;
    if (ectsText !== "" && !ectsOk) invalidEcts.add(row.id);
    const gradeText = row.score.trim();
    const grade = gradeText === "" ? null : parseGermanGrade(gradeText);
    if (gradeText !== "" && grade === null) invalidGrade.add(row.id);
    if (grade !== null && Math.round(grade * 10) > PASS_LIMIT_TENTHS) failed.add(row.id);
    list.push({ ects: ectsOk ? ects : null, grade });
  }
  const goal = parseGermanGrade(modules.target);
  const target = goal !== null && Math.round(goal * 10) <= PASS_LIMIT_TENTHS ? goal : null;
  return {
    average: germanAverage(list),
    needed: target === null ? null : neededAverage(list, target),
    target,
    invalidEcts,
    invalidGrade,
    failed,
    counted: list.length,
  };
}

// ---------------------------------------------------------------------------
// The examples
// ---------------------------------------------------------------------------

export interface ExampleNames {
  problemSets: string;
  labs: string;
  midterm: string;
  final: string;
}

/** The target an example aims for on a scale: 85 %, or the grade of the scale nearest to it. */
function exampleTarget(scale: GradeScalePreset): string {
  const choices = targetChoices(resolveScale(scale));
  if (choices.length === 0) return "85";
  const nearest = choices.reduce((best, band) => (Math.abs(band.min - 85) < Math.abs(best.min - 85) ? band : best));
  return String(nearest.min);
}

/**
 * A course two-thirds through the term, in the visitor's scale: the score
 * formats a student types (a percentage, with a % sign, as points), and the
 * final exam still to come. The ECTS mode keeps what it had.
 */
export function exampleState(names: ExampleNames, state: CalcState): CalcState {
  return {
    ...state,
    mode: "course",
    target: exampleTarget(state.scale),
    rows: [
      { id: 0, name: names.problemSets, weight: "20", score: "92" },
      { id: 1, name: names.labs, weight: "15", score: "88%" },
      { id: 2, name: names.midterm, weight: "25", score: "65/80" },
      { id: 3, name: names.final, weight: "40", score: "" },
    ],
  };
}

export interface ExampleModuleNames {
  math: string;
  programming: string;
  theory: string;
  databases: string;
  statistics: string;
  softwareEngineering: string;
}

/**
 * A Bachelor's in its third semester: four graded modules (one failed, to
 * be retaken), two still open, aiming for a 2,0. Grades are written the
 * visitor's way ("2,3" or "2.3"). The course mode keeps what it had.
 */
export function exampleModules(names: ExampleModuleNames, state: CalcState, locale: string): CalcState {
  const g = (grade: number) => formatGermanGrade(grade, locale);
  return {
    ...state,
    mode: "ects",
    modules: {
      target: "2.0",
      rows: [
        { id: 0, name: names.math, weight: "9", score: g(2.3) },
        { id: 1, name: names.programming, weight: "6", score: g(1.7) },
        { id: 2, name: names.theory, weight: "6", score: g(5.0) },
        { id: 3, name: names.databases, weight: "6", score: g(2.0) },
        { id: 4, name: names.statistics, weight: "6", score: "" },
        { id: 5, name: names.softwareEngineering, weight: "9", score: "" },
      ],
    },
  };
}
