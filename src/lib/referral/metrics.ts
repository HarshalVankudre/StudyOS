/**
 * The invite program's numbers for the operator console (/app/admin):
 * counts and aggregates only, never a whole table (server-only).
 *
 * The top inviters are ranked by the referral_referrer grants in their own
 * ledger, which a friend deleting their account never removes (that friend's
 * Referral row is anonymised, not erased: lib/account/erase-user-data.ts),
 * so a farmer cannot hide by deleting the accounts they invited.
 */
import "server-only";

import { prisma } from "@/lib/db";
import { REFERRAL_REASON_REFERRER, REFERRAL_REASONS } from "./config";

const MONTH_MS = 30 * 24 * 60 * 60 * 1000;
/** Inviters listed in the console, most granted first. */
export const TOP_REFERRERS_SHOWN = 5;
/** Days after a friend's reward in which any study counts as them being active. */
export const ACTIVITY_WINDOW_DAYS = 7;

/** One of the top inviters, with the evidence an operator needs to judge them. */
export interface TopReferrer {
  userId: string;
  /** Inviter bonuses in their own ledger (the ranking). */
  granted: number;
  /** Friends whose referral was rewarded, whatever the inviter got (deleted ones included). */
  rewarded: number;
  /** Of the inviter's friends, those who have since deleted their account. */
  deleted: number;
  /**
   * Rewarded friends, still here, with no flashcard or quiz day, no focus
   * session in the ACTIVITY_WINDOW_DAYS after their reward, and no workspace
   * edited since it (only a workspace's latest edit is stored). A reward
   * under a week old is judged on the days so far.
   */
  inactive: number;
  /** Median time from attribution to the qualifying build, in seconds (null: none built yet). */
  medianToBuildSeconds: number | null;
}

export interface ReferralMetrics {
  codes: { total: number; month: number };
  /** Referrals attributed in the last 30 days, by status. */
  month: { pending: number; rewarded: number; rejected: number };
  /** Rejections of the last 30 days by reason, most first. */
  rejectedBy: { reason: string; count: number }[];
  /** Rewards of the last 30 days by what the inviter got (granted, or why not), most first. */
  inviterOutcomes: { outcome: string; count: number }[];
  /** Credits granted by invites (both sides). */
  credits: { month: number; total: number };
  /** The inviters with the most inviter bonuses, all time: a farming signal. */
  topReferrers: TopReferrer[];
}

/** A median link-to-build time for the console: "45 s", "12 min", "3.5 h", "2.1 d", or "–". */
export function formatBuildDelay(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds) || seconds < 0) return "–";
  if (seconds < 60) return `${Math.round(seconds)} s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)} min`;
  if (seconds < 86_400) return `${(seconds / 3600).toFixed(1)} h`;
  return `${(seconds / 86_400).toFixed(1)} d`;
}

const byCountThenName = <T extends { count: number }>(key: (row: T) => string) => (a: T, b: T) =>
  b.count - a.count || key(a).localeCompare(key(b));

const toNumber = (value: unknown): number => (value === null || value === undefined ? 0 : Number(value));

interface InviterDetail {
  referrerId: string;
  rewarded: number | bigint;
  deleted: number | bigint;
  inactive: number | bigint;
  medianToBuildSeconds: number | null;
}

