/**
 * Activation and retention for the operator console (/app/admin): do new
 * students stick? Weekly signup cohorts and a 30-day activation funnel, both
 * from ONE aggregate query.
 *
 * Cost: the query starts from the recent signups only (CreditAccount by its
 * createdAt index) and checks each of them with EXISTS probes on that
 * student's own rows (the userId / ownerId indexes), so it grows with the
 * number of recent signups, never with the size of the activity tables.
 *
 * Definitions (all times UTC):
 *  - A signup is a CreditAccount row: every account gets one, with the trial
 *    grant, on first sight. Deleted accounts are erased, so they drop out.
 *  - Left out: the 'local' owner and the operators' own accounts
 *    (STUDYOS_ADMIN_USER_IDS).
 *  - Built a workspace: owns a workspace (trashed ones included), or has a
 *    completed build event (a workspace purged from the trash leaves that).
 *  - Studied: a flashcard or quiz day (StudyDay), a focus-timer block
 *    (FocusSession) or the older study event (evt:study_reviewed).
 *  - Active: what activeStudents (admin-metrics.ts) counts, plus a
 *    focus-timer block: a workspace edit, a study day, a credit charge (an
 *    operator's adjustment is not one) or any app event. Only a workspace's
 *    latest edit is stored, and rate-limit events are pruned after 7 days, so
 *    older windows can only undercount.
 *  - Pro: on Pro now (Subscription status "active"), or ever granted a Pro
 *    month's credits, or recorded buying Pro.
 */
import "server-only";

import { prisma } from "@/lib/db";
import { adminUserIds } from "@/lib/ops/admin";
import { reportError } from "@/lib/ops/report-error";

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;

/** Signup cohorts shown: this week and the 7 before it. */
export const COHORT_WEEKS = 8;
/** The funnel covers the signups of the last this many days. */
export const FUNNEL_DAYS = 30;
/** "Active in week N": any activity this many days after the student's own signup, [from, to). */
export const RETENTION_WINDOWS = {
  week1: { fromDay: 7, toDay: 14 },
  week2: { fromDay: 14, toDay: 21 },
} as const;
/** "Came back on a later day": any activity at least this many days after signing up. */
export const RETURN_AFTER_DAYS = 1;

/** A part of a whole. `rate` is null when there is no whole (nobody signed up). */
export interface Share {
  count: number;
  rate: number | null;
}

export interface CohortRow {
  /** Monday 00:00 UTC of the signup week. */
  weekStart: Date;
  /** True for the week now under way. */
  current: boolean;
  signups: number;
  built: Share;
  studied: Share;
  /** Null while the window has not fully passed for everyone in the cohort (shown blank, never 0%). */
  week1: Share | null;
  week2: Share | null;
  pro: Share;
}

export const FUNNEL_STEPS = ["signedUp", "built", "studied", "returned", "pro"] as const;
export type FunnelKey = (typeof FUNNEL_STEPS)[number];
export type FunnelCounts = Record<FunnelKey, number>;

export interface FunnelStep {
  key: FunnelKey;
  count: number;
  /** count ÷ the step before (null for the first step, or when the step before is 0). */
  fromPrevious: number | null;
  /** count ÷ signups (null when nobody signed up). */
  ofSignups: number | null;
}

export interface ActivationMetrics {
  /** Newest week first. */
  cohorts: CohortRow[];
  funnel: FunnelStep[];
}

/** One signup week as the query returns it. */
export interface CohortQueryRow {
  week: Date;
  signups: number;
  built: number;
  studied: number;
  week1: number;
  week2: number;
  pro: number;
  /** The same week's signups of the last FUNNEL_DAYS, through each funnel step. */
  funnelSignedUp: number;
  funnelBuilt: number;
  funnelStudied: number;
  funnelReturned: number;
  funnelPro: number;
}

// ---- Pure shaping ----------------------------------------------------------------

/** Monday 00:00 UTC of the week `date` falls in. */
export function utcWeekStart(date: Date): Date {
  const midnight = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  const daysSinceMonday = (new Date(midnight).getUTCDay() + 6) % 7;
  return new Date(midnight - daysSinceMonday * DAY_MS);
}

/** The cohort weeks to show, newest (the current week) first. */
export function cohortWeekStarts(now: Date, weeks = COHORT_WEEKS): Date[] {
  const current = utcWeekStart(now).getTime();
  return Array.from({ length: weeks }, (_, i) => new Date(current - i * WEEK_MS));
}

export function share(count: number, of: number): Share {
  return { count, rate: of > 0 ? count / of : null };
}

/**
 * True once a window ending `toDay` days after signup is over for every
 * student who signed up in the week from `weekStart`: the latest of them
 * signed up just before the week ended.
 */
