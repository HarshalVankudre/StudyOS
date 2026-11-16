/**
 * The grades overview: where the student stands in every course at once.
 *
 * Every grade tracker block of every workspace is read through the same
 * function the block itself renders (`buildGradeReport`), so the overview
 * never computes a grade the tracker would not show: current grade, target,
 * what is needed on the rest and how much is decided all come from
 * src/lib/grades/calc.ts. This file only picks the trackers, names the
 * courses, finds the next assessment, sorts by what needs attention and
 * decides when an overall figure across courses means something.
 *
 * Overall figures never mix grading scales: courses are grouped by scale
 * family (percentages, US letters and GPA, UK classes, German grades) and a
 * family gets a figure only with at least two graded courses. US courses get
 * a GPA from their grade points, UK courses an average mark with its class,
 * percentage courses an average, all weighted by credits when every graded
 * course has them and equally (and labelled so) otherwise. German grades get
 * the Notenschnitt (lib/grades/german.ts): the ECTS-weighted mean of the
 * passed courses, cut after the first decimal, only when the ECTS of every
 * passed course are known; without them the family says so instead. A
 * tracker of module grades (lib/grades/modules.ts) gives one card per module
 * with its grade and credits, and its modules count in that same average;
 * a percentage course on German grades counts with the grade of its band.
 *
 * Pure (no React, no database): overview-store.ts reads the workspaces.
 */
import type { GradesBlock, Page, Workspace } from "@/lib/workspace/types";
import { workspaceHref } from "@/lib/workspace/deep-link";
import { isDayKey } from "@/lib/workspace/view-logic";
import { summarizeCourses, type CourseRisk, type GradeOutlook, type GradeSummary } from "./calc";
import { germanAverage, type GermanModule } from "./german";
import { buildModuleReport, isGradeEntry, type ModuleRow, type ModuleStatus } from "./modules";
import { pointsFor, resolveScale, type ScaleDefinition, type UkClassLabels } from "./scales";
import { ALL_COURSES_KEY, buildGradeReport, type CourseReport, type GradeReport } from "./workspace";

/** Most workspaces read for the overview (most recently updated first). */
export const MAX_OVERVIEW_WORKSPACES = 60;
/** Most course cards shown. */
export const MAX_OVERVIEW_COURSES = 200;

/** The next piece of graded work still to come in a course. */
export interface NextAssessment {
  title: string;
  /** YYYY-MM-DD. */
  due: string;
  /** Percent of the course grade as the tracker counts it. */
  weight: number;
}

/** One course card. */
export interface OverviewCourse {
  /** Unique across the overview. */
  id: string;
  workspaceId: string;
  workspaceName: string;
  workspaceIcon: string | null;
  /**
   * The course's name when the tracker covers several courses ("" for a
   * course without a name); null when the tracker is the workspace's course.
   */
  course: string | null;
  /** The tracker's name (block title, else page title) when the workspace has several. */
  tracker: string | null;
  color?: string;
  scale: ScaleDefinition;
  credits: number | null;
  /** Percentage so far over graded work, or null with nothing graded. */
  current: number | null;
  /** Target percentage, or null without one. */
  target: number | null;
  outlook: GradeOutlook | null;
  risk: CourseRisk;
  /** The average (%) needed on the rest for the target, when there is one to name. */
  needed: number | null;
  /** True when `needed` can still be scored (100 % or less), false when not, null without `needed`. */
  achievable: boolean | null;
  /** Share of the course grade already decided, 0..1. */
  decidedShare: number;
  /** Weight of the course still open, in percent of the grade (0..100). */
  remainingShare: number;
  /** The course has weighted work to reason about. */
  hasWork: boolean;
  /** The weights do not add up to 100 (the tracker says so). */
  weightsOff: boolean;
  /** Assessments with a score. */
  graded: number;
  /** Assessments still to be graded (those a category still expects included). */
  upcoming: number;
  next: NextAssessment | null;
  /** The tracker block, opened and highlighted. */
  href: string;
  /**
   * Set on a module of a tracker of module grades: its German grade (null
   * while open or when the cell holds no grade) and where it stands. Such a
   * card has no percentages (`current` and `target` are null).
   */
  module?: { grade: number | null; status: ModuleStatus };
}

