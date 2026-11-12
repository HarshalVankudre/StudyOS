/**
 * Owner-scoped, atomic workspace apply + undo (server-only).
 *
 * Agent edits never overwrite a workspace directly. They go through
 * `applyAgentWorkspaceChange`, which re-checks ownership and the base version
 * inside one transaction, writes the new workspace, and records an immutable
 * before/after snapshot in `WorkspaceChange`. `undoAgentWorkspaceChange`
 * restores that exact "before" snapshot (referenced by a server-generated id,
 * never client JSON) as a new version, so history stays auditable.
 *
 * Both go through the same save gate as every other write
 * (`prepareWorkspaceForSave`: repaired, size-capped) before anything is
 * written, so the agent can never store a workspace the student then cannot
 * save, and an oversized result fails before the turn is charged.
 *
 * When the workspace moved on meanwhile (another tab saved during a long
 * task, or edits after the agent's change), the change is applied on top of
 * the newer version only if a strict three-way merge finds no overlap
 * (changes.ts, "strict" mode); otherwise it is refused as before.
 */
import "server-only";

import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/db";
import { applyPatch, diff } from "./changes";
import { prepareWorkspaceForSave } from "./repair";
import { safeParseWorkspace } from "./schema";
import { NOT_TRASHED, columnText, parseStoredWorkspace } from "./store";
import type { Workspace } from "./types";

export class WorkspaceNotFoundError extends Error {}
export class WorkspaceVersionConflictError extends Error {}

/**
 * Why an agent change cannot be undone:
 *  - "newer_edits": edits saved after the change touch what it changed (or
 *    landed while the Undo ran), so only the editor's own undo can step back;
 *  - "unavailable": no such change for this owner, or it was already undone.
 */
export type UndoUnavailableReason = "newer_edits" | "unavailable";

export class WorkspaceChangeUnavailableError extends Error {
  constructor(
    message: string,
    readonly reason: UndoUnavailableReason = "unavailable",
  ) {
    super(message);
    this.name = "WorkspaceChangeUnavailableError";
  }
}

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

// Stored snapshots are read tolerantly (one imperfect piece is repaired or
// dropped, never the whole workspace), matching the editor's loader.
function parseWorkspace(data: string, id: string): Workspace {
  const workspace = parseStoredWorkspace({ id, data });
  if (!workspace) throw new Error("Stored workspace is invalid");
  return workspace;
}

export async function getWorkspaceSnapshot(
  id: string,
): Promise<WorkspaceSnapshot | null> {
  const ownerId = await requireOwnerId();
  const row = await prisma.workspace.findFirst({
    where: { id, ownerId, ...NOT_TRASHED },
    select: { data: true, version: true },
  });
  if (!row) return null;
  return { workspace: parseWorkspace(row.data, id), version: row.version };
}

/**
 * Write the agent's result as a new version.
 *
 * `base` is the workspace the agent started from (the snapshot read at
 * `baseVersion`). When given and the workspace has moved on since, the
 * agent's changes (base -> result) are applied on top of the newer version if
 * they do not overlap with what changed meanwhile; any overlap refuses with
 * WorkspaceVersionConflictError, as without `base`.
 *
 * Throws WorkspaceTooLargeError / InvalidWorkspaceError (repair.ts) before
 * writing anything when the result cannot be stored.
 */
export async function applyAgentWorkspaceChange(
  id: string,
  baseVersion: number,
  nextWorkspace: Workspace,
  base?: Workspace,
): Promise<WorkspaceChangeResult> {
  const ownerId = await requireOwnerId();
  const normalized = { ...nextWorkspace, id };
  // Untrusted model output: all-or-nothing validation, then the save gate.
  const parsed = safeParseWorkspace(normalized);
  if (!parsed.success) throw new Error("Agent workspace is invalid");
  const prepared = prepareWorkspaceForSave(normalized, id);

  return prisma.$transaction(async (tx) => {
    const current = await tx.workspace.findFirst({
      where: { id, ownerId, ...NOT_TRASHED },
      select: { data: true, version: true },
    });
    if (!current) throw new WorkspaceNotFoundError("Workspace not found");

    let toWrite = prepared;
    if (current.version !== baseVersion) {
      if (!base) throw new WorkspaceVersionConflictError("Workspace changed during the task");
      const merged = applyPatch(parseWorkspace(current.data, id), diff(base, prepared.workspace), {
        mode: "strict",
      });
      if (merged.report.conflicts > 0) {
        throw new WorkspaceVersionConflictError("Workspace changed during the task");
      }
      toWrite = prepareWorkspaceForSave(merged.doc, id);
    }

    const updated = await tx.workspace.updateMany({
      where: { id, ownerId, version: current.version, ...NOT_TRASHED },
      data: {
        name: columnText(toWrite.workspace.name),
        icon: toWrite.workspace.icon == null ? null : columnText(toWrite.workspace.icon),
        data: toWrite.data,
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
        afterData: toWrite.data,
        beforeVersion: current.version,
        afterVersion: current.version + 1,
      },
      select: { id: true },
    });

    return {
      workspace: toWrite.workspace,
      version: current.version + 1,
      changeId: change.id,
    };
  });
}

/**
 * Undo an agent change. Restores the exact "before" snapshot when nothing was
 * saved since; when the student kept working after the agent (ordinary saves
 * moved the version on), the agent's change alone is reverted on top of the
 * current version, provided nothing changed since overlaps with it.
 */
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
      where: { id: original.workspaceId, ownerId, ...NOT_TRASHED },
      select: { data: true, version: true },
    });
    if (!current) throw new WorkspaceNotFoundError("Workspace not found");

    const before = parseWorkspace(original.beforeData, original.workspaceId);
    let restoredDoc: Workspace = before;
    if (current.version !== original.afterVersion) {
      const after = parseWorkspace(original.afterData, original.workspaceId);
      const reverted = applyPatch(
        parseWorkspace(current.data, original.workspaceId),
        diff(after, before),
        { mode: "strict" },
      );
      if (reverted.report.conflicts > 0) {
        throw new WorkspaceChangeUnavailableError("Workspace has newer changes", "newer_edits");
      }
      restoredDoc = reverted.doc;
    }
    // The same gate as every write (repaired, size-capped).
    const { workspace: restored, data: restoredData } = prepareWorkspaceForSave(
      restoredDoc,
      original.workspaceId,
    );
    const nextVersion = current.version + 1;

    const updated = await tx.workspace.updateMany({
      where: {
        id: original.workspaceId,
        ownerId,
        version: current.version,
        ...NOT_TRASHED,
      },
      data: {
        name: columnText(restored.name),
        icon: restored.icon == null ? null : columnText(restored.icon),
        data: restoredData,
        version: { increment: 1 },
      },
    });
    if (updated.count !== 1) {
      throw new WorkspaceChangeUnavailableError(
        "Workspace changed before Undo completed",
        "newer_edits",
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
