/**
 * The dispatch's database side (NotificationStore on Prisma/Postgres).
 *
 * Claiming students is one statement: it picks rows whose `nextCheckAt` has
 * passed and that nobody holds, oldest first, through the `nextCheckAt`
 * index, locks them with FOR UPDATE SKIP LOCKED (a concurrent run skips them
 * instead of waiting) and sets a lease. Reminders are claimed with an INSERT
 * that the unique (userId, dedupeKey) index turns into a no-op for anything
 * claimed before.
 */
import "server-only";

import { prisma } from "@/lib/db";
import { repairWorkspace } from "@/lib/workspace/repair";
import type { Workspace } from "@/lib/workspace/types";
import { dayKeyOf } from "@/lib/workspace/view-logic";
import { shiftDay } from "@/lib/study/days";
import type { NotificationStore } from "./dispatch";
import { ensureTodayPlan } from "./plan";
import { fromRow, type PreferenceRow } from "./preferences";

/** Streak study events of the older format (lib/ops/retention STUDY_EVENT_KIND). */
const STUDY_EVENT_KIND = "evt:study_reviewed";
/** How far back the streak looks (the streak module replays up to ~400 days). */
const STREAK_HISTORY_DAYS = 400;

type ClaimedRow = PreferenceRow & { userId: string };

export async function loadOwnedWorkspaces(userId: string): Promise<Workspace[]> {
  const rows = await prisma.workspace.findMany({
    // Never from workspaces in the trash.
    where: { ownerId: userId, deletedAt: null },
    orderBy: { updatedAt: "desc" },
    select: { id: true, data: true },
  });
  return rows.flatMap((row) => {
    try {
      const parsed = repairWorkspace(JSON.parse(row.data), { id: row.id });
      return parsed ? [{ ...parsed.workspace, id: row.id }] : [];
    } catch {
      return [];
    }
  });
}

export const prismaNotificationStore: NotificationStore = {
  async claimDueUsers(now, limit, leaseUntil) {
    const rows = await prisma.$queryRaw<ClaimedRow[]>`
      UPDATE "NotificationPreference" AS p
      SET "leaseUntil" = ${leaseUntil}
      WHERE p."userId" IN (
        SELECT q."userId" FROM "NotificationPreference" AS q
        WHERE q."nextCheckAt" <= ${now}
          AND (q."leaseUntil" IS NULL OR q."leaseUntil" < ${now})
        ORDER BY q."nextCheckAt" ASC
        LIMIT ${limit}
        FOR UPDATE SKIP LOCKED
      )
      RETURNING p."userId", p."timeZone", p."locale", p."dailyEnabled", p."dailyMinute",
        p."deadlineEnabled", p."deadlineMinute", p."deadlineLeads", p."examLeads",
        p."streakEnabled", p."quietEnabled", p."quietStart", p."quietEnd"`;
    return rows.map((row) => ({ userId: row.userId, prefs: fromRow(row) }));
  },

  async release(userId, nextCheckAt) {
    await prisma.notificationPreference.updateMany({
      where: { userId },
      data: { nextCheckAt, leaseUntil: null },
    });
  },

  countMessages: (userId, localDate) =>
    prisma.notificationLog.count({
      where: { userId, localDate, message: true, status: { in: ["pending", "sent"] } },
    }),

  async claim(entry) {
    const rows = await prisma.$queryRaw<{ id: string }[]>`
      INSERT INTO "NotificationLog" ("id", "userId", "dedupeKey", "kind", "localDate", "status", "message", "createdAt")
      VALUES (${`nl_${crypto.randomUUID()}`}, ${entry.userId}, ${entry.dedupeKey}, ${entry.kind},
        ${entry.localDate}, 'pending', ${entry.message}, ${new Date()})
      ON CONFLICT ("userId", "dedupeKey") DO NOTHING
      RETURNING "id"`;
    return rows[0]?.id ?? null;
  },

  async finish(id, status, message, at) {
    await prisma.notificationLog.updateMany({
      where: { id },
      data: { status, message, ...(status === "sent" ? { sentAt: at } : {}) },
    });
  },

  loadWorkspaces: loadOwnedWorkspaces,

  todayPlan: (userId, localDate, timeZone, workspaces, now) =>
    ensureTodayPlan(userId, localDate, timeZone, workspaces, now),

  async studyDays(userId, today, timeZone) {
    const from = shiftDay(today, -STREAK_HISTORY_DAYS);
    const [rows, legacy] = await Promise.all([
      prisma.studyDay.findMany({
        where: { userId, localDate: { gte: from, lte: today } },
        select: { localDate: true, reviews: true, practice: true, quizAnswers: true },
      }),
      prisma.usageEvent.findMany({
        where: {
          userId,
          kind: STUDY_EVENT_KIND,
          createdAt: { gte: new Date(Date.now() - (STREAK_HISTORY_DAYS + 1) * 86_400_000) },
        },
        select: { createdAt: true },
      }),
    ]);
    return [
      // Same rule as the streak in the app: reviews, practice or quiz answers.
      ...rows.filter((r) => r.reviews > 0 || r.practice > 0 || r.quizAnswers > 0).map((r) => r.localDate),
      ...legacy.map((e) => dayKeyOf(e.createdAt, timeZone)),
    ];
  },
};

