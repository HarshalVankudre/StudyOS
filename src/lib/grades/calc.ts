/**
 * Grade math: "what is my grade right now?" and "what do I need on the rest
 * to reach my target?".
 *
 * Everything is in percentages of the course grade. The answers stay honest in
 * the awkward cases and say what they assumed (`notes`), so the UI can show
 * the assumption next to the number instead of a confident wrong answer:
 *   - weights that do not add up to 100 are treated as the whole course
 *     (scaled to 100) and flagged;
 *   - items without a weight share whatever weight is left over, or are left
 *     out when nothing is left, and that is flagged;
 *   - with no weights at all the course is points-based ("out of") or, failing
 *     that, every item counts the same;
 *   - extra credit above 100 % is kept, never clipped;
 *   - a target already secured, out of reach, or decided is said as such.
 *
 * Pure (no React, no DOM, no workspace types): the daily planner can rank
 * courses at risk with the same functions the grades block shows.
 */

/** One piece of graded work as the calculator sees it. */
export interface GradeItemInput {
  id: string;
  name: string;
  /** Percent of the course grade as entered; null when the row has none. */
  weight: number | null;
  /** The score received, in the units of `maxScore`; null = not graded yet. */
  score: number | null;
  /** What the score is out of; null = the score is already a percentage. */
  maxScore: number | null;
  /** Due day (YYYY-MM-DD), for ordering only. */
  due?: string | null;
  /** The row is marked done (used to nudge "done but no score yet"). */
  done?: boolean;
  /**
   * With grading categories: the id of the category the item counts in
   * (absent = it counts on its own weight, or is uncategorised).
   */
  category?: string;
  /** With grading categories: the student said this item counts in none. */
  excluded?: boolean;
}

/** A weighted part of the course grade shared by many items ("Problem sets 20%"). */
export interface GradeCategoryInput {
  id: string;
  name: string;
  /** Percent of the course grade. */
  weight: number;
  /** The lowest N scores do not count. */
  dropLowest?: number;
  /** How many items there will be in all; absent = the items listed. */
  expectedCount?: number;
}

/** Why a number looks the way it does (shown under the result). */
export type GradeNote =
  /** Weights of counted items add up to `sum`, not 100. */
  | { code: "weights_sum"; sum: number }
  /** `count` items had no weight and share the leftover weight (`each` each). */
  | { code: "unweighted_split"; count: number; each: number }
  /** `count` items had no weight and nothing was left over: not counted. */
  | { code: "unweighted_ignored"; count: number }
  /** No weights at all: each item counts by its points ("out of"). */
  | { code: "points_based" }
  /** No weights and no points: every item counts the same. */
  | { code: "equal_weights" }
  /** Some score is above 100 % (extra credit); it is kept as is. */
  | { code: "extra_credit" }
  /** `count` scores are out of 0 or less and cannot be counted. */
  | { code: "invalid_max"; count: number }
  /** `count` items are in no category and have no weight: not counted yet. */
  | { code: "uncategorized"; count: number };

export interface ItemResult {
  id: string;
  name: string;
  due: string | null;
  done: boolean;
  /** Percentage achieved (real, or hypothetical when `hypothetical`). */
  percent: number | null;
  hypothetical: boolean;
  /** Weight actually used, in the course's own units (see `totalWeight`). */
  weight: number;
  /** False when the item is left out (no weight, invalid score). */
  counted: boolean;
  /** The category it counts in (grading categories only). */
  category?: string;
  /** In no category and without a weight: not counted until it gets one. */
  uncategorized?: boolean;
  /** Its category drops the lowest scores and this is one of them (for now). */
  dropped?: boolean;
}

/** How one grading category is doing. */
export interface CategoryResult {
  id: string;
  name: string;
  /** Percent of the course grade, as configured. */
  weight: number;
  /** Average of its scored items (after drops), or null with none scored. */
  percent: number | null;
  /** Listed items with a score (real, or hypothetical in what-if). */
  scored: number;
  /** Items listed in it. */
  listed: number;
  /** Items it is assumed to have in all: the expected count, else the items listed (at least one). */
  count: number;
  /** True when `count` is an assumption (no expected count was given). */
  countAssumed: boolean;
  /** Lowest scores dropped at the end (fewer are dropped while few are scored). */
  dropLowest: number;
  /** Ids of scored items dropped right now. */
  dropped: string[];
  /** Share of the category already decided, 0..1. */
  decidedShare: number;
}