/** The evidence about `inviterIds`, one aggregate query over their Referral rows. */
async function inviterDetails(inviterIds: string[]): Promise<Map<string, InviterDetail>> {
  if (inviterIds.length === 0) return new Map();
  const days = ACTIVITY_WINDOW_DAYS;
  const rows = await prisma.$queryRaw<InviterDetail[]>`
    SELECT r."referrerId" AS "referrerId",
      COUNT(*) FILTER (WHERE r."status" = 'rewarded')::int AS "rewarded",
      COUNT(*) FILTER (WHERE r."refereeId" IS NULL)::int AS "deleted",
      COUNT(*) FILTER (
        WHERE r."status" = 'rewarded' AND r."refereeId" IS NOT NULL AND r."rewardedAt" IS NOT NULL
          AND NOT EXISTS (
            SELECT 1 FROM "StudyDay" s
            WHERE s."userId" = r."refereeId"
              AND s."updatedAt" >= r."rewardedAt"
              AND s."createdAt" < r."rewardedAt" + make_interval(days => ${days}::int))
          AND NOT EXISTS (
            SELECT 1 FROM "FocusSession" f
            WHERE f."userId" = r."refereeId"
              AND f."startedAt" >= r."rewardedAt"
              AND f."startedAt" < r."rewardedAt" + make_interval(days => ${days}::int))
          AND NOT EXISTS (
            SELECT 1 FROM "Workspace" w
            WHERE w."ownerId" = r."refereeId" AND w."updatedAt" > r."rewardedAt")
      )::int AS "inactive",
      percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (r."qualifiedAt" - r."createdAt"))::float8)
        FILTER (WHERE r."qualifiedAt" IS NOT NULL) AS "medianToBuildSeconds"
    FROM "Referral" r
    WHERE r."referrerId" = ANY(${inviterIds})
    GROUP BY r."referrerId"`;
  return new Map(rows.map((row) => [row.referrerId, row]));
}

export async function referralMetrics(now = new Date()): Promise<ReferralMetrics> {
  const month = new Date(now.getTime() - MONTH_MS);
  const reasons = { in: [...REFERRAL_REASONS] };
  const [codesTotal, codesMonth, statuses, outcomes, creditsMonth, creditsTotal, top] = await Promise.all([
    prisma.referralCode.count(),
    prisma.referralCode.count({ where: { createdAt: { gte: month } } }),
    prisma.referral.groupBy({
      by: ["status", "rejectReason"],
      where: { createdAt: { gte: month } },
      _count: { _all: true },
    }),
    prisma.referral.groupBy({
      by: ["referrerOutcome"],
      where: { status: "rewarded", createdAt: { gte: month } },
      _count: { _all: true },
    }),
    prisma.creditLedger.aggregate({ _sum: { delta: true }, where: { reason: reasons, createdAt: { gte: month } } }),
    prisma.creditLedger.aggregate({ _sum: { delta: true }, where: { reason: reasons } }),
    prisma.creditLedger.groupBy({
      by: ["userId"],
      where: { reason: REFERRAL_REASON_REFERRER },
      _count: { userId: true },
      orderBy: { _count: { userId: "desc" } },
      take: TOP_REFERRERS_SHOWN,
    }),
  ]);
  const details = await inviterDetails(top.map((row) => row.userId));

  const counts = { pending: 0, rewarded: 0, rejected: 0 };
  const rejected = new Map<string, number>();
  for (const row of statuses) {
    const n = row._count._all;
    if (row.status === "pending" || row.status === "rewarded" || row.status === "rejected") counts[row.status] += n;
    if (row.status === "rejected") {
      const reason = row.rejectReason ?? "unknown";
      rejected.set(reason, (rejected.get(reason) ?? 0) + n);
    }
  }
  return {
    codes: { total: codesTotal, month: codesMonth },
    month: counts,
    rejectedBy: [...rejected]
      .map(([reason, count]) => ({ reason, count }))
      .sort(byCountThenName((r) => r.reason)),
    inviterOutcomes: outcomes
      .map((row) => ({ outcome: row.referrerOutcome ?? "unknown", count: row._count._all }))
      .sort(byCountThenName((r) => r.outcome)),
    credits: { month: creditsMonth._sum.delta ?? 0, total: creditsTotal._sum.delta ?? 0 },
    topReferrers: top
      .map((row) => {
        const detail = details.get(row.userId);
        const median = detail?.medianToBuildSeconds;
        return {
          userId: row.userId,
          granted: row._count.userId,
          rewarded: toNumber(detail?.rewarded),
          deleted: toNumber(detail?.deleted),
          inactive: toNumber(detail?.inactive),
          medianToBuildSeconds: median === null || median === undefined ? null : Number(median),
        };
      })
      .sort((a, b) => b.granted - a.granted || a.userId.localeCompare(b.userId)),
  };
}
