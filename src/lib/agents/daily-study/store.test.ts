import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Workspace } from "@/lib/workspace/types";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  configFindUnique: vi.fn(),
  configUpsert: vi.fn(),
  planFindUnique: vi.fn(),
  planFindFirst: vi.fn(),
  planUpsert: vi.fn(),
  planUpdateMany: vi.fn(),
  runFindMany: vi.fn(),
  runCreate: vi.fn(),
  runUpdateMany: vi.fn(),
  workspaceFindMany: vi.fn(),
}));

vi.mock("@clerk/nextjs/server", () => ({ auth: mocks.auth }));
vi.mock("@/lib/db", () => ({
  prisma: {
    dailyStudyAgentConfig: {
      findUnique: mocks.configFindUnique,
      upsert: mocks.configUpsert,
    },
    dailyStudyPlan: {
      findUnique: mocks.planFindUnique,
      findFirst: mocks.planFindFirst,
      upsert: mocks.planUpsert,
      updateMany: mocks.planUpdateMany,
    },
    agentRun: {
      findMany: mocks.runFindMany,
      create: mocks.runCreate,
      updateMany: mocks.runUpdateMany,
    },
    workspace: { findMany: mocks.workspaceFindMany },
  },
}));

import {
  getAgentCenterSnapshot,
  localDateInTimeZone,
  normalizeTimeZone,
  runDailyStudyAgent,
  setDailyStudyItemCompleted,
} from "./store";

const EMPTY_WORKSPACE: Workspace = {
  id: "ws-1",
  name: "Semester HQ",
  pages: [],
  databases: [],
};

describe("Daily Study Agent store", () => {
  beforeEach(() => {
    mocks.auth.mockResolvedValue({ userId: "user-1" });
    mocks.configFindUnique.mockResolvedValue(null);
    mocks.planFindUnique.mockResolvedValue(null);
    mocks.runFindMany.mockResolvedValue([]);
    mocks.configUpsert.mockResolvedValue({
      userId: "user-1",
      enabled: true,
      dailyMinutes: 60,
      timeZone: "UTC",
    });
    mocks.runCreate.mockResolvedValue({ id: "run-1" });
    mocks.runUpdateMany.mockResolvedValue({ count: 1 });
    mocks.workspaceFindMany.mockResolvedValue([]);
  });

  afterEach(() => vi.useRealTimers());

  it("loads plan and activity using only the authenticated user id", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-11T10:00:00.000Z"));

    await getAgentCenterSnapshot(7);

    expect(mocks.configFindUnique).toHaveBeenCalledWith({
      where: { userId: "user-1" },
    });
    expect(mocks.planFindUnique).toHaveBeenCalledWith({
      where: {
        userId_localDate: { userId: "user-1", localDate: "2026-07-11" },
      },
    });
    expect(mocks.runFindMany).toHaveBeenCalledWith({
      where: { userId: "user-1", agentKey: "daily-study" },
      orderBy: { startedAt: "desc" },
      take: 7,
    });
  });

  it("does not run automatically when the user paused the agent", async () => {
    mocks.configFindUnique.mockResolvedValue({
      enabled: false,
      dailyMinutes: 60,
      timeZone: "Europe/Berlin",
    });

    await expect(
      runDailyStudyAgent({ trigger: "auto", timeZone: "Europe/Berlin" }),
    ).resolves.toBeNull();
    expect(mocks.runCreate).not.toHaveBeenCalled();
    expect(mocks.workspaceFindMany).not.toHaveBeenCalled();
  });

  it("builds a manual plan from owner-scoped workspace snapshots and logs it", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-11T10:00:00.000Z"));
    mocks.configFindUnique.mockResolvedValue({
      enabled: true,
      dailyMinutes: 60,
      timeZone: "UTC",
    });
    mocks.workspaceFindMany.mockResolvedValue([
      { id: "ws-1", data: JSON.stringify(EMPTY_WORKSPACE) },
    ]);
    mocks.planUpsert.mockImplementation(async ({ create }) => ({
      id: "plan-1",
      ...create,
    }));

    const plan = await runDailyStudyAgent({
      trigger: "manual",
      timeZone: "Europe/Berlin",
    });

    expect(mocks.workspaceFindMany).toHaveBeenCalledWith({
      where: { ownerId: "user-1" },
      orderBy: { updatedAt: "desc" },
      select: { id: true, data: true },
    });
    expect(mocks.planUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          userId_localDate: { userId: "user-1", localDate: "2026-07-11" },
        },
      }),
    );
    expect(mocks.runUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "run-1", userId: "user-1", status: "running" },
        data: expect.objectContaining({ status: "completed" }),
      }),
    );
    expect(plan).toMatchObject({ id: "plan-1", localDate: "2026-07-11" });
  });

  it("updates a plan item only through an owner-scoped lookup and write", async () => {
    const item = {
      id: "task:ws-1:p-1:t-1",
      kind: "task",
      title: "Outline essay",
      source: "Semester HQ · Writing",
      reason: "Still open.",
      workspaceId: "ws-1",
      href: "/app/ws-1",
      durationMinutes: 20,
      completed: false,
    };
    mocks.planFindFirst.mockResolvedValue({ items: JSON.stringify([item]) });
    mocks.planUpdateMany.mockResolvedValue({ count: 1 });

    await expect(
      setDailyStudyItemCompleted("plan-1", item.id, true),
    ).resolves.toBe(true);
    expect(mocks.planFindFirst).toHaveBeenCalledWith({
      where: { id: "plan-1", userId: "user-1" },
      select: { items: true },
    });
    expect(mocks.planUpdateMany).toHaveBeenCalledWith({
      where: { id: "plan-1", userId: "user-1" },
      data: { items: JSON.stringify([{ ...item, completed: true }]) },
    });
  });

  it("uses IANA timezones for the student's local calendar day", () => {
    const now = new Date("2026-07-11T02:00:00.000Z");
    expect(localDateInTimeZone("America/Los_Angeles", now)).toBe("2026-07-10");
    expect(normalizeTimeZone("not/a-zone")).toBe("UTC");
  });
});
