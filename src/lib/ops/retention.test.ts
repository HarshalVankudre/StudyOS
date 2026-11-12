import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  agentTaskDeleteMany: vi.fn(),
  changeDeleteMany: vi.fn(),
  usageDeleteMany: vi.fn(),
  executeRaw: vi.fn(),
  workspaceDeleteMany: vi.fn(),
  chatDeleteMany: vi.fn(),
  notificationLogDeleteMany: vi.fn(),
  billing: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    agentTask: { deleteMany: mocks.agentTaskDeleteMany },
    workspaceChange: { deleteMany: mocks.changeDeleteMany },
    usageEvent: { deleteMany: mocks.usageDeleteMany },
    $executeRaw: mocks.executeRaw,
    workspace: { deleteMany: mocks.workspaceDeleteMany },
    agentChatMessage: { deleteMany: mocks.chatDeleteMany },
    notificationLog: { deleteMany: mocks.notificationLogDeleteMany },
  },
}));

vi.mock("@/lib/billing", () => ({ runBillingMaintenance: mocks.billing }));
vi.mock("@/lib/ops/report-error", () => ({ reportError: vi.fn() }));

import { USAGE_LIMITS } from "@/lib/usage-limits";
import { RETENTION, STUDY_EVENT_KIND, purgeTrashedWorkspaces, runRetention } from "./retention";

const NOW = new Date("2026-11-12T03:00:00Z");
const DAY = 86_400_000;
const daysBefore = (d: number) => new Date(NOW.getTime() - d * DAY);
const sql = (call: unknown[]) => (call[0] as TemplateStringsArray).join("?");

beforeEach(() => {
  mocks.agentTaskDeleteMany.mockResolvedValue({ count: 1 });
  mocks.changeDeleteMany.mockResolvedValue({ count: 2 });
  mocks.usageDeleteMany.mockResolvedValue({ count: 3 });
  mocks.executeRaw.mockResolvedValue(4);
  mocks.workspaceDeleteMany.mockResolvedValue({ count: 6 });
  mocks.chatDeleteMany.mockResolvedValue({ count: 7 });
  mocks.notificationLogDeleteMany.mockResolvedValue({ count: 8 });
  mocks.billing.mockResolvedValue(BILLING);
});

const BILLING = { jobsCompleted: 1, jobsFailed: 0, holdsReleased: 2, subscriptionsResynced: 0 };

describe("data retention", () => {
  it("still prunes when the billing sweep fails (it is retried next run)", async () => {
    mocks.billing.mockRejectedValue(new Error("stripe down"));
    const result = await runRetention(NOW);
    expect(result.billing).toBeNull();
    expect(result.agentTasks).toBe(1);
  });

  it("prunes each table with its own window", async () => {
    const result = await runRetention(NOW);

    expect(mocks.agentTaskDeleteMany).toHaveBeenCalledWith({
      where: { expiresAt: { lt: daysBefore(1) } },
    });
    expect(mocks.changeDeleteMany).toHaveBeenCalledWith({
      where: { createdAt: { lt: daysBefore(RETENTION.workspaceChangeDays) } },
    });

    const usageCalls = mocks.usageDeleteMany.mock.calls.map((c) => c[0].where);
    // Rate-limit kinds: 7 days.
    expect(usageCalls[0]).toEqual({
      kind: { in: [...Object.keys(USAGE_LIMITS), "data_export", "agent_free_failure"] },
      createdAt: { lt: daysBefore(7) },
    });
    // Study streak: at least 400 days are kept.
    expect(usageCalls[1].kind).toBe(STUDY_EVENT_KIND);
    expect(RETENTION.studyEventDays).toBeGreaterThanOrEqual(400);
    expect(usageCalls[1].createdAt.lt.getTime()).toBeLessThanOrEqual(daysBefore(400).getTime());
    // Other analytics milestones: long-lived, and never the study kind.
    expect(usageCalls[2]).toEqual({
      kind: { startsWith: "evt:", not: STUDY_EVENT_KIND },
      createdAt: { lt: daysBefore(RETENTION.analyticsEventDays) },
    });

    // Per-workspace cap on change history.
    expect(sql(mocks.executeRaw.mock.calls[0])).toContain("ROW_NUMBER() OVER");
    expect(mocks.executeRaw.mock.calls[0][1]).toBe(RETENTION.workspaceChangeMaxPerWorkspace);

    expect(result).toEqual({
      agentTasks: 1,
      workspaceChangesExpired: 2,
      workspaceChangesOverCap: 4,
      rateLimitEvents: 3,
      studyEvents: 3,
      analyticsEvents: 3,
      trashedWorkspaces: 6,
      agentChatMessagesExpired: 7,
      agentChatMessagesOverCap: 4,
      notificationLogs: 8,
      billing: BILLING,
    });
    // Notification sent-log: kept well past the longest reminder lead (14 days).
    expect(RETENTION.notificationLogDays).toBeGreaterThan(14);
    expect(mocks.notificationLogDeleteMany).toHaveBeenCalledWith({
      where: { createdAt: { lt: daysBefore(RETENTION.notificationLogDays) } },
    });
    // The billing sweep (pending refunds and deleted-account cancels, expired
    // credit holds, lapsed subscription rows) runs with the same clock.
    expect(mocks.billing).toHaveBeenCalledWith(NOW);
    // Agent chat: an age limit and a per-workspace cap.
    expect(mocks.chatDeleteMany).toHaveBeenCalledWith({
      where: { createdAt: { lt: daysBefore(RETENTION.agentChatMessageDays) } },
    });
    expect(sql(mocks.executeRaw.mock.calls[1])).toContain('"AgentChatMessage"');
    expect(mocks.executeRaw.mock.calls[1][1]).toBe(RETENTION.agentChatMaxPerWorkspace);
  });

  it("purges only workspaces trashed more than 30 days ago", async () => {
    expect(await purgeTrashedWorkspaces(NOW)).toBe(6);
    expect(mocks.workspaceDeleteMany).toHaveBeenCalledWith({
      where: { deletedAt: { lt: daysBefore(30) } },
    });
  });
});
