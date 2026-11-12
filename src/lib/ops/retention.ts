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
 *  - AgentChatMessage (the agent chat's memory): the model only ever reads the
 *    last few turns and the panel redraws the last 60, so messages older than
 *    180 days go, and at most the newest 200 per workspace are kept. A purged
 *    workspace takes its chat with it (ON DELETE CASCADE).
 *  - NotificationLog (what the notifications dispatch sent or skipped): its
 *    de-duplication keys only matter until the reminder's day has passed
 *    (the earliest reminder is 14 days ahead, the daily cap is per day), so
 *    rows older than 60 days go. Push subscriptions are not aged out here:
 *    the dispatch deletes the ones a push service reports gone.
 */
import { prisma } from "@/lib/db";
import { EXPORT_KIND } from "@/lib/account/export-user-data";
import { USAGE_LIMITS } from "@/lib/usage-limits";
import { AGENT_FREE_FAILURE_KIND } from "@/lib/ai/agent-charging";
import { runBillingMaintenance, type BillingMaintenanceResult } from "@/lib/billing";
import { reportError } from "@/lib/ops/report-error";

const DAY = 24 * 60 * 60 * 1000;

export const RETENTION = {
  agentTaskAfterExpiryDays: 1,
  workspaceChangeDays: 30,
  workspaceChangeMaxPerWorkspace: 50,
  rateLimitEventDays: 7,
  studyEventDays: 430,
  analyticsEventDays: 760,
  trashedWorkspaceDays: 30,
  agentChatMessageDays: 180,
  agentChatMaxPerWorkspace: 200,
  notificationLogDays: 60,
} as const;

/** UsageEvent kinds used only for rate-limit windows. */
export const RATE_LIMIT_KINDS: readonly string[] = [
  // Every kind lib/usage-limits enforces (new limits are covered automatically).
  ...Object.keys(USAGE_LIMITS),
  EXPORT_KIND,
  AGENT_FREE_FAILURE_KIND,
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
  agentChatMessagesExpired: number;
  agentChatMessagesOverCap: number;
  notificationLogs: number;
  /** The billing sweep (null when it failed; reported, retried next run). */
  billing: BillingMaintenanceResult | null;
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

  const agentChatMessagesExpired = await prisma.agentChatMessage.deleteMany({
    where: { createdAt: { lt: ago(now, RETENTION.agentChatMessageDays) } },
  });
  const agentChatMessagesOverCap = await prisma.$executeRaw`
    DELETE FROM "AgentChatMessage"
    WHERE "id" IN (
      SELECT "id" FROM (
        SELECT "id", ROW_NUMBER() OVER (
          PARTITION BY "workspaceId" ORDER BY "createdAt" DESC, "id" DESC
        ) AS rn
        FROM "AgentChatMessage"
      ) ranked
      WHERE ranked.rn > ${RETENTION.agentChatMaxPerWorkspace}
    )`;

  const notificationLogs = await prisma.notificationLog.deleteMany({
    where: { createdAt: { lt: ago(now, RETENTION.notificationLogDays) } },
  });

  // Billing jobs Stripe failed part-way and stopped retrying (a refund, a
  // deleted account's or lost dispute's cancellation), abandoned credit holds
  // (and settles that failed), the one-off repair of rows the previous code
  // wrote (result.billing.unsynced; remaining 0 = complete), rows past their
  // paid period. Never stops data retention; failures are retried next run.
  const billing = await runBillingMaintenance(now).catch((error) => {
    reportError(error, { source: "retention", route: "runBillingMaintenance" });
    return null;
  });

  return {
    agentTasks: agentTasks.count,
    workspaceChangesExpired: workspaceChangesExpired.count,
    workspaceChangesOverCap: Number(workspaceChangesOverCap),
    rateLimitEvents: rateLimitEvents.count,
    studyEvents: studyEvents.count,
    analyticsEvents: analyticsEvents.count,
    trashedWorkspaces,
    agentChatMessagesExpired: agentChatMessagesExpired.count,
    agentChatMessagesOverCap: Number(agentChatMessagesOverCap),
    notificationLogs: notificationLogs.count,
    billing,
  };
}