/** Where the student stands against a target. */
export type GradeOutlook =
  /** Everything is graded and the final grade reaches the target. */
  | { kind: "met"; final: number }
  /** Everything is graded and the final grade falls short. */
  | { kind: "missed"; final: number }
  /** Even 0 on everything left still reaches the target. */
  | { kind: "secured" }
  /** An average of `average` % on what is left reaches the target. */
  | { kind: "needed"; average: number }
  /**
   * Even 100 % on everything left falls short: it would take `average` %;
   * the best possible final grade is `best` (only extra credit could help).
   */
  | { kind: "unreachable"; average: number; best: number };

export interface CourseGrade {
  items: ItemResult[];
  /** How weight is assigned: given weights, points, or equal. */
  mode: "weights" | "points" | "equal";
  /** Sum of the weights used (100 when the syllabus adds up). */
  totalWeight: number;
  /** Weight of graded items. */
  decidedWeight: number;
  /** Share of the course grade already decided, 0..1. */
  decidedShare: number;
  /** Weight not graded yet. */
  remainingWeight: number;
  /** Average over graded items, in %, or null when nothing is graded. */
  current: number | null;
  /** Final grade if everything left scores 0 %. */
  floor: number | null;
  /** Final grade if everything left scores 100 %. */
  ceiling: number | null;
  /** The final grade, once everything is graded. */
  final: number | null;
  /** Count of items that count but have no score yet. */
  remainingCount: number;
  notes: GradeNote[];
  /** Null when there is no target or nothing carries weight. */
  outlook: GradeOutlook | null;
  /** Grading categories, when the course has any. */
  categories?: CategoryResult[];
  /** Ids of items in no category and without a weight (grading categories only). */
  uncategorized?: string[];
}

export interface ComputeOptions {
  /** Target percentage for the course. */
  target?: number | null;
  /** Hypothetical percentages for ungraded items, by item id ("what if"). */
  whatIf?: Readonly<Record<string, number>>;
  /**
   * Grading categories of the course. With any, items count in their
   * category (`GradeItemInput.category`) or on their own weight.
   */
  categories?: readonly GradeCategoryInput[];
  /** What-if: a percentage for everything not scored yet, items still to come included. */
  fill?: number;
}

const EPS = 1e-9;

function finite(n: number | null | undefined): n is number {
  return typeof n === "number" && Number.isFinite(n);
}

/** The item's real percentage, "invalid" (out of <= 0), or null when ungraded. */
function realPercent(item: GradeItemInput): number | null | "invalid" {
  if (!finite(item.score)) return null;
  if (item.maxScore === null || item.maxScore === undefined) return item.score;
  if (!finite(item.maxScore) || item.maxScore <= 0) return "invalid";
  return (item.score / item.maxScore) * 100;
}

