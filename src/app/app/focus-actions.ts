"use server";

import { auth } from "@clerk/nextjs/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { DEFAULT_TIME_ZONE, studentClock, validTimeZone } from "@/lib/ai/student-clock";
import { shiftDay } from "@/lib/study/days";
import {
  FOCUS_CLIENT_ID_RE,
  FOCUS_HISTORY_DAYS,
  MAX_SESSIONS_PER_DAY,
  cleanFocusLabel,
  plausibleStart,
  storableSeconds,
  summarizeFocus,
  type FocusSummary,
} from "@/lib/study/focus";

/**
 * The focus timer's server side. Free and AI-free like every study feature:
 * nothing here spends credits or calls a model.
 */

const recordSchema = z.object({
  clientId: z.string().regex(FOCUS_CLIENT_ID_RE),
  /** Epoch ms, the browser's clock. */
  startedAt: z.number().int().nonnegative(),
  seconds: z.number().finite().nonnegative().max(7 * 24 * 60 * 60),
  completed: z.boolean(),
  label: z.string().max(1_000).nullish(),
  course: z.string().max(1_000).nullish(),
  workspaceId: z.string().min(1).max(200).nullish(),
  itemKey: z.string().min(1).max(400).nullish(),
  /** The browser's IANA time zone: decides which local day the session counts for. */
  timeZone: z.string().max(100).nullish(),
});

export type RecordFocusInput = z.input<typeof recordSchema>;

export type RecordFocusResult =
  | { ok: true; stored: boolean; duplicate?: boolean }
  | { ok: false; reason: "unauthenticated" | "invalid" | "failed" };

function isUniqueViolation(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && (error as { code?: unknown }).code === "P2002");
}

/** The zone to read local days in: the browser's, else the planner's, else UTC. */
async function resolveZone(userId: string, candidate: unknown): Promise<string> {
  const zone = validTimeZone(candidate);
  if (zone) return zone;
  const config = await prisma.dailyStudyAgentConfig.findUnique({
    where: { userId },
    select: { timeZone: true },
  });
  return validTimeZone(config?.timeZone) ?? DEFAULT_TIME_ZONE;
}

/**
 * Save one focus block. Sessions under a minute are not stored; longer ones
 * are cut to three hours and to the time that really passed since they
 * started. The browser sends a random `clientId` per block, so a retried
 * request (flaky network, two tabs) is stored once.
 *
 * A session started from an item in a workspace that is not the student's,
 * or that is in the trash (e.g. trashed while the timer ran), keeps its
 * minutes but loses the link to that workspace and item.
 */
export async function recordFocusSession(input: RecordFocusInput): Promise<RecordFocusResult> {
  const { userId } = await auth();
  if (!userId) return { ok: false, reason: "unauthenticated" };
  const parsed = recordSchema.safeParse(input);
  if (!parsed.success) return { ok: false, reason: "invalid" };
  const data = parsed.data;

  const now = Date.now();
  if (!plausibleStart(data.startedAt, now)) return { ok: false, reason: "invalid" };
  const seconds = storableSeconds(data.seconds, data.startedAt, now);
  if (seconds === null) return { ok: true, stored: false };

  try {
    // A request still in flight while the account is being erased must not
    // write a row nothing would ever remove.
    const [tombstone, recent, workspace, zone] = await Promise.all([
      prisma.deletedAccount.findUnique({ where: { userId }, select: { userId: true } }),
      // A day holds at most 24 hours of focus: far more blocks than that is
      // a script, not a student. Kept out instead of filling the table.
      prisma.focusSession.count({
        where: { userId, createdAt: { gte: new Date(now - 24 * 60 * 60 * 1000) } },
      }),
      data.workspaceId
        ? prisma.workspace.findFirst({
            // Owned and not in the trash (trashed workspaces are invisible everywhere).
            where: { id: data.workspaceId, ownerId: userId, deletedAt: null },
            select: { id: true },
          })
        : Promise.resolve(null),
      resolveZone(userId, data.timeZone),
    ]);
    if (tombstone) return { ok: false, reason: "unauthenticated" };
    if (recent >= MAX_SESSIONS_PER_DAY) return { ok: true, stored: false };

    const title = cleanFocusLabel(data.label);
    const course = cleanFocusLabel(data.course);
    const label = cleanFocusLabel([title, course].filter(Boolean).join(" · "));
    await prisma.focusSession.create({
      data: {
        userId,
        clientId: data.clientId,
        workspaceId: workspace?.id ?? null,
        itemKey: workspace ? (data.itemKey ?? null) : null,
        label,
        localDate: studentClock(zone, new Date(data.startedAt)).date,
        startedAt: new Date(data.startedAt),
        seconds,
        completed: data.completed,
      },
    });
    return { ok: true, stored: true };
  } catch (error) {
    // The same block saved before (a retry): already counted once.
    if (isUniqueViolation(error)) return { ok: true, stored: true, duplicate: true };
    return { ok: false, reason: "failed" };
  }
}

/**
 * Focus minutes today, per day over the last week, and the streak of days
 * with focus time, in the student's local days (`timeZone`, else the zone
 * their daily plan uses). Never throws: the Today view shows what it can.
 */
export async function getFocusSummary(input: { timeZone?: string | null } = {}): Promise<FocusSummary | null> {
  const { userId } = await auth();
  if (!userId) return null;
  try {
    const zone = await resolveZone(userId, input?.timeZone);
    const today = studentClock(zone).date;
    const days = await prisma.focusSession.groupBy({
      by: ["localDate"],
      where: { userId, localDate: { gte: shiftDay(today, -FOCUS_HISTORY_DAYS), lte: today } },
      _sum: { seconds: true },
    });
    return summarizeFocus(
      days.map((d) => ({ localDate: d.localDate, seconds: d._sum.seconds ?? 0 })),
      today,
    );
  } catch {
    return null;
  }
}
