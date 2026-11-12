import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  agentTaskDeleteMany: vi.fn(),
  changeDeleteMany: vi.fn(),
  usageDeleteMany: vi.fn(),
  executeRaw: vi.fn(),
  workspaceDeleteMany: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    agentTask: { deleteMany: mocks.agentTaskDeleteMany },
    workspaceChange: { deleteMany: mocks.changeDeleteMany },
    usageEvent: { deleteMany: mocks.usageDeleteMany },
    $executeRaw: mocks.executeRaw,
    workspace: { deleteMany: mocks.workspaceDeleteMany },
  },
}));

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
});

describe("data retention", () => {
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
      kind: { in: [...Object.keys(USAGE_LIMITS), "data_export"] },
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
    });
  });

  it("purges only workspaces trashed more than 30 days ago", async () => {
    expect(await purgeTrashedWorkspaces(NOW)).toBe(6);
    expect(mocks.workspaceDeleteMany).toHaveBeenCalledWith({
      where: { deletedAt: { lt: daysBefore(30) } },
    });
  });
});
