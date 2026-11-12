"use server";

import { auth } from "@clerk/nextjs/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { DAY_RE, dayAtOffset, safeOffset, shiftDay, utcDay } from "@/lib/study/days";
import { EMPTY_STREAK, streakStatus, type StreakStatus } from "@/lib/study/streak";
import {
  COUNT_KEYS,
  collectCards,
  dueForecast,
  retentionRate,
  reviewsPerDay,
  totals,
  type DayCounts,
  type DayPoint,
  type DayRow,
  type ForecastPoint,
} from "@/lib/study/stats";
import type { ReviewBatch } from "@/lib/study/recorder";

/**
 * Before the per-day record existed, one UsageEvent of this kind was written
 * per review session. Those still count toward the streak so nobody's streak
 * resets when this ships; new sessions write StudyDay rows instead.
 */
const LEGACY_STUDY_KIND = "evt:study_reviewed";
/** How far back the streak looks. */
const HISTORY_DAYS = 400;
const MAX_PER_BATCH = 5_000;

// A missing counter is 0, so a tab still running an older build (which does
// not send the newer counters, e.g. quiz answers) keeps recording its reviews.
const count = z.number().int().min(0).max(MAX_PER_BATCH).default(0);
const batchSchema = z.object({
  workspaceId: z.string().min(1).max(200),
  localDate: z.string().regex(DAY_RE),
  counts: z.object(Object.fromEntries(COUNT_KEYS.map((k) => [k, count])) as Record<keyof DayCounts, typeof count>),
});
const batchesSchema = z.array(batchSchema).max(20);

/**
 * Add a batch of answered cards to the student's per-day record. The local
 * day comes from the browser (it is fixed when each card is answered) and must
 * be a real "today" somewhere on Earth, give or take a late flush.
 */
export async function recordReviewsAction(batches: ReviewBatch[]): Promise<{ ok: boolean }> {
  const { userId } = await auth();
  if (!userId) return { ok: false };
  const parsed = batchesSchema.safeParse(batches);
  if (!parsed.success) return { ok: false };

  const utcToday = utcDay(new Date());
  const earliest = shiftDay(utcToday, -2);
  const latest = shiftDay(utcToday, 1);
  const valid = parsed.data.filter(
    (b) => b.localDate >= earliest && b.localDate <= latest && COUNT_KEYS.some((k) => b.counts[k] > 0),
  );
  if (valid.length === 0) return { ok: true };

  const owned = new Set(
    (
      await prisma.workspace.findMany({
        // Trashed workspaces are excluded everywhere, here too.
        where: {
          ownerId: userId,
          deletedAt: null,
          id: { in: [...new Set(valid.map((b) => b.workspaceId))] },
        },
        select: { id: true },
      })
    ).map((w) => w.id),
  );

  try {
    for (const b of valid) {
      if (!owned.has(b.workspaceId)) continue;
      const key = { userId, workspaceId: b.workspaceId, localDate: b.localDate };
      const increment = Object.fromEntries(COUNT_KEYS.map((k) => [k, { increment: b.counts[k] }]));
      try {
        await prisma.studyDay.upsert({
          where: { userId_workspaceId_localDate: key },
          create: { ...key, ...b.counts },
          update: increment,
        });
      } catch {
        // Two tabs creating the same day at once: the row exists now.
        await prisma.studyDay.update({ where: { userId_workspaceId_localDate: key }, data: increment });
      }
    }
    return { ok: true };
  } catch {
    return { ok: false };
  }
}

async function loadDays(userId: string, from: string, workspaceId?: string): Promise<DayRow[]> {
  const rows = await prisma.studyDay.findMany({
    where: { userId, localDate: { gte: from }, ...(workspaceId ? { workspaceId } : {}) },
  });
  return rows.map((r) => {
    const row = { localDate: r.localDate } as DayRow;
    for (const k of COUNT_KEYS) row[k] = r[k];
    return row;
  });
}

async function studyDays(userId: string, offset: number, today: string): Promise<string[]> {
  const from = shiftDay(today, -HISTORY_DAYS);
  const [rows, legacy] = await Promise.all([
    loadDays(userId, from),
    prisma.usageEvent.findMany({
      where: {
        userId,
        kind: LEGACY_STUDY_KIND,
        createdAt: { gte: new Date(Date.now() - (HISTORY_DAYS + 1) * 86_400_000) },
      },
      select: { createdAt: true },
    }),
  ]);
  return [
    // Reviews, flashcard practice and quiz answers all count as a study day.
    ...rows.filter((r) => r.reviews > 0 || r.practice > 0 || r.quizAnswers > 0).map((r) => r.localDate),
    ...legacy.map((e) => dayAtOffset(e.createdAt, offset)),
  ];
}

/**
 * The student's streak, freezes and warnings. Days are bucketed in the
 * STUDENT's local time: the client passes `Date.getTimezoneOffset()` (minutes,
 * positive west of UTC) so "today" is their calendar day, not the server's.
 */
export async function getStudyStatsAction(offsetMinutes = 0): Promise<StreakStatus> {
  const { userId } = await auth();
  if (!userId) return { ...EMPTY_STREAK };
  const offset = safeOffset(offsetMinutes);
  const today = dayAtOffset(new Date(), offset);
  try {
    return streakStatus(await studyDays(userId, offset, today), today);
  } catch {
    return { ...EMPTY_STREAK };
  }
}

export interface StudyDashboard {
  today: string;
  streak: StreakStatus;
  /** Reviews per day, last 28 days. */
  perDay: DayPoint[];
  /** Recall rate of learned cards over the last 30 days (null: no data). */
  retention: number | null;
  /** Reviews in the last 30 days. */
  reviews30: number;
  /** Due forecast over all workspaces (only for the overall view). */
  forecast: { points: ForecastPoint[]; newWaiting: number } | null;
}

/**
 * Data for the statistics view: one workspace (`workspaceId`) or every
 * workspace the student owns. The streak is always the student's overall one.
 */
export async function getStudyDashboardAction(input: {
  offsetMinutes: number;
  workspaceId?: string;
}): Promise<StudyDashboard | null> {
  const { userId } = await auth();
  if (!userId) return null;
  const offset = safeOffset(input.offsetMinutes);
  const today = dayAtOffset(new Date(), offset);
  const workspaceId = typeof input.workspaceId === "string" && input.workspaceId ? input.workspaceId : undefined;
  try {
    const [rows, days] = await Promise.all([
      loadDays(userId, shiftDay(today, -60), workspaceId),
      studyDays(userId, offset, today),
    ]);
    let forecast: StudyDashboard["forecast"] = null;
    if (!workspaceId) {
      const workspaces = await prisma.workspace.findMany({
        where: { ownerId: userId, deletedAt: null },
        select: { data: true },
      });
      const cards = workspaces.flatMap((w) => {
        try {
          return collectCards(JSON.parse(w.data));
        } catch {
          return [];
        }
      });
      forecast = dueForecast(cards, today, 14);
    }
    const recent = rows.filter((r) => r.localDate >= shiftDay(today, -29));
    return {
      today,
      streak: streakStatus(days, today),
      perDay: reviewsPerDay(rows, today, 28),
      retention: retentionRate(rows, today, 30),
      reviews30: totals(recent).reviews,
      forecast,
    };
  } catch {
    return null;
  }
}
