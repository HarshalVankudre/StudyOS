/**
 * Reads what the insights page needs (server-only, owner-scoped).
 *
 * Kept cheap on purpose: every query filters on the student's id and a local
 * day range, which the [userId, localDate] indexes of StudyDay and
 * FocusSession serve, and the database adds rows up (groupBy) so only small
 * per-day and per-course sums come back. The longest range read is the
 * streak's (STREAK_HISTORY_DAYS, at most one row per day); the periods are
 * capped at 90 days, so the comparison reads 180 days at most. Nothing here
 * spends credits or calls a model.
 */
import "server-only";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/db";
import { DEFAULT_TIME_ZONE, studentClock, validTimeZone } from "@/lib/ai/student-clock";
import { reportError } from "@/lib/ops/report-error";
import { shiftDay } from "./days";
import {
  MAX_FOCUS_STARTS,
  STREAK_HISTORY_DAYS,
  buildInsights,
  isStudyDay,
  parsePeriod,
  periodWindows,
  type DayWindow,
  type InsightPeriod,
  type Insights,
  type PeriodTotals,
} from "./insights";

/**
 * Before the per-day record existed, one UsageEvent of this kind was written
 * per review session; the study hub's streak still counts them
 * (app/app/study-actions.ts), so this one does too.
 */
const LEGACY_STUDY_KIND = "evt:study_reviewed";
const DAY_MS = 86_400_000;

/**
 * The zone to read local days in: `candidate` when it is a real IANA zone,
 * else the one the student's daily plan uses, else the one their reminder
 * settings use (so the weekly recap push and this page count the same days),
 * else UTC. Both stored zones default to "UTC", which says nothing about
 * where the student is, so a stored "UTC" defers to the next source.
 */
export async function insightsZone(userId: string, candidate?: unknown): Promise<string> {
  const zone = validTimeZone(candidate);
  if (zone) return zone;
  const [config, reminders] = await Promise.all([
    prisma.dailyStudyAgentConfig.findUnique({ where: { userId }, select: { timeZone: true } }),
    prisma.notificationPreference.findUnique({ where: { userId }, select: { timeZone: true } }),
  ]);
  for (const stored of [config?.timeZone, reminders?.timeZone]) {
    const valid = validTimeZone(stored);
    if (valid && valid !== DEFAULT_TIME_ZONE) return valid;
  }
  return DEFAULT_TIME_ZONE;
}

/** The insights of student `userId` for `period`, with days read in `timeZone`. */
export async function loadInsights(
  userId: string,
  period: InsightPeriod,
  timeZone: string,
  now: Date = new Date(),
): Promise<Insights> {
  const today = studentClock(timeZone, now).date;
  const { current, previous } = periodWindows(period, today);
  const bothPeriods = { gte: previous.from, lte: current.to };
  const thisPeriod = { gte: current.from, lte: current.to };

  const [studyDays, focusDays, courseStudy, courseFocus, focusStarts, legacy] = await Promise.all([
    // One row per local day. Covers the streak's whole window, which holds
    // both periods, so the per-day numbers come from the same rows.
    prisma.studyDay.groupBy({
      by: ["localDate"],
      where: { userId, localDate: { gte: shiftDay(today, -STREAK_HISTORY_DAYS), lte: today } },
      _sum: {
        reviews: true,
        practice: true,
        newCards: true,
        reviewTotal: true,
        reviewPassed: true,
        quizAnswers: true,
        quizCorrect: true,
      },
    }),
    prisma.focusSession.groupBy({
      by: ["localDate"],
      where: { userId, localDate: bothPeriods },
      _sum: { seconds: true },
      _count: { _all: true },
    }),
    prisma.studyDay.groupBy({
      by: ["workspaceId"],
      where: { userId, localDate: thisPeriod },
      _sum: { reviews: true, practice: true, quizAnswers: true, quizCorrect: true },
    }),
    prisma.focusSession.groupBy({
      by: ["workspaceId"],
      where: { userId, localDate: thisPeriod },
      _sum: { seconds: true },
    }),
    // Start times for the time-of-day note: two small columns, this period only.
    prisma.focusSession.findMany({
      where: { userId, localDate: thisPeriod },
      select: { startedAt: true, seconds: true },
      orderBy: { startedAt: "desc" },
      take: MAX_FOCUS_STARTS,
    }),
    prisma.usageEvent.findMany({
      where: {
        userId,
        kind: LEGACY_STUDY_KIND,
        createdAt: { gte: new Date(now.getTime() - (STREAK_HISTORY_DAYS + 1) * DAY_MS) },
      },
      select: { createdAt: true },
    }),
  ]);

  // Names and icons of the student's own workspaces that are not in the
  // trash. Any other id (trashed, purged, or not theirs) becomes "Other".
  const ids = [
    ...new Set([
      ...courseStudy.map((r) => r.workspaceId),
      ...courseFocus.map((r) => r.workspaceId).filter((id): id is string => Boolean(id)),
    ]),
  ];
  const courses =
    ids.length > 0
      ? await prisma.workspace.findMany({
          where: { ownerId: userId, deletedAt: null, id: { in: ids } },
          select: { id: true, name: true, icon: true },
        })
      : [];

  const study = studyDays.map((r) => ({
    localDate: r.localDate,
    reviews: r._sum.reviews ?? 0,
    practice: r._sum.practice ?? 0,
    newCards: r._sum.newCards ?? 0,
    reviewTotal: r._sum.reviewTotal ?? 0,
    reviewPassed: r._sum.reviewPassed ?? 0,
    quizAnswers: r._sum.quizAnswers ?? 0,
    quizCorrect: r._sum.quizCorrect ?? 0,
  }));

  return buildInsights({
    period,
    today,
    timeZone,
    studyDays: study.filter((r) => r.localDate >= previous.from),
    focusDays: focusDays.map((r) => ({
      localDate: r.localDate,
      seconds: r._sum.seconds ?? 0,
      sessions: r._count._all,
    })),
    courseStudy: courseStudy.map((r) => ({
      workspaceId: r.workspaceId,
      reviews: r._sum.reviews ?? 0,
      practice: r._sum.practice ?? 0,
      quizAnswers: r._sum.quizAnswers ?? 0,
      quizCorrect: r._sum.quizCorrect ?? 0,
    })),
    courseFocus: courseFocus.map((r) => ({ workspaceId: r.workspaceId, seconds: r._sum.seconds ?? 0 })),
    courses,
    focusStarts,
    streakDays: [
      ...study.filter(isStudyDay).map((r) => r.localDate),
      ...legacy.map((e) => studentClock(timeZone, e.createdAt).date),
    ],
  });
}

