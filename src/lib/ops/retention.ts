/**
 * Data retention: prune rows the product no longer needs. Run daily by Cloud
 * Scheduler through /api/ops/maintenance.
 *
 * What is kept, and why:
 *  - AgentTask: reconnect needs ~10 minutes (TASK_TTL_MS); rows are deleted one
 *    day after they expired.
 *  - WorkspaceChange (two full workspace copies per agent edit): undo only ever
 *    applies to the latest change, so 30 days of history is generous; on top
 *    of that, at most the newest 50 changes per workspace are kept.
 *  - UsageEvent rate-limit kinds: the longest window is one day; kept 7 days.
 *  - UsageEvent study streak events (evt:study_reviewed): the streak reads 400
 *    days back; kept 430 days.
 *  - UsageEvent other analytics milestones (evt:*): kept 25 months.
 *  - Unknown kinds are never touched, so a new feature's events are safe until
 *    someone gives them a retention rule here.
 *  - Trashed workspaces (Workspace.deletedAt): purged 30 days after deletion,
 *    see purgeTrashedWorkspaces.
 */
import { prisma } from "@/lib/db";
import { EXPORT_KIND } from "@/lib/account/export-user-data";
import { USAGE_LIMITS } from "@/lib/usage-limits";

const DAY = 24 * 60 * 60 * 1000;

export const RETENTION = {
  agentTaskAfterExpiryDays: 1,
  workspaceChangeDays: 30,
  workspaceChangeMaxPerWorkspace: 50,
  rateLimitEventDays: 7,
  studyEventDays: 430,
  analyticsEventDays: 760,
  trashedWorkspaceDays: 30,
} as const;

/** UsageEvent kinds used only for rate-limit windows. */
export const RATE_LIMIT_KINDS: readonly string[] = [
  // Every kind lib/usage-limits enforces (new limits are covered automatically).
  ...Object.keys(USAGE_LIMITS),
  EXPORT_KIND,
];
export const STUDY_EVENT_KIND = "evt:study_reviewed";

export interface RetentionResult {
  agentTasks: number;
  workspaceChangesExpired: number;
  workspaceChangesOverCap: number;
  rateLimitEvents: number;
  studyEvents: number;
  analyticsEvents: number;
  trashedWorkspaces: number;
}

const ago = (now: Date, days: number) => new Date(now.getTime() - days * DAY);

/**
 * Purge workspaces in the trash for longer than the restore window
 * (Workspace.deletedAt, set by the workspace trash). Change-history rows go
 * with the workspace (ON DELETE CASCADE).
 */
export async function purgeTrashedWorkspaces(now: Date): Promise<number> {
  const result = await prisma.workspace.deleteMany({
    where: { deletedAt: { lt: ago(now, RETENTION.trashedWorkspaceDays) } },
  });
  return result.count;
}

export async function runRetention(now = new Date()): Promise<RetentionResult> {
  const agentTasks = await prisma.agentTask.deleteMany({
    where: { expiresAt: { lt: ago(now, RETENTION.agentTaskAfterExpiryDays) } },
  });

  const workspaceChangesExpired = await prisma.workspaceChange.deleteMany({
    where: { createdAt: { lt: ago(now, RETENTION.workspaceChangeDays) } },
  });

  // Keep only the newest N changes of each workspace.
  const workspaceChangesOverCap = await prisma.$executeRaw`
    DELETE FROM "WorkspaceChange"
    WHERE "id" IN (
      SELECT "id" FROM (
        SELECT "id", ROW_NUMBER() OVER (
          PARTITION BY "workspaceId" ORDER BY "afterVersion" DESC
        ) AS rn
        FROM "WorkspaceChange"
      ) ranked
      WHERE ranked.rn > ${RETENTION.workspaceChangeMaxPerWorkspace}
    )`;

  const rateLimitEvents = await prisma.usageEvent.deleteMany({
    where: {
      kind: { in: [...RATE_LIMIT_KINDS] },
      createdAt: { lt: ago(now, RETENTION.rateLimitEventDays) },
    },
  });

  const studyEvents = await prisma.usageEvent.deleteMany({
    where: {
      kind: STUDY_EVENT_KIND,
      createdAt: { lt: ago(now, RETENTION.studyEventDays) },
    },
  });

  const analyticsEvents = await prisma.usageEvent.deleteMany({
    where: {
      kind: { startsWith: "evt:", not: STUDY_EVENT_KIND },
      createdAt: { lt: ago(now, RETENTION.analyticsEventDays) },
    },
  });

  const trashedWorkspaces = await purgeTrashedWorkspaces(now);

  return {
    agentTasks: agentTasks.count,
    workspaceChangesExpired: workspaceChangesExpired.count,
    workspaceChangesOverCap: Number(workspaceChangesOverCap),
    rateLimitEvents: rateLimitEvents.count,
    studyEvents: studyEvents.count,
    analyticsEvents: analyticsEvents.count,
    trashedWorkspaces,
  };
}
