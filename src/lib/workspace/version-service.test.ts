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
import { MAX_WORKSPACE_BYTES, WorkspaceTooLargeError } from "./repair";

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
      where: { id: "workspace-1", ownerId: "user-1", deletedAt: null },
      select: { data: true, version: true },
    });
  });

  it("loads a snapshot with one imperfect block instead of failing the agent", async () => {
    const stored = structuredClone(sampleWorkspace) as unknown as {
      pages: { blocks: unknown[] }[];
    };
    stored.pages[0].blocks.push({ id: "broken", type: "media" });
    mocks.workspaceFindFirst.mockResolvedValue({
      data: JSON.stringify(stored),
      version: 7,
    });
    const snapshot = await getWorkspaceSnapshot("workspace-1");
    expect(snapshot?.version).toBe(7);
    expect(snapshot?.workspace.pages[0].blocks).toEqual(sampleWorkspace.pages[0].blocks);
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

  it("rejects Undo when a newer save changed what the agent changed", async () => {
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
      data: JSON.stringify({ ...after, name: "Renamed by the student" }),
      version: 5,
    });

    const refused = await undoAgentWorkspaceChange("change-1").catch((e: unknown) => e);
    expect(refused).toBeInstanceOf(WorkspaceChangeUnavailableError);
    // Typed, so the route never has to match the message text.
    expect((refused as WorkspaceChangeUnavailableError).reason).toBe("newer_edits");
    expect(mocks.workspaceUpdateMany).not.toHaveBeenCalled();
  });

  it("an already-undone change is refused as unavailable, not as newer edits", async () => {
    mocks.changeFindFirst.mockResolvedValue({
      id: "change-1",
      workspaceId: "workspace-1",
      ownerId: "user-1",
      beforeData: JSON.stringify(sampleWorkspace),
      afterData: JSON.stringify(sampleWorkspace),
      beforeVersion: 3,
      afterVersion: 4,
      undoneAt: new Date(),
    });
    const refused = await undoAgentWorkspaceChange("change-1").catch((e: unknown) => e);
    expect(refused).toBeInstanceOf(WorkspaceChangeUnavailableError);
    expect((refused as WorkspaceChangeUnavailableError).reason).toBe("unavailable");
  });

  it("a save that lands while the Undo runs is reported as newer edits", async () => {
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
    mocks.workspaceFindFirst.mockResolvedValue({ data: JSON.stringify(after), version: 4 });
    mocks.workspaceUpdateMany.mockResolvedValue({ count: 0 });
    const refused = await undoAgentWorkspaceChange("change-1").catch((e: unknown) => e);
    expect((refused as WorkspaceChangeUnavailableError).reason).toBe("newer_edits");
  });
});

