import { beforeEach, describe, expect, it, vi } from "vitest";
import { sampleWorkspace } from "@/lib/workspace/sample";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  transaction: vi.fn(),
  workspaceFindFirst: vi.fn(),
  workspaceUpdateMany: vi.fn(),
  changeCreate: vi.fn(),
  changeFindFirst: vi.fn(),
  changeUpdate: vi.fn(),
}));

vi.mock("@clerk/nextjs/server", () => ({ auth: mocks.auth }));
vi.mock("@/lib/db", () => ({
  prisma: {
    workspace: {
      findFirst: mocks.workspaceFindFirst,
    },
    $transaction: mocks.transaction,
  },
}));

import {
  WorkspaceChangeUnavailableError,
  WorkspaceVersionConflictError,
  applyAgentWorkspaceChange,
  getWorkspaceSnapshot,
  undoAgentWorkspaceChange,
} from "./version-service";

const tx = {
  workspace: {
    findFirst: mocks.workspaceFindFirst,
    updateMany: mocks.workspaceUpdateMany,
  },
  workspaceChange: {
    create: mocks.changeCreate,
    findFirst: mocks.changeFindFirst,
    update: mocks.changeUpdate,
  },
};

describe("workspace version service", () => {
  beforeEach(() => {
    mocks.auth.mockResolvedValue({ userId: "user-1" });
    mocks.transaction.mockImplementation(
      (run: (client: typeof tx) => unknown) => run(tx),
    );
  });

  it("loads an owner-scoped workspace with its version", async () => {
    mocks.workspaceFindFirst.mockResolvedValue({
      data: JSON.stringify(sampleWorkspace),
      version: 3,
    });

    await expect(getWorkspaceSnapshot("workspace-1")).resolves.toEqual({
      workspace: { ...sampleWorkspace, id: "workspace-1" },
      version: 3,
    });
    expect(mocks.workspaceFindFirst).toHaveBeenCalledWith({
      where: { id: "workspace-1", ownerId: "user-1" },
      select: { data: true, version: true },
    });
  });

  it("atomically applies an agent change and records both snapshots", async () => {
    const next = { ...sampleWorkspace, name: "Improved workspace" };
    mocks.workspaceFindFirst.mockResolvedValue({
      data: JSON.stringify(sampleWorkspace),
      version: 3,
    });
    mocks.workspaceUpdateMany.mockResolvedValue({ count: 1 });
    mocks.changeCreate.mockResolvedValue({ id: "change-1" });

    await expect(
      applyAgentWorkspaceChange("workspace-1", 3, next),
    ).resolves.toEqual({
      workspace: { ...next, id: "workspace-1" },
      version: 4,
      changeId: "change-1",
    });

    expect(mocks.changeCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        workspaceId: "workspace-1",
        ownerId: "user-1",
        kind: "agent",
        beforeVersion: 3,
        afterVersion: 4,
        beforeData: JSON.stringify(sampleWorkspace),
        afterData: JSON.stringify({ ...next, id: "workspace-1" }),
      }),
      select: { id: true },
    });
  });

  it("rejects an apply when another save won the version race", async () => {
    mocks.workspaceFindFirst.mockResolvedValue({
      data: JSON.stringify(sampleWorkspace),
      version: 3,
    });
    mocks.workspaceUpdateMany.mockResolvedValue({ count: 0 });

    await expect(
      applyAgentWorkspaceChange("workspace-1", 3, sampleWorkspace),
    ).rejects.toBeInstanceOf(WorkspaceVersionConflictError);
  });

  it("restores the exact before snapshot and records Undo as a new change", async () => {
    const after = { ...sampleWorkspace, name: "After agent" };
    mocks.changeFindFirst.mockResolvedValue({
      id: "change-1",
      workspaceId: "workspace-1",
      ownerId: "user-1",
      beforeData: JSON.stringify(sampleWorkspace),
      afterData: JSON.stringify(after),
      beforeVersion: 3,
      afterVersion: 4,
      undoneAt: null,
    });
    mocks.workspaceFindFirst.mockResolvedValue({
      data: JSON.stringify(after),
      version: 4,
    });
    mocks.workspaceUpdateMany.mockResolvedValue({ count: 1 });
    mocks.changeCreate.mockResolvedValue({ id: "undo-change-1" });
    mocks.changeUpdate.mockResolvedValue({});

    await expect(undoAgentWorkspaceChange("change-1")).resolves.toEqual({
      workspace: { ...sampleWorkspace, id: "workspace-1" },
      version: 5,
      changeId: "undo-change-1",
    });
  });

  it("rejects Undo after a newer workspace save", async () => {
    mocks.changeFindFirst.mockResolvedValue({
      id: "change-1",
      workspaceId: "workspace-1",
      ownerId: "user-1",
      beforeData: JSON.stringify(sampleWorkspace),
      afterData: JSON.stringify(sampleWorkspace),
      beforeVersion: 3,
      afterVersion: 4,
      undoneAt: null,
    });
    mocks.workspaceFindFirst.mockResolvedValue({
      data: JSON.stringify(sampleWorkspace),
      version: 5,
    });

    await expect(
      undoAgentWorkspaceChange("change-1"),
    ).rejects.toBeInstanceOf(WorkspaceChangeUnavailableError);
  });
});