/** A grade tracker that is in a workspace but not set up yet. */
export interface UnsetTracker {
  id: string;
  workspaceId: string;
  workspaceName: string;
  workspaceIcon: string | null;
  href: string;
}

/** How grades are written; courses are only ever averaged within one family. */
export type ScaleFamily = "percent" | "us" | "uk" | "de";

export const SCALE_FAMILIES: readonly ScaleFamily[] = ["percent", "us", "uk", "de"];

export function scaleFamily(scale: Pick<ScaleDefinition, "preset">): ScaleFamily {
  switch (scale.preset) {
    case "us_letter":
    case "us_gpa":
      return "us";
    case "uk_degree":
      return "uk";
    case "de_grade":
      return "de";
    default:
      return "percent";
  }
}

/** The overall figure of one scale family. */
export interface OverallGroup {
  family: ScaleFamily;
  /**
   *   gpa     - mean grade points of US courses (higher is better);
   *   german  - mean German grade (1,0 is best);
   *   average - mean percentage (percentage courses, UK courses, US courses
   *             whose scale has no grade points).
   */
  kind: "gpa" | "german" | "average";
  /** The figure; null when it cannot be given (see `reason`). */
  value: number | null;
  /**
   * The scale to write `value` in: grade points for gpa/german, the class of
   * the average for UK courses that share one scale; null = a plain percentage.
   */
  scale: ScaleDefinition | null;
  /** True when every US course in the family uses letters (none GPA). */
  letters: boolean;
  summary: GradeSummary;
  /** Courses of the family (graded or not). */
  courses: number;
  /** Graded courses without credits, by name, when others have credits. */
  missingCredits: string[];
  /** German grades without the ECTS of every graded course: no average. */
  reason?: "needs_credits";
}

export interface GradesOverall {
  groups: OverallGroup[];
  /** The courses use more than one scale family, so each family has its own figure. */
  mixed: boolean;
}

export interface GradesOverview {
  /** Sorted: what needs attention first. */
  courses: OverviewCourse[];
  /** Null when no overall figure means anything. */
  overall: GradesOverall | null;
  unset: UnsetTracker[];
  /** The student's local day the overview was made for. */
  today: string;
}

export interface OverviewOptions {
  /** The student's local day (YYYY-MM-DD): "next" means due today or later. */
  today: string;
  ukLabels?: UkClassLabels;
}

// ---------------------------------------------------------------------------
// Finding the trackers
// ---------------------------------------------------------------------------

interface FoundTracker {
  page: Page;
  block: GradesBlock;
  report: GradeReport | null;
  ready: boolean;
}

const hasTargets = (block: GradesBlock) =>
  typeof block.defaultTarget === "number" || Object.keys(block.targets ?? {}).length > 0;

/** Pages in reading order: the home page first, then the rest as listed. */
function pagesInOrder(ws: Workspace): Page[] {
  const home = ws.pages.find((p) => p.id === ws.homePageId);
  return home ? [home, ...ws.pages.filter((p) => p !== home)] : ws.pages;
}

/**
 * The trackers of a workspace, set up ones first in page order. Two blocks
 * over the same list of graded work (one on the home page, one on a grades
 * page) show the same courses: only one counts, the first with targets of
 * its own, else the first one. A block counts as set up exactly when the
 * block itself stops asking for setup (a list and a score column).
 */
function trackersOf(ws: Workspace, ukLabels?: UkClassLabels): { ready: FoundTracker[]; unset: FoundTracker[] } {
  const found: FoundTracker[] = [];
  for (const page of pagesInOrder(ws)) {
    for (const block of page.blocks) {
      if (block.type !== "grades") continue;
      const report = buildGradeReport(ws, block, { ukLabels });
      found.push({ page, block, report, ready: Boolean(block.databaseId && report?.columns.score) });
    }
  }
  const byDatabase = new Map<string, FoundTracker>();
  for (const tracker of found) {
    if (!tracker.ready) continue;
    const id = tracker.report!.database.id;
    const kept = byDatabase.get(id);
    if (!kept || (!hasTargets(kept.block) && hasTargets(tracker.block))) byDatabase.set(id, tracker);
  }
  const ready = found.filter((t) => t.ready && byDatabase.get(t.report!.database.id) === t);
  return { ready, unset: found.filter((t) => !t.ready) };
}