export function windowPassed(weekStart: Date, toDay: number, now: Date): boolean {
  return weekStart.getTime() + WEEK_MS + toDay * DAY_MS <= now.getTime();
}

/** A retention cell: null (blank) until the window has passed for the whole cohort. */
export function retentionShare(
  count: number,
  signups: number,
  weekStart: Date,
  toDay: number,
  now: Date,
): Share | null {
  return windowPassed(weekStart, toDay, now) ? share(count, signups) : null;
}

/** One row per cohort week, newest first; a week nobody signed up in reads zero. */
export function shapeCohorts(rows: readonly CohortQueryRow[], now: Date, weeks = COHORT_WEEKS): CohortRow[] {
  const byWeek = new Map(rows.map((row) => [new Date(row.week).getTime(), row]));
  return cohortWeekStarts(now, weeks).map((weekStart, i) => {
    const row = byWeek.get(weekStart.getTime());
    const signups = row?.signups ?? 0;
    return {
      weekStart,
      current: i === 0,
      signups,
      built: share(row?.built ?? 0, signups),
      studied: share(row?.studied ?? 0, signups),
      week1: retentionShare(row?.week1 ?? 0, signups, weekStart, RETENTION_WINDOWS.week1.toDay, now),
      week2: retentionShare(row?.week2 ?? 0, signups, weekStart, RETENTION_WINDOWS.week2.toDay, now),
      pro: share(row?.pro ?? 0, signups),
    };
  });
}

/** The funnel counts summed over the weeks. */
export function funnelCounts(rows: readonly CohortQueryRow[]): FunnelCounts {
  const sum = (pick: (row: CohortQueryRow) => number) => rows.reduce((total, row) => total + pick(row), 0);
  return {
    signedUp: sum((row) => row.funnelSignedUp),
    built: sum((row) => row.funnelBuilt),
    studied: sum((row) => row.funnelStudied),
    returned: sum((row) => row.funnelReturned),
    pro: sum((row) => row.funnelPro),
  };
}

/** Each step with its rate from the step before and from signup. */
export function funnelSteps(counts: FunnelCounts): FunnelStep[] {
  return FUNNEL_STEPS.map((key, i) => {
    const previous = i === 0 ? null : counts[FUNNEL_STEPS[i - 1]];
    return {
      key,
      count: counts[key],
      fromPrevious: previous === null ? null : share(counts[key], previous).rate,
      ofSignups: share(counts[key], counts.signedUp).rate,
    };
  });
}

/**
 * A rate as a whole percent: "–" when there is nothing to divide by, "<1%"
 * and ">99%" rather than a "0%" or "100%" that is not quite true.
 */
export function rateText(rate: number | null): string {
  if (rate === null || !Number.isFinite(rate)) return "–";
  if (rate > 0 && rate < 0.005) return "<1%";
  if (rate < 1 && rate >= 0.995) return ">99%";
  return `${Math.round(rate * 100)}%`;
}

/** A cohort cell: blank while its window is still open for part of the cohort, never "0%". */
export function shareText(value: Share | null): string {
  return value === null ? "" : rateText(value.rate);
}

// ---- The query -------------------------------------------------------------------

/**
 * Per signup week since `since`: signups and how many built, studied, were
 * active in week 1 and 2 and are or were Pro; and for the signups since
 * `funnelSince`, how many passed each funnel step (each step only counts
 * students who also passed every step before it).
 */