export function computeCourseGrade(
  inputs: readonly GradeItemInput[],
  options: ComputeOptions = {},
): CourseGrade {
  if (options.categories && options.categories.length > 0) {
    return computeCategorizedGrade(inputs, options.categories, options);
  }
  const notes: GradeNote[] = [];
  const whatIf = withFill(inputs, options);

  // 1) What each item scored (real or hypothetical).
  let invalid = 0;
  const scored = inputs.map((item) => {
    const real = realPercent(item);
    if (real === "invalid") {
      invalid += 1;
      return { item, percent: null, hypothetical: false };
    }
    if (real !== null) return { item, percent: real, hypothetical: false };
    const guess = whatIf[item.id];
    if (finite(guess)) return { item, percent: guess, hypothetical: true };
    return { item, percent: null, hypothetical: false };
  });
  if (invalid > 0) notes.push({ code: "invalid_max", count: invalid });

  // 2) Which weight each item carries.
  const listed = (w: number | null) => finite(w) && w > 0;
  const hasWeights = inputs.some((i) => listed(i.weight));
  let mode: CourseGrade["mode"];
  let weights: number[];
  if (hasWeights) {
    mode = "weights";
    const sumListed = inputs.reduce((s, i) => s + (listed(i.weight) ? (i.weight as number) : 0), 0);
    // A weight of 0 next to real weights is a deliberate "does not count";
    // only a blank is missing. (All zeros reads as "no weights" below.)
    const missing = inputs.filter((i) => !finite(i.weight)).length;
    const leftover = 100 - sumListed;
    const each = missing > 0 && leftover > EPS ? leftover / missing : 0;
    if (missing > 0) {
      notes.push(
        each > 0
          ? { code: "unweighted_split", count: missing, each }
          : { code: "unweighted_ignored", count: missing },
      );
    }
    weights = inputs.map((i) => (listed(i.weight) ? (i.weight as number) : finite(i.weight) ? 0 : each));
  } else if (inputs.some((i) => finite(i.maxScore) && (i.maxScore as number) > 0)) {
    mode = "points";
    notes.push({ code: "points_based" });
    const withoutMax = inputs.filter((i) => !(finite(i.maxScore) && (i.maxScore as number) > 0)).length;
    if (withoutMax > 0) notes.push({ code: "unweighted_ignored", count: withoutMax });
    weights = inputs.map((i) => (finite(i.maxScore) && i.maxScore > 0 ? i.maxScore : 0));
  } else {
    mode = "equal";
    if (inputs.length > 0) notes.push({ code: "equal_weights" });
    weights = inputs.map(() => 1);
  }

  // An unreadable score (out of 0) keeps its weight but counts as not graded
  // yet, so the course total stays right while the note asks for a fix.
  const items: ItemResult[] = scored.map((s, index) => {
    const weight = weights[index];
    return {
      id: s.item.id,
      name: s.item.name,
      due: s.item.due ?? null,
      done: !!s.item.done,
      percent: s.percent,
      hypothetical: s.hypothetical,
      weight,
      counted: weight > 0,
    };
  });

  // 3) Totals.
  const counted = items.filter((i) => i.counted);
  const totalWeight = counted.reduce((s, i) => s + i.weight, 0);
  const graded = counted.filter((i) => i.percent !== null);
  const decidedWeight = graded.reduce((s, i) => s + i.weight, 0);
  const earned = graded.reduce((s, i) => s + i.weight * (i.percent as number), 0);
  const remainingWeight = Math.max(0, totalWeight - decidedWeight);

  if (mode === "weights" && totalWeight > 0 && Math.abs(totalWeight - 100) > 0.01) {
    notes.push({ code: "weights_sum", sum: totalWeight });
  }
  if (counted.some((i) => i.percent !== null && i.percent > 100 + EPS)) {
    notes.push({ code: "extra_credit" });
  }
  if (totalWeight <= 0) {
    // Only an empty course gets here: some item always carries weight otherwise.
    return {
      items,
      mode,
      totalWeight: 0,
      decidedWeight: 0,
      decidedShare: 0,
      remainingWeight: 0,
      current: null,
      floor: null,
      ceiling: null,
      final: null,
      remainingCount: 0,
      notes,
      outlook: null,
    };
  }

  const current = decidedWeight > 0 ? earned / decidedWeight : null;
  const floor = earned / totalWeight;
  const ceiling = (earned + remainingWeight * 100) / totalWeight;
  const done = remainingWeight <= EPS;
  const final = done ? floor : null;

  return {
    items,
    mode,
    totalWeight,
    decidedWeight,
    decidedShare: decidedWeight / totalWeight,
    remainingWeight: done ? 0 : remainingWeight,
    current,
    floor,
    ceiling,
    final,
    remainingCount: counted.filter((i) => i.percent === null).length,
    notes,
    outlook: outlookFor(options.target, { earned, totalWeight, remainingWeight: done ? 0 : remainingWeight, floor, ceiling }),
  };
}