// ---------------------------------------------------------------------------
// One course
// ---------------------------------------------------------------------------

function dayOf(value: string | null): string | null {
  if (!value) return null;
  const day = value.slice(0, 10);
  return isDayKey(day) ? day : null;
}

/** The earliest graded work due today or later that has no score and is not done yet. */
export function nextAssessment(course: CourseReport, today: string): NextAssessment | null {
  let best: NextAssessment | null = null;
  for (const item of course.grade.items) {
    if (!item.counted || item.percent !== null || item.done) continue;
    const due = dayOf(item.due);
    if (!due || due < today) continue;
    const title = item.name.trim();
    if (!best || due < best.due || (due === best.due && title.localeCompare(best.title) < 0)) {
      best = { title, due, weight: item.weight };
    }
  }
  return best;
}

/** Scored and still-open assessments, counted as the tracker counts them. */
export function assessmentCounts(course: CourseReport): { graded: number; upcoming: number } {
  const grade = course.grade;
  const counted = course.categories.length > 0 ? grade.items.filter((i) => i.counted) : grade.items;
  return { graded: counted.filter((i) => i.percent !== null).length, upcoming: grade.remainingCount };
}

/** "What is needed on the rest" as a number, and whether it can still be scored. */
export function neededOnRest(outlook: GradeOutlook | null): { needed: number | null; achievable: boolean | null } {
  if (outlook?.kind === "needed") return { needed: outlook.average, achievable: true };
  if (outlook?.kind === "unreachable") return { needed: outlook.average, achievable: false };
  return { needed: null, achievable: null };
}

function moduleCard(
  ws: Workspace,
  tracker: FoundTracker,
  row: ModuleRow,
  trackerName: string | null,
): OverviewCourse {
  const graded = row.grade !== null;
  const open = row.status === "open";
  return {
    id: `${ws.id}:${tracker.block.id}:${row.id}`,
    workspaceId: ws.id,
    workspaceName: ws.name,
    workspaceIcon: ws.icon ?? null,
    course: row.name,
    tracker: trackerName,
    scale: tracker.report!.scale,
    credits: row.credits,
    current: null,
    target: null,
    outlook: null,
    risk: "unknown",
    needed: null,
    achievable: null,
    decidedShare: graded ? 1 : 0,
    remainingShare: open ? 100 : 0,
    hasWork: true,
    weightsOff: false,
    graded: graded ? 1 : 0,
    upcoming: open ? 1 : 0,
    next: null,
    href: workspaceHref({ workspaceId: ws.id, pageId: tracker.page.id, blockId: tracker.block.id }),
    module: { grade: row.grade, status: row.status },
  };
}

function courseCard(
  ws: Workspace,
  tracker: FoundTracker,
  course: CourseReport,
  named: boolean,
  trackerName: string | null,
  today: string,
): OverviewCourse {
  const grade = course.grade;
  const { needed, achievable } = neededOnRest(grade.outlook);
  const { graded, upcoming } = assessmentCounts(course);
  return {
    id: `${ws.id}:${tracker.block.id}:${course.key}`,
    workspaceId: ws.id,
    workspaceName: ws.name,
    workspaceIcon: ws.icon ?? null,
    course: named ? course.label : null,
    tracker: trackerName,
    ...(course.color ? { color: course.color } : {}),
    scale: tracker.report!.scale,
    credits: course.credits,
    current: grade.current,
    target: course.target,
    outlook: grade.outlook,
    risk: course.risk,
    needed,
    achievable,
    decidedShare: grade.decidedShare,
    remainingShare: grade.totalWeight > 0 ? (grade.remainingWeight / grade.totalWeight) * 100 : 0,
    hasWork: grade.totalWeight > 0,
    weightsOff: grade.notes.some((n) => n.code === "weights_sum"),
    graded,
    upcoming,
    next: nextAssessment(course, today),
    href: workspaceHref({ workspaceId: ws.id, pageId: tracker.page.id, blockId: tracker.block.id }),
  };
}