/**
 * Only the totals of student `userId`'s period ending on local day `today`
 * (the headline numbers of the insights page for that period, by the same
 * definitions). For callers without a session, such as the weekly recap
 * notification (lib/notifications), which passes the student's own id and
 * the local day in their zone. Two small grouped queries over the period's
 * days only; no streak history, courses or session starts.
 */
export async function loadPeriodTotals(
  userId: string,
  period: InsightPeriod,
  today: string,
): Promise<{ window: DayWindow; totals: PeriodTotals }> {
  const { current } = periodWindows(period, today);
  const days = { gte: current.from, lte: current.to };
  const [studyDays, focusDays] = await Promise.all([
    prisma.studyDay.groupBy({
      by: ["localDate"],
      where: { userId, localDate: days },
      _sum: {
        reviews: true,
        practice: true,
        newCards: true,
        reviewTotal: true,
        reviewPassed: true,
        quizAnswers: true,
        quizCorrect: true,
      },
    }),
    prisma.focusSession.groupBy({
      by: ["localDate"],
      where: { userId, localDate: days },
      _sum: { seconds: true },
      _count: { _all: true },
    }),
  ]);
  const insights = buildInsights({
    period,
    today,
    // Totals do not depend on the zone (days are stored local already).
    timeZone: DEFAULT_TIME_ZONE,
    studyDays: studyDays.map((r) => ({
      localDate: r.localDate,
      reviews: r._sum.reviews ?? 0,
      practice: r._sum.practice ?? 0,
      newCards: r._sum.newCards ?? 0,
      reviewTotal: r._sum.reviewTotal ?? 0,
      reviewPassed: r._sum.reviewPassed ?? 0,
      quizAnswers: r._sum.quizAnswers ?? 0,
      quizCorrect: r._sum.quizCorrect ?? 0,
    })),
    focusDays: focusDays.map((r) => ({
      localDate: r.localDate,
      seconds: r._sum.seconds ?? 0,
      sessions: r._count._all,
    })),
    courseStudy: [],
    courseFocus: [],
    courses: [],
    focusStarts: [],
    streakDays: [],
  });
  return { window: insights.current, totals: insights.totals };
}

/**
 * The signed-in student's insights for `period` (anything else reads as the
 * default, 7 days), or null when nobody is signed in or they could not be
 * read. Days follow `timeZone` when it is a real zone, else the daily plan's
 * zone, else UTC.
 */
export async function getInsights(
  input: { period?: unknown; timeZone?: string | null } = {},
): Promise<Insights | null> {
  const { userId } = await auth();
  if (!userId) return null;
  try {
    const zone = await insightsZone(userId, input.timeZone);
    return await loadInsights(userId, parsePeriod(input.period), zone);
  } catch (error) {
    reportError(error, { source: "insights", userId });
    return null;
  }
}
