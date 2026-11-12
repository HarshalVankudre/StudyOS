/**
 * GDPR access/portability: everything StudyOS stores about one user, as one
 * JSON document. Workspace history snapshots (WorkspaceChange) are left out:
 * they are copies of the workspaces already included, kept only for undo.
 * The calendar feed token is reported as present/absent, never its value,
 * because it is a live credential.
 */
import "server-only";

import { prisma } from "@/lib/db";

export const EXPORT_FORMAT_VERSION = 1;

/** Exports per user per window (each one reads every workspace). */
export const EXPORT_LIMIT = { max: 5, windowMs: 24 * 60 * 60 * 1000 } as const;
export const EXPORT_KIND = "data_export";

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export async function buildUserDataExport(
  userId: string,
  profile: { email?: string | null; name?: string | null } = {},
  now = new Date(),
) {
  const [
    workspaces,
    dailyPlans,
    dailyAgentConfig,
    agentRuns,
    studyEvents,
    studyDays,
    usageEvents,
    creditAccount,
    creditLedger,
    subscription,
    assets,
    calendarToken,
  ] = await Promise.all([
    // Includes workspaces in the trash (deletedAt set): still stored, so still exported.
    prisma.workspace.findMany({
      where: { ownerId: userId },
      orderBy: { createdAt: "asc" },
      select: { id: true, name: true, icon: true, data: true, version: true, deletedAt: true, createdAt: true, updatedAt: true },
    }),
    prisma.dailyStudyPlan.findMany({
      where: { userId },
      orderBy: { localDate: "asc" },
      select: { localDate: true, timeZone: true, summary: true, items: true, generatedAt: true },
    }),
    prisma.dailyStudyAgentConfig.findUnique({
      where: { userId },
      select: { enabled: true, dailyMinutes: true, timeZone: true, createdAt: true, updatedAt: true },
    }),
    prisma.agentRun.findMany({
      where: { userId },
      orderBy: { startedAt: "asc" },
      select: { agentKey: true, trigger: true, status: true, summary: true, startedAt: true, completedAt: true },
    }),
    prisma.usageEvent.findMany({
      where: { userId, kind: "evt:study_reviewed" },
      orderBy: { createdAt: "asc" },
      select: { createdAt: true },
    }),
    prisma.studyDay.findMany({
      where: { userId },
      orderBy: [{ localDate: "asc" }, { workspaceId: "asc" }],
      select: {
        workspaceId: true, localDate: true, reviews: true, again: true, hard: true, good: true,
        easy: true, newCards: true, reviewTotal: true, reviewPassed: true, practice: true,
      },
    }),
    prisma.usageEvent.findMany({
      where: { userId, NOT: { kind: "evt:study_reviewed" } },
      orderBy: { createdAt: "asc" },
      select: { kind: true, createdAt: true },
    }),
    prisma.creditAccount.findUnique({
      where: { userId },
      select: { balance: true, createdAt: true, updatedAt: true },
    }),
    prisma.creditLedger.findMany({
      where: { userId },
      orderBy: { createdAt: "asc" },
      select: { delta: true, reason: true, createdAt: true },
    }),
    prisma.subscription.findUnique({
      where: { userId },
      select: { status: true, currentPeriodEnd: true, stripeCustomerId: true, updatedAt: true },
    }),
    prisma.asset.findMany({
      where: { ownerId: userId },
      orderBy: { createdAt: "asc" },
      select: { id: true, workspaceId: true, mime: true, sizeBytes: true, createdAt: true },
    }),
    prisma.calendarToken.findUnique({ where: { userId }, select: { createdAt: true } }),
  ]);

  return {
    format: "studyos-data-export",
    version: EXPORT_FORMAT_VERSION,
    exportedAt: now.toISOString(),
    account: { userId, email: profile.email ?? null, name: profile.name ?? null },
    workspaces: workspaces.map((w) => ({ ...w, data: parseJson(w.data) })),
    study: {
      reviewDays: studyEvents.map((e) => e.createdAt),
      reviewsPerDay: studyDays,
      dailyAgent: dailyAgentConfig,
      dailyPlans: dailyPlans.map((p) => ({ ...p, items: parseJson(p.items) })),
      agentRuns,
    },
    credits: {
      balance: creditAccount?.balance ?? 0,
      account: creditAccount,
      ledger: creditLedger,
    },
    subscription: subscription
      ? {
          status: subscription.status,
          currentPeriodEnd: subscription.currentPeriodEnd,
          hasStripeCustomer: Boolean(subscription.stripeCustomerId),
          updatedAt: subscription.updatedAt,
        }
      : { status: "free", currentPeriodEnd: null, hasStripeCustomer: false, updatedAt: null },
    assets,
    calendarFeed: { enabled: Boolean(calendarToken), createdAt: calendarToken?.createdAt ?? null },
    usageEvents,
  };
}

/** Count-then-record limiter on UsageEvent (same model as lib/usage-limits). */
export async function allowDataExport(userId: string, now = new Date()): Promise<boolean> {
  const since = new Date(now.getTime() - EXPORT_LIMIT.windowMs);
  const used = await prisma.usageEvent.count({
    where: { userId, kind: EXPORT_KIND, createdAt: { gte: since } },
  });
  if (used >= EXPORT_LIMIT.max) return false;
  await prisma.usageEvent.create({ data: { userId, kind: EXPORT_KIND } }).catch(() => {});
  return true;
}
