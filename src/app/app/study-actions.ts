"use server";

import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/db";
import { computeStreak } from "@/lib/study/streak";
import { isoDay } from "@/lib/study/srs";

const STUDY_KIND = "evt:study_reviewed";

/**
 * Record that the user reviewed cards today (drives the study streak). Called
 * once per review session. Cheap, fire-and-forget, never throws to the client.
 */
export async function recordStudyReviewAction(): Promise<void> {
  const { userId } = await auth();
  if (!userId) return;
  await prisma.usageEvent
    .create({ data: { userId, kind: STUDY_KIND } })
    .catch(() => {});
}

/**
 * The user's current daily study streak (consecutive days with a review) and
 * whether they've studied today. Reads at most ~400 days of review events.
 *
 * Streaks are day-bucketed in the USER's local time — a review at 11pm and one
 * the next evening are consecutive local days even if they straddle a UTC
 * boundary. The client passes its `Date.getTimezoneOffset()` (minutes; positive
 * west of UTC) so the server, which stores UTC timestamps, can shift them to
 * the user's local day before bucketing.
 */
export async function getStudyStatsAction(
  offsetMinutes = 0,
): Promise<{ streak: number; studiedToday: boolean }> {
  const { userId } = await auth();
  if (!userId) return { streak: 0, studiedToday: false };

  const since = new Date();
  since.setDate(since.getDate() - 400);
  const events = await prisma.usageEvent.findMany({
    where: { userId, kind: STUDY_KIND, createdAt: { gte: since } },
    select: { createdAt: true },
  });

  const shift = Number.isFinite(offsetMinutes) ? offsetMinutes * 60_000 : 0;
  const localDay = (d: Date) => isoDay(new Date(d.getTime() - shift));
  const days = Array.from(new Set(events.map((e) => localDay(e.createdAt))));
  const today = localDay(new Date());
  return {
    streak: computeStreak(days, today),
    studiedToday: days.includes(today),
  };
}
