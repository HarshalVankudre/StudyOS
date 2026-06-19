/**
 * Owner-scoped, atomic workspace apply + undo (server-only).
 *
 * Agent edits never overwrite a workspace directly. They go through
 * `applyAgentWorkspaceChange`, which re-checks ownership and the base version
 * inside one transaction, writes the new workspace, and records an immutable
 * before/after snapshot in `WorkspaceChange`. `undoAgentWorkspaceChange`
 * restores that exact "before" snapshot (referenced by a server-generated id,
 * never client JSON) as a new version, so history stays auditable.
 */
import "server-only";

import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/db";
import { safeParseWorkspace } from "./schema";
import type { Workspace } from "./types";

export class WorkspaceNotFoundError extends Error {}
export class WorkspaceVersionConflictError extends Error {}
export class WorkspaceChangeUnavailableError extends Error {}

export interface WorkspaceSnapshot {
  workspace: Workspace;
  version: number;
}

export interface WorkspaceChangeResult extends WorkspaceSnapshot {
  changeId: string;
}

async function requireOwnerId(): Promise<string> {
  const { userId } = await auth();
  if (!userId) throw new Error("Not authenticated");
  return userId;
}

function parseWorkspace(data: string, id: string): Workspace {
  const parsed = safeParseWorkspace(JSON.parse(data));
  if (!parsed.success) throw new Error("Stored workspace is invalid");
  return { ...parsed.data, id };
}

export async function getWorkspaceSnapshot(
  id: string,
): Promise<WorkspaceSnapshot | null> {
  const ownerId = await requireOwnerId();
  const row = await prisma.workspace.findFirst({
    where: { id, ownerId },
    select: { data: true, version: true },
  });
  if (!row) return null;
  return { workspace: parseWorkspace(row.data, id), version: row.version };
}

export async function applyAgentWorkspaceChange(
  id: string,
  baseVersion: number,
  nextWorkspace: Workspace,
): Promise<WorkspaceChangeResult> {
  const ownerId = await requireOwnerId();
  const normalized = { ...nextWorkspace, id };
  const parsed = safeParseWorkspace(normalized);
  if (!parsed.success) throw new Error("Agent workspace is invalid");
  // Persist the validated workspace exactly as given (matching store.ts, which
  // stores the raw object and only normalizes on read), so the recorded
  // after-snapshot is byte-identical to the workspace column it sets.
  const afterData = JSON.stringify(normalized);

  return prisma.$transaction(async (tx) => {
    const current = await tx.workspace.findFirst({
      where: { id, ownerId },
      select: { data: true, version: true },
    });
    if (!current) throw new WorkspaceNotFoundError("Workspace not found");
    if (current.version !== baseVersion) {
      throw new WorkspaceVersionConflictError("Workspace changed during the task");
    }

    const updated = await tx.workspace.updateMany({
      where: { id, ownerId, version: baseVersion },
      data: {
        name: parsed.data.name,
        icon: parsed.data.icon ?? null,
        data: afterData,
        version: { increment: 1 },
      },
    });
    if (updated.count !== 1) {
      throw new WorkspaceVersionConflictError("Workspace changed during the task");
    }

    const change = await tx.workspaceChange.create({
      data: {
        workspaceId: id,
        ownerId,
        kind: "agent",
        beforeData: current.data,
        afterData,
        beforeVersion: baseVersion,
        afterVersion: baseVersion + 1,
      },
      select: { id: true },
    });

    return {
      workspace: parsed.data,
      version: baseVersion + 1,
      changeId: change.id,
    };
  });
}

export async function undoAgentWorkspaceChange(
  changeId: string,
): Promise<WorkspaceChangeResult> {
  const ownerId = await requireOwnerId();

  return prisma.$transaction(async (tx) => {
    const original = await tx.workspaceChange.findFirst({
      where: { id: changeId, ownerId, kind: "agent" },
    });
    if (!original || original.undoneAt) {
      throw new WorkspaceChangeUnavailableError("Change cannot be undone");
    }

    const current = await tx.workspace.findFirst({
      where: { id: original.workspaceId, ownerId },
      select: { data: true, version: true },
    });
    if (!current) throw new WorkspaceNotFoundError("Workspace not found");
    if (current.version !== original.afterVersion) {
      throw new WorkspaceChangeUnavailableError(
        "Workspace has newer changes",
      );
    }

    const restored = parseWorkspace(
      original.beforeData,
      original.workspaceId,
    );
    const restoredData = JSON.stringify(restored);
    const nextVersion = current.version + 1;

    const updated = await tx.workspace.updateMany({
      where: {
        id: original.workspaceId,
        ownerId,
        version: current.version,
      },
      data: {
        name: restored.name,
        icon: restored.icon ?? null,
        data: restoredData,
        version: { increment: 1 },
      },
    });
    if (updated.count !== 1) {
      throw new WorkspaceChangeUnavailableError(
        "Workspace changed before Undo completed",
      );
    }

    const undoChange = await tx.workspaceChange.create({
      data: {
        workspaceId: original.workspaceId,
        ownerId,
        kind: "undo",
        beforeData: current.data,
        afterData: restoredData,
        beforeVersion: current.version,
        afterVersion: nextVersion,
      },
      select: { id: true },
    });

    await tx.workspaceChange.update({
      where: { id: original.id },
      data: { undoneAt: new Date() },
    });

    return {
      workspace: restored,
      version: nextVersion,
      changeId: undoChange.id,
    };
  });
}