/** The course cards of one workspace's trackers, and its trackers still to set up. */
export function workspaceCourses(
  ws: Workspace,
  options: OverviewOptions,
): { courses: OverviewCourse[]; unset: UnsetTracker[] } {
  const { ready, unset } = trackersOf(ws, options.ukLabels);
  const courses: OverviewCourse[] = [];
  for (const tracker of ready) {
    const report = tracker.report!;
    const trackerName =
      ready.length > 1 ? tracker.block.title?.trim() || tracker.page.title.trim() || null : null;
    if (isGradeEntry(tracker.block)) {
      // Module grades: every row is a module, never a percentage.
      for (const row of buildModuleReport(ws, tracker.block)?.modules ?? []) {
        courses.push(moduleCard(ws, tracker, row, trackerName));
      }
      continue;
    }
    // A tracker without a course column is the workspace's own course. With
    // one, every course is a card; rows in no course only when nothing else is.
    const named = report.courses.filter((c) => c.key !== "" && c.key !== ALL_COURSES_KEY);
    const list = named.length > 0 ? named : report.courses;
    for (const course of list) {
      courses.push(courseCard(ws, tracker, course, named.length > 0, trackerName, options.today));
    }
  }
  // A workspace with a working tracker does not also ask about a leftover empty one.
  const pending: UnsetTracker[] =
    ready.length > 0
      ? []
      : unset.map((t) => ({
          id: `${ws.id}:${t.block.id}`,
          workspaceId: ws.id,
          workspaceName: ws.name,
          workspaceIcon: ws.icon ?? null,
          href: workspaceHref({ workspaceId: ws.id, pageId: t.page.id, blockId: t.block.id }),
        }));
  return { courses, unset: pending };
}

// ---------------------------------------------------------------------------
// Order: what needs attention first
// ---------------------------------------------------------------------------

/**
 * 0 - a target with an average still needed on the rest (out of reach included);
 * 1 - work still to come but no target yet;
 * 2 - the target is secured;
 * 3 - finished, or nothing to grade.
 */
function attentionTier(c: OverviewCourse): number {
  if (c.needed !== null) return 0;
  if (c.outlook === null && c.upcoming > 0) return 1;
  if (c.outlook?.kind === "secured") return 2;
  return 3;
}

/**
 * Needs attention first: the higher the average needed on the rest (closest
 * to or above 100 %), the earlier; then the next assessment soonest (undated
 * last); then by name.
 */
export function compareAttention(a: OverviewCourse, b: OverviewCourse): number {
  const tier = attentionTier(a) - attentionTier(b);
  if (tier !== 0) return tier;
  if (a.needed !== null && b.needed !== null && Math.abs(a.needed - b.needed) > 1e-9) return b.needed - a.needed;
  const due = (a.next?.due ?? "~").localeCompare(b.next?.due ?? "~");
  if (due !== 0) return due;
  const name = (c: OverviewCourse) => `${c.course ?? c.tracker ?? ""} ${c.workspaceName}`;
  return name(a).localeCompare(name(b)) || a.id.localeCompare(b.id);
}

// ---------------------------------------------------------------------------
// Overall
// ---------------------------------------------------------------------------

const courseName = (c: OverviewCourse) => c.course || c.tracker || c.workspaceName;

function sameBands(courses: readonly OverviewCourse[]): boolean {
  const first = JSON.stringify(courses[0]?.scale.bands ?? []);
  return courses.every((c) => JSON.stringify(c.scale.bands) === first);
}

/** The German grade of a card: a module's own, else the band of its percentage. */
function germanGradeOf(c: OverviewCourse): number | null {
  if (c.module) return c.module.grade;
  return c.current === null ? null : pointsFor(c.current, c.scale);
}

/**
 * The Notenschnitt of German courses (lib/grades/german.ts): ECTS-weighted,
 * passed courses only, cut after the first decimal when written
 * (formatPoints). Without the ECTS of every passed course there is none.
 */