describe("agent writes go through the save gate (finding 9)", () => {
  beforeEach(() => {
    mocks.auth.mockResolvedValue({ userId: "user-1" });
    mocks.transaction.mockImplementation(
      (run: (client: typeof tx) => unknown) => run(tx),
    );
    mocks.workspaceFindFirst.mockResolvedValue({ data: JSON.stringify(sampleWorkspace), version: 3 });
    mocks.workspaceUpdateMany.mockResolvedValue({ count: 1 });
    mocks.changeCreate.mockResolvedValue({ id: "change-1" });
    mocks.changeUpdate.mockResolvedValue({});
  });

  it("refuses an agent result over 2 MB before writing anything", async () => {
    const huge = {
      ...sampleWorkspace,
      pages: [{ id: "big", title: "Big", blocks: [{ id: "t", type: "paragraph" as const, text: "x".repeat(MAX_WORKSPACE_BYTES) }] }],
    };
    await expect(applyAgentWorkspaceChange("workspace-1", 3, huge)).rejects.toBeInstanceOf(
      WorkspaceTooLargeError,
    );
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.workspaceUpdateMany).not.toHaveBeenCalled();
  });

  it("refuses an Undo that would store a workspace over 2 MB", async () => {
    const huge = {
      ...sampleWorkspace,
      pages: [{ id: "big", title: "Big", blocks: [{ id: "t", type: "paragraph", text: "x".repeat(MAX_WORKSPACE_BYTES) }] }],
    };
    mocks.changeFindFirst.mockResolvedValue({
      id: "change-1",
      workspaceId: "workspace-1",
      ownerId: "user-1",
      beforeData: JSON.stringify(huge),
      afterData: JSON.stringify(sampleWorkspace),
      beforeVersion: 3,
      afterVersion: 4,
      undoneAt: null,
    });
    mocks.workspaceFindFirst.mockResolvedValue({ data: JSON.stringify(sampleWorkspace), version: 4 });
    await expect(undoAgentWorkspaceChange("change-1")).rejects.toBeInstanceOf(WorkspaceTooLargeError);
    expect(mocks.workspaceUpdateMany).not.toHaveBeenCalled();
  });

  it("stores a name with a NUL character without failing the write (finding 15)", async () => {
    await applyAgentWorkspaceChange("workspace-1", 3, { ...sampleWorkspace, name: "Bio\u0000logy" });
    expect(mocks.workspaceUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ name: "Biology" }) }),
    );
  });
});

describe("agent results survive newer saves when nothing overlaps (finding 10)", () => {
  const extraPage = { id: "from-tab", title: "Typed in another tab", blocks: [] };

  beforeEach(() => {
    mocks.auth.mockResolvedValue({ userId: "user-1" });
    mocks.transaction.mockImplementation(
      (run: (client: typeof tx) => unknown) => run(tx),
    );
    mocks.workspaceUpdateMany.mockResolvedValue({ count: 1 });
    mocks.changeCreate.mockResolvedValue({ id: "change-2" });
    mocks.changeUpdate.mockResolvedValue({});
  });

  it("applies the agent's changes on top of a newer version", async () => {
    // The agent started at version 3; another tab saved version 4 meanwhile.
    mocks.workspaceFindFirst.mockResolvedValue({
      data: JSON.stringify({ ...sampleWorkspace, pages: [...sampleWorkspace.pages, extraPage] }),
      version: 4,
    });
    const agentResult = { ...sampleWorkspace, name: "Renamed by the agent" };
    const result = await applyAgentWorkspaceChange("workspace-1", 3, agentResult, sampleWorkspace);
    expect(result.version).toBe(5);
    expect(result.workspace.name).toBe("Renamed by the agent");
    expect(result.workspace.pages.map((p) => p.id)).toContain("from-tab");
    expect(mocks.workspaceUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ version: 4 }) }),
    );
    expect(mocks.changeCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ beforeVersion: 4, afterVersion: 5 }) }),
    );
  });

  it("still refuses when the newer version changed the same thing", async () => {
    mocks.workspaceFindFirst.mockResolvedValue({
      data: JSON.stringify({ ...sampleWorkspace, name: "Renamed in another tab" }),
      version: 4,
    });
    await expect(
      applyAgentWorkspaceChange("workspace-1", 3, { ...sampleWorkspace, name: "Agent name" }, sampleWorkspace),
    ).rejects.toBeInstanceOf(WorkspaceVersionConflictError);
    expect(mocks.workspaceUpdateMany).not.toHaveBeenCalled();
  });

  it("keeps the agent's Undo available after the student's ordinary saves", async () => {
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
    // The student saved twice after the agent (versions 5 and 6).
    mocks.workspaceFindFirst.mockResolvedValue({
      data: JSON.stringify({ ...after, pages: [...after.pages, extraPage] }),
      version: 6,
    });
    const result = await undoAgentWorkspaceChange("change-1");
    expect(result.version).toBe(7);
    expect(result.workspace.name).toBe(sampleWorkspace.name);
    expect(result.workspace.pages.map((p) => p.id)).toContain("from-tab");
  });
});
