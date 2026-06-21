import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  create: vi.fn(),
  findFirst: vi.fn(),
  updateMany: vi.fn(),
}));

vi.mock("@clerk/nextjs/server", () => ({ auth: mocks.auth }));
vi.mock("@/lib/db", () => ({
  prisma: {
    agentTask: {
      create: mocks.create,
      findFirst: mocks.findFirst,
      updateMany: mocks.updateMany,
    },
  },
}));

import {
  claimTaskForFinalization,
  TASK_TTL_MS,
  appendTaskEvent,
  cancelTask,
  createTask,
  getTask,
  isTaskCancelled,
  markTaskDone,
  markTaskError,
} from "./store";

describe("agent task store", () => {
  beforeEach(() => {
    mocks.auth.mockResolvedValue({ userId: "user-1" });
  });
  afterEach(() => vi.useRealTimers());

  it("creates an owner-scoped running task expiring in 10 minutes", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-19T12:00:00.000Z"));
    mocks.create.mockResolvedValue({ id: "task-1" });

    await expect(
      createTask({ workspaceId: "ws-1", baseVersion: 3 }),
    ).resolves.toEqual({ id: "task-1" });

    expect(mocks.create).toHaveBeenCalledWith({
      data: {
        userId: "user-1",
        workspaceId: "ws-1",
        baseVersion: 3,
        status: "running",
        expiresAt: new Date(Date.now() + TASK_TTL_MS),
      },
      select: { id: true },
    });
  });

  it("loads a task scoped to the current user", async () => {
    mocks.findFirst.mockResolvedValue({ id: "task-1", userId: "user-1" });
    await getTask("task-1");
    expect(mocks.findFirst).toHaveBeenCalledWith({
      where: { id: "task-1", userId: "user-1" },
    });
  });

  it("cancels only the current user's running task", async () => {
    mocks.updateMany.mockResolvedValueOnce({ count: 1 });
    await expect(cancelTask("task-1")).resolves.toBe(true);
    expect(mocks.updateMany).toHaveBeenCalledWith({
      where: { id: "task-1", userId: "user-1", status: "running" },
      data: { status: "cancelled" },
    });

    mocks.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(cancelTask("task-1")).resolves.toBe(false);
  });

  it("claims only the current user's running task for finalization", async () => {
    mocks.updateMany.mockResolvedValueOnce({ count: 1 });
    await expect(claimTaskForFinalization("task-1")).resolves.toBe(true);
    expect(mocks.updateMany).toHaveBeenCalledWith({
      where: { id: "task-1", userId: "user-1", status: "running" },
      data: { status: "finalizing" },
    });
  });

  it("reports when claiming a task for finalization fails", async () => {
    mocks.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(claimTaskForFinalization("task-1")).resolves.toBe(false);
    expect(mocks.updateMany).toHaveBeenCalledWith({
      where: { id: "task-1", userId: "user-1", status: "running" },
      data: { status: "finalizing" },
    });
  });

  it("reports cancellation for the apply guard", async () => {
    mocks.findFirst.mockResolvedValue({ status: "cancelled" });
    await expect(isTaskCancelled("task-1")).resolves.toBe(true);
    mocks.findFirst.mockResolvedValue({ status: "running" });
    await expect(isTaskCancelled("task-1")).resolves.toBe(false);
  });

  it("markTaskDone only updates a finalizing task and reports success", async () => {
    mocks.updateMany.mockResolvedValue({ count: 1 });
    await expect(markTaskDone("task-1", "{}")).resolves.toBe(true);
    expect(mocks.updateMany).toHaveBeenCalledWith({
      where: { id: "task-1", userId: "user-1", status: "finalizing" },
      data: { status: "done", result: "{}" },
    });
  });

  it("reports when markTaskDone cannot update a task", async () => {
    mocks.updateMany.mockResolvedValue({ count: 0 });
    await expect(markTaskDone("task-1", "{}")).resolves.toBe(false);
    expect(mocks.updateMany).toHaveBeenCalledWith({
      where: { id: "task-1", userId: "user-1", status: "finalizing" },
      data: { status: "done", result: "{}" },
    });
  });

  it("markTaskError only touches running or finalizing tasks", async () => {
    mocks.updateMany.mockResolvedValue({ count: 1 });
    await markTaskError("task-1", "boom");
    expect(mocks.updateMany).toHaveBeenCalledWith({
      where: { id: "task-1", userId: "user-1", status: { in: ["running", "finalizing"] } },
      data: { status: "error", error: "boom" },
    });
  });

  it("appendTaskEvent reads, appends, and writes back capped events (null start)", async () => {
    mocks.findFirst.mockResolvedValueOnce({ events: null });
    mocks.updateMany.mockResolvedValue({ count: 1 });
    const event = { type: "phase" as const, phase: "planning" as const, message: "Planning", progress: 10 };
    await appendTaskEvent("task-1", event);
    expect(mocks.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "task-1", userId: "user-1" },
        data: { events: JSON.stringify([event]) },
      }),
    );
  });

  it("appendTaskEvent appends to existing events", async () => {
    const existing = [{ type: "phase" as const, phase: "inspecting" as const, message: "Inspecting", progress: 5 }];
    mocks.findFirst.mockResolvedValueOnce({ events: JSON.stringify(existing) });
    mocks.updateMany.mockResolvedValue({ count: 1 });
    const newEvent = { type: "phase" as const, phase: "planning" as const, message: "Planning", progress: 10 };
    await appendTaskEvent("task-1", newEvent);
    const callArg = mocks.updateMany.mock.calls[mocks.updateMany.mock.calls.length - 1][0];
    const written = JSON.parse(callArg.data.events);
    expect(written).toHaveLength(2);
    expect(written[1]).toEqual(newEvent);
  });

  it("appendTaskEvent does nothing when task row not found", async () => {
    mocks.findFirst.mockResolvedValueOnce(null);
    mocks.updateMany.mockClear();
    await appendTaskEvent("no-such-task", { type: "error", message: "oops" });
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });
});