function germanOverall(courses: readonly OverviewCourse[]): OverallGroup | null {
  const list: GermanModule[] = courses.map((c) => ({
    ects: c.credits,
    grade: germanGradeOf(c),
    counts: c.module?.status !== "invalid",
  }));
  const average = germanAverage(list);
  if (average.mean === null) return null;
  const byEcts = average.weighting === "ects";
  const passedWithout = courses.filter((c, i) => {
    const grade = list[i].grade;
    return grade !== null && grade <= 4 && !(typeof c.credits === "number" && c.credits > 0);
  });
  const summary: GradeSummary = {
    average: null,
    points: byEcts ? average.mean : null,
    weighting: byEcts ? "credits" : "equal",
    counted: average.passed,
    credits: byEcts ? average.earnedEcts : 0,
    ungraded: average.open,
    missingCredits: [],
  };
  const base = {
    family: "de" as const,
    kind: "german" as const,
    summary,
    courses: courses.length,
    missingCredits: byEcts ? [] : passedWithout.map(courseName),
    letters: false,
    scale: resolveScale("de_grade"),
  };
  if (!byEcts) return { ...base, value: null, reason: "needs_credits" };
  return { ...base, value: average.mean };
}

/** The overall figure of one family, or null when it would not mean anything. */
function familyOverall(family: ScaleFamily, courses: readonly OverviewCourse[]): OverallGroup | null {
  if (family === "de") {
    // At least two graded courses, as in every family.
    return courses.filter((c) => germanGradeOf(c) !== null).length < 2 ? null : germanOverall(courses);
  }
  const graded = courses.filter((c) => c.current !== null);
  if (graded.length < 2) return null;
  const summary = summarizeCourses(
    courses.map((c) => ({
      key: c.id,
      percent: c.current,
      // Each course's own thresholds give its points.
      points: c.current === null ? null : pointsFor(c.current, c.scale),
      credits: c.credits,
    })),
  );
  const names = new Map(courses.map((c) => [c.id, courseName(c)]));
  const missingCredits = summary.missingCredits.map((key) => names.get(key) ?? key);
  const base = { family, summary, courses: courses.length, missingCredits, letters: false };

  if (family === "us") {
    const letters = courses.every((c) => c.scale.preset === "us_letter");
    if (summary.points !== null) {
      return { ...base, letters, kind: "gpa", value: summary.points, scale: resolveScale("us_gpa") };
    }
    // Custom letters without grade points: the average mark is all there is.
    return { ...base, letters, kind: "average", value: summary.average, scale: null };
  }
  if (family === "uk") {
    // The class of the average, when every course draws the classes at the same marks.
    return { ...base, kind: "average", value: summary.average, scale: sameBands(courses) ? courses[0].scale : null };
  }
  return { ...base, kind: "average", value: summary.average, scale: null };
}

/** Overall figures by scale family; null when none means anything. */
export function overallOf(courses: readonly OverviewCourse[]): GradesOverall | null {
  const families = SCALE_FAMILIES.filter((f) => courses.some((c) => scaleFamily(c.scale) === f));
  const groups = families
    .map((f) => familyOverall(f, courses.filter((c) => scaleFamily(c.scale) === f)))
    .filter((g): g is OverallGroup => g !== null);
  if (groups.length === 0) return null;
  return { groups, mixed: families.length > 1 };
}

// ---------------------------------------------------------------------------
// Everything
// ---------------------------------------------------------------------------

/** The overview of these workspaces (already the student's own, none in the trash). */
export function buildGradesOverview(workspaces: readonly Workspace[], options: OverviewOptions): GradesOverview {
  const courses: OverviewCourse[] = [];
  const unset: UnsetTracker[] = [];
  for (const ws of workspaces) {
    const found = workspaceCourses(ws, options);
    courses.push(...found.courses);
    unset.push(...found.unset);
  }
  courses.sort(compareAttention);
  const shown = courses.slice(0, MAX_OVERVIEW_COURSES);
  return { courses: shown, overall: overallOf(shown), unset, today: options.today };
}