async function cohortQuery(since: Date, funnelSince: Date, excluded: readonly string[]): Promise<CohortQueryRow[]> {
  const { week1, week2 } = RETENTION_WINDOWS;
  return prisma.$queryRaw<CohortQueryRow[]>`
    WITH base AS (
      SELECT a."userId" AS uid, a."createdAt" AS at
      FROM "CreditAccount" a
      WHERE a."createdAt" >= ${since}
        AND a."userId" <> 'local'
        AND NOT (a."userId" = ANY(${[...excluded]}::text[]))
    ),
    -- MATERIALIZED: each student's flags are worked out once. Inlined, every
    -- COUNT(*) FILTER below would repeat the EXISTS probes it names.
    flags AS MATERIALIZED (
      SELECT date_trunc('week', b.at) AS week,
        b.at >= ${funnelSince} AS recent,
        (EXISTS (SELECT 1 FROM "Workspace" w WHERE w."ownerId" = b.uid)
          OR EXISTS (SELECT 1 FROM "UsageEvent" e WHERE e."userId" = b.uid AND e."kind" = 'evt:generate_complete')
        ) AS built,
        (EXISTS (SELECT 1 FROM "StudyDay" s WHERE s."userId" = b.uid)
          OR EXISTS (SELECT 1 FROM "FocusSession" f WHERE f."userId" = b.uid)
          OR EXISTS (SELECT 1 FROM "UsageEvent" e WHERE e."userId" = b.uid AND e."kind" = 'evt:study_reviewed')
        ) AS studied,
        act.week1, act.week2, act.returned,
        (EXISTS (SELECT 1 FROM "Subscription" p WHERE p."userId" = b.uid AND p."status" = 'active')
          OR EXISTS (SELECT 1 FROM "CreditLedger" l WHERE l."userId" = b.uid AND l."reason" = 'pro_monthly')
          OR EXISTS (SELECT 1 FROM "UsageEvent" e WHERE e."userId" = b.uid AND e."kind" = 'evt:purchase_pro')
        ) AS pro
      FROM base b
      -- Was the student active in each window [lo, hi) after their own signup?
      CROSS JOIN LATERAL (
        SELECT COALESCE(bool_or(v.k = 'week1'), false) AS week1,
               COALESCE(bool_or(v.k = 'week2'), false) AS week2,
               COALESCE(bool_or(v.k = 'returned'), false) AS returned
        FROM (VALUES
          ('week1', b.at + make_interval(days => ${week1.fromDay}::int), b.at + make_interval(days => ${week1.toDay}::int)),
          ('week2', b.at + make_interval(days => ${week2.fromDay}::int), b.at + make_interval(days => ${week2.toDay}::int)),
          ('returned', b.at + make_interval(days => ${RETURN_AFTER_DAYS}::int), 'infinity'::timestamp)
        ) AS v (k, lo, hi)
        WHERE EXISTS (SELECT 1 FROM "Workspace" w
                       WHERE w."ownerId" = b.uid AND w."updatedAt" >= v.lo AND w."updatedAt" < v.hi)
           OR EXISTS (SELECT 1 FROM "StudyDay" s
                       WHERE s."userId" = b.uid AND s."updatedAt" >= v.lo AND s."createdAt" < v.hi)
           OR EXISTS (SELECT 1 FROM "FocusSession" f
                       WHERE f."userId" = b.uid AND f."startedAt" >= v.lo AND f."startedAt" < v.hi)
           OR EXISTS (SELECT 1 FROM "CreditLedger" l
                       WHERE l."userId" = b.uid AND l."createdAt" >= v.lo AND l."createdAt" < v.hi
                         AND l."delta" < 0 AND l."reason" <> 'admin_adjust')
           OR EXISTS (SELECT 1 FROM "UsageEvent" e
                       WHERE e."userId" = b.uid AND e."createdAt" >= v.lo AND e."createdAt" < v.hi)
      ) AS act
    )
    SELECT week AS "week",
      COUNT(*)::int AS "signups",
      COUNT(*) FILTER (WHERE built)::int AS "built",
      COUNT(*) FILTER (WHERE studied)::int AS "studied",
      COUNT(*) FILTER (WHERE week1)::int AS "week1",
      COUNT(*) FILTER (WHERE week2)::int AS "week2",
      COUNT(*) FILTER (WHERE pro)::int AS "pro",
      COUNT(*) FILTER (WHERE recent)::int AS "funnelSignedUp",
      COUNT(*) FILTER (WHERE recent AND built)::int AS "funnelBuilt",
      COUNT(*) FILTER (WHERE recent AND built AND studied)::int AS "funnelStudied",
      COUNT(*) FILTER (WHERE recent AND built AND studied AND returned)::int AS "funnelReturned",
      COUNT(*) FILTER (WHERE recent AND built AND studied AND returned AND pro)::int AS "funnelPro"
    FROM flags
    GROUP BY week
    ORDER BY week DESC`;
}

/**
 * The console's activation and retention numbers, or null when they cannot
 * be read (the rest of the console still loads; the error is reported).
 * `excluded`: the operators' own accounts, left out of every number.
 */
export async function activationMetrics(
  now = new Date(),
  excluded: readonly string[] = [...adminUserIds()],
): Promise<ActivationMetrics | null> {
  try {
    const cohortSince = cohortWeekStarts(now).at(-1)!;
    const funnelSince = new Date(now.getTime() - FUNNEL_DAYS * DAY_MS);
    const since = new Date(Math.min(cohortSince.getTime(), funnelSince.getTime()));
    const rows = await cohortQuery(since, funnelSince, excluded);
    return { cohorts: shapeCohorts(rows, now), funnel: funnelSteps(funnelCounts(rows)) };
  } catch (error) {
    reportError(error, { source: "admin", route: "lib/ops/activation-metrics" });
    return null;
  }
}