/** What-if percentages, with `fill` given to every item not scored or guessed yet. */
function withFill(inputs: readonly GradeItemInput[], options: ComputeOptions): Readonly<Record<string, number>> {
  const whatIf = options.whatIf ?? {};
  if (!finite(options.fill)) return whatIf;
  const out: Record<string, number> = { ...whatIf };
  for (const item of inputs) {
    if (realPercent(item) === null && !finite(out[item.id])) out[item.id] = options.fill;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Grading categories
// ---------------------------------------------------------------------------

interface Slot {
  /** Item id, or null for an item still to come (not in the list yet). */
  id: string | null;
  /** Relative weight inside the category (1, or the points it is out of). */
  w: number;
  /** Percentage, or null when not scored. */
  p: number | null;
}

interface CategoryState {
  def: GradeCategoryInput;
  slots: Slot[];
  drop: number;
  listed: number;
  countAssumed: boolean;
}

/** Weighted average of a category's slots, `fill` for unscored ones; null when nothing is known. */
function categoryAverage(state: CategoryState, fill: number | null): { average: number | null; dropped: string[] } {
  const known = state.slots
    .map((s) => ({ ...s, p: s.p ?? fill }))
    .filter((s): s is Slot & { p: number } => s.p !== null);
  if (known.length === 0) return { average: null, dropped: [] };
  // Drops apply once there are more scores than drops (as gradebooks do).
  const drop = Math.max(0, Math.min(state.drop, known.length - 1));
  // Lowest first; a real item before an item still to come at the same score.
  const sorted = [...known].sort((a, b) => a.p - b.p || Number(a.id === null) - Number(b.id === null));
  const removed = sorted.slice(0, drop);
  const kept = sorted.slice(drop);
  const totalW = kept.reduce((s, x) => s + x.w, 0);
  const average = totalW > 0 ? kept.reduce((s, x) => s + x.w * x.p, 0) / totalW : null;
  return { average, dropped: removed.flatMap((s) => (s.id ? [s.id] : [])) };
}

type Placement = "category" | "single" | "excluded" | "uncategorized";

/**
 * The course grade when part of it is shared by categories: each category's
 * score is the average of its scored items (equal weights, or by points when
 * items carry an "out of") after dropping the lowest; items with their own
 * weight count on their own; items in neither are listed as not counted yet.
 * Items a category will still get (its expected count beyond the listed
 * ones) count as not scored yet, so "what do I need" spreads what is left
 * over every item still to come, each in proportion to its weight.
 */
function computeCategorizedGrade(
  inputs: readonly GradeItemInput[],
  categories: readonly GradeCategoryInput[],
  options: ComputeOptions,
): CourseGrade {
  const notes: GradeNote[] = [];
  const whatIf = options.whatIf ?? {};
  const fill = finite(options.fill) ? options.fill : null;
  const defs = categories.filter((c) => finite(c.weight) && c.weight > 0);
  const byId = new Map(defs.map((c) => [c.id, c]));

  let invalid = 0;
  const scored = inputs.map((item) => {
    const real = realPercent(item);
    if (real === "invalid") {
      invalid += 1;
      return { item, percent: null as number | null, hypothetical: false };
    }
    if (real !== null) return { item, percent: real as number | null, hypothetical: false };
    const guess = finite(whatIf[item.id]) ? whatIf[item.id] : fill;
    if (finite(guess)) return { item, percent: guess as number | null, hypothetical: true };
    return { item, percent: null as number | null, hypothetical: false };
  });
  if (invalid > 0) notes.push({ code: "invalid_max", count: invalid });

  const placement = (item: GradeItemInput): Placement => {
    if (item.category && byId.has(item.category)) return "category";
    if (finite(item.weight) && item.weight > 0) return "single";
    if (item.excluded || finite(item.weight)) return "excluded";
    return "uncategorized";
  };

  const states = new Map<string, CategoryState>();
  for (const def of defs) {
    const members = scored.filter((s) => placement(s.item) === "category" && s.item.category === def.id);
    const maxes = members.map((m) => m.item.maxScore).filter((m): m is number => finite(m) && m > 0);
    const points = maxes.length > 0;
    const meanMax = points ? maxes.reduce((a, b) => a + b, 0) / maxes.length : 1;
    const w = (item: GradeItemInput) => (points ? (finite(item.maxScore) && item.maxScore > 0 ? item.maxScore : meanMax) : 1);
    const slots: Slot[] = members.map((m) => ({ id: m.item.id, w: w(m.item), p: m.percent }));
    const expected = finite(def.expectedCount) && def.expectedCount > 0 ? Math.round(def.expectedCount) : 0;
    const count = Math.max(expected, slots.length, 1);
    for (let i = slots.length; i < count; i += 1) slots.push({ id: null, w: meanMax, p: fill });
    states.set(def.id, {
      def,
      slots,
      drop: finite(def.dropLowest) ? Math.max(0, Math.floor(def.dropLowest)) : 0,
      listed: members.length,
      countAssumed: expected === 0,
    });
  }

  const singles = scored.filter((s) => placement(s.item) === "single");
  const uncategorized = scored.filter((s) => placement(s.item) === "uncategorized").map((s) => s.item.id);
  if (uncategorized.length > 0) notes.push({ code: "uncategorized", count: uncategorized.length });

  const totalWeight =
    defs.reduce((s, c) => s + c.weight, 0) + singles.reduce((s, x) => s + (x.item.weight as number), 0);

  const currentByCat = new Map<string, { average: number | null; dropped: string[] }>();
  for (const [id, state] of states) currentByCat.set(id, categoryAverage(state, null));
  const droppedIds = new Set([...currentByCat.values()].flatMap((r) => r.dropped));

  const items: ItemResult[] = scored.map((s) => {
    const place = placement(s.item);
    let weight = 0;
    if (place === "single") weight = s.item.weight as number;
    else if (place === "category") {
      const state = states.get(s.item.category as string)!;
      const totalW = state.slots.reduce((sum, x) => sum + x.w, 0);
      const slot = state.slots.find((x) => x.id === s.item.id);
      weight = totalW > 0 && slot ? (state.def.weight * slot.w) / totalW : 0;
    }
    return {
      id: s.item.id,
      name: s.item.name,
      due: s.item.due ?? null,
      done: !!s.item.done,
      percent: s.percent,
      hypothetical: s.hypothetical,
      weight,
      counted: weight > 0,
      ...(place === "category" ? { category: s.item.category } : {}),
      ...(place === "uncategorized" ? { uncategorized: true } : {}),
      ...(droppedIds.has(s.item.id) ? { dropped: true } : {}),
    };
  });

  const categoryResults: CategoryResult[] = [...states.values()].map((state) => {
    const current = currentByCat.get(state.def.id)!;
    return {
      id: state.def.id,
      name: state.def.name,
      weight: state.def.weight,
      percent: current.average,
      scored: state.slots.filter((x) => x.id !== null && x.p !== null).length,
      listed: state.listed,
      count: state.slots.length,
      countAssumed: state.countAssumed,
      dropLowest: state.drop,
      dropped: current.dropped,
      decidedShare: state.slots.filter((x) => x.p !== null).length / state.slots.length,
    };
  });

  if (totalWeight > 0 && Math.abs(totalWeight - 100) > 0.01) notes.push({ code: "weights_sum", sum: totalWeight });
  const counts = (s: (typeof scored)[number]) => placement(s.item) === "category" || placement(s.item) === "single";
  if (scored.some((s) => counts(s) && s.percent !== null && s.percent > 100 + EPS)) notes.push({ code: "extra_credit" });

  const remainingCount =
    [...states.values()].reduce((n, st) => n + st.slots.filter((x) => x.p === null).length, 0) +
    singles.filter((s) => s.percent === null).length;

  if (totalWeight <= 0) {
    return {
      items,
      mode: "weights",
      totalWeight: 0,
      decidedWeight: 0,
      decidedShare: 0,
      remainingWeight: 0,
      current: null,
      floor: null,
      ceiling: null,
      final: null,
      remainingCount: 0,
      notes,
      outlook: null,
      categories: categoryResults,
      uncategorized,
    };
  }

  /** The course grade if everything not scored yet scores `rest`. */
  const courseAt = (rest: number): number => {
    let sum = 0;
    for (const state of states.values()) sum += state.def.weight * (categoryAverage(state, rest).average ?? rest);
    for (const s of singles) sum += (s.item.weight as number) * (s.percent ?? rest);
    return sum / totalWeight;
  };

  let earnedWeight = 0;
  let earned = 0;
  for (const result of categoryResults) {
    if (result.percent === null) continue;
    earnedWeight += result.weight;
    earned += result.weight * result.percent;
  }
  for (const s of singles) {
    if (s.percent === null) continue;
    earnedWeight += s.item.weight as number;
    earned += (s.item.weight as number) * s.percent;
  }
  const current = earnedWeight > 0 ? earned / earnedWeight : null;
  const decidedWeight =
    categoryResults.reduce((s, c) => s + c.weight * c.decidedShare, 0) +
    singles.filter((s) => s.percent !== null).reduce((s, x) => s + (x.item.weight as number), 0);
  const done = remainingCount === 0;
  const floor = courseAt(0);
  const ceiling = courseAt(100);

  return {
    items,
    mode: "weights",
    totalWeight,
    decidedWeight,
    decidedShare: Math.min(1, decidedWeight / totalWeight),
    remainingWeight: done ? 0 : Math.max(0, totalWeight - decidedWeight),
    current,
    floor,
    ceiling,
    final: done ? floor : null,
    remainingCount,
    notes,
    outlook: categorizedOutlook(options.target, { done, floor, ceiling, courseAt }),
    categories: categoryResults,
    uncategorized,
  };
}

/** "What do I need" by search: with drops the grade bends, but it still rises with the average. */
function categorizedOutlook(
  target: number | null | undefined,
  t: { done: boolean; floor: number; ceiling: number; courseAt: (rest: number) => number },
): GradeOutlook | null {
  if (!finite(target)) return null;
  if (t.done) return t.floor >= target - EPS ? { kind: "met", final: t.floor } : { kind: "missed", final: t.floor };
  if (t.floor >= target - EPS) return { kind: "secured" };
  const solve = (lo: number, hi: number) => {
    for (let i = 0; i < 60; i += 1) {
      const mid = (lo + hi) / 2;
      if (t.courseAt(mid) >= target - EPS) hi = mid;
      else lo = mid;
    }
    return hi;
  };
  if (t.ceiling < target - EPS) {
    const average = t.courseAt(10_000) >= target - EPS ? solve(100, 10_000) : 10_000;
    return { kind: "unreachable", average, best: t.ceiling };
  }
  return { kind: "needed", average: solve(0, 100) };
}

function outlookFor(
  target: number | null | undefined,
  t: { earned: number; totalWeight: number; remainingWeight: number; floor: number; ceiling: number },
): GradeOutlook | null {
  if (!finite(target)) return null;
  if (t.remainingWeight <= EPS) {
    return t.floor >= target - EPS ? { kind: "met", final: t.floor } : { kind: "missed", final: t.floor };
  }
  if (t.floor >= target - EPS) return { kind: "secured" };
  const average = (target * t.totalWeight - t.earned) / t.remainingWeight;
  if (average > 100 + EPS) return { kind: "unreachable", average, best: t.ceiling };
  return { kind: "needed", average: Math.max(0, average) };
}

// ---------------------------------------------------------------------------
// Risk (for the daily planner and for sorting)
// ---------------------------------------------------------------------------

export type CourseRisk = "unknown" | "safe" | "on_track" | "at_risk" | "critical";

/**
 * How worried to be about a course against its target:
 *   critical - the target is out of reach, or was missed;
 *   at_risk  - it takes clearly more than the student averages so far
 *              (5 points or more above), or 90 % and up with no history;
 *   on_track - within reach of the current average;
 *   safe     - secured or met;
 *   unknown  - no target, or no weights to reason about.
 */
export function courseRisk(grade: CourseGrade): CourseRisk {
  const o = grade.outlook;
  if (!o) return "unknown";
  switch (o.kind) {
    case "met":
    case "secured":
      return "safe";
    case "missed":
    case "unreachable":
      return "critical";
    case "needed":
      if (grade.current === null) return o.average >= 90 ? "at_risk" : "on_track";
      return o.average > grade.current + 5 ? "at_risk" : "on_track";
  }
}

// ---------------------------------------------------------------------------
// Several courses: credit-weighted summary
// ---------------------------------------------------------------------------

export interface SummaryCourseInput {
  key: string;
  /** The course percentage to summarize (current, or what-if), or null. */
  percent: number | null;
  /** Grade points of that percentage under the scale, when it has points. */
  points: number | null;
  /** Credits (ECTS, units...) of the course, or null when unknown. */
  credits: number | null;
}

export interface GradeSummary {
  /** Credit-weighted (or equal) mean of course percentages. */
  average: number | null;
  /** Credit-weighted (or equal) mean of grade points (GPA), when the scale has points. */
  points: number | null;
  /** "credits" when every graded course has credits; otherwise "equal". */
  weighting: "credits" | "equal";
  /** Courses that went into the summary. */
  counted: number;
  /** Total credits of counted courses (credits weighting only). */
  credits: number;
  /** Courses with no grade yet (left out). */
  ungraded: number;
  /** Graded courses with no credits (only reported when some others have credits). */
  missingCredits: string[];
}

export function summarizeCourses(courses: readonly SummaryCourseInput[]): GradeSummary {
  const graded = courses.filter((c) => finite(c.percent));
  const ungraded = courses.length - graded.length;
  const hasCredits = (c: SummaryCourseInput) => finite(c.credits) && (c.credits as number) > 0;
  const withCredits = graded.filter(hasCredits);
  const byCredits = graded.length > 0 && withCredits.length === graded.length;
  const missingCredits =
    withCredits.length > 0 && !byCredits ? graded.filter((c) => !hasCredits(c)).map((c) => c.key) : [];
  const weightOf = (c: SummaryCourseInput) => (byCredits ? (c.credits as number) : 1);

  const total = graded.reduce((s, c) => s + weightOf(c), 0);
  const average = total > 0 ? graded.reduce((s, c) => s + weightOf(c) * (c.percent as number), 0) / total : null;
  const pointed = graded.filter((c) => finite(c.points));
  const pointsTotal = pointed.reduce((s, c) => s + weightOf(c), 0);
  const points =
    pointed.length > 0 && pointed.length === graded.length && pointsTotal > 0
      ? pointed.reduce((s, c) => s + weightOf(c) * (c.points as number), 0) / pointsTotal
      : null;

  return {
    average,
    points,
    weighting: byCredits ? "credits" : "equal",
    counted: graded.length,
    credits: byCredits ? total : 0,
    ungraded,
    missingCredits,
  };
}

// ---------------------------------------------------------------------------
// Typing a score on a phone
// ---------------------------------------------------------------------------

export type ParsedScore =
  | { kind: "clear" }
  | { kind: "score"; score: number; maxScore?: number };

/**
 * Read what a student typed into a score box: "87", "87.5", "87,5", "87 %",
 * "42/50", "42 / 50,5". Empty clears the score. Returns null for anything
 * else (the box then keeps its old value).
 */
export function parseScoreInput(text: string): ParsedScore | null {
  const t = text.trim().replace(/[%٪]/g, "").trim();
  if (t === "") return { kind: "clear" };
  const parts = t.split(/\s*[/／]\s*/);
  if (parts.length > 2) return null;
  const nums = parts.map(parseLocaleNumber);
  if (nums.some((n) => n === null)) return null;
  const [score, max] = nums as number[];
  if (score < 0) return null;
  if (parts.length === 2) {
    if (max <= 0) return null;
    return { kind: "score", score, maxScore: max };
  }
  return { kind: "score", score };
}

/** "87.5" or "87,5" (and Arabic-Indic digits) as a number; null otherwise. */
export function parseLocaleNumber(text: string): number | null {
  let t = text.trim().replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660)).replace(/٫/g, ".");
  if (/^-?\d+,\d+$/.test(t)) t = t.replace(",", ".");
  if (!/^-?(\d+\.?\d*|\.\d+)$/.test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}
