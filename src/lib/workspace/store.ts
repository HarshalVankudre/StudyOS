/**
 * Workspace persistence (server-only data layer).
 *
 * Every workspace is scoped to the signed-in user (`ownerId` = Clerk user id),
 * so users only ever see and modify their own. All callers run inside
 * Clerk-protected routes, so a user id is always available.
 *
 * Safety guarantees implemented here:
 *  - Loads are tolerant: an imperfect stored document is repaired piece by
 *    piece (see repair.ts) instead of making the whole workspace unloadable.
 *  - Saves go through `prepareWorkspaceForSave`, so nothing is ever written
 *    that the loader would reject, and are version-checked so two tabs (or a
 *    tab and the AI agent) can never silently overwrite each other.
 *  - Deleting moves a workspace to the trash (`deletedAt`); it can be restored
 *    for TRASH_RETENTION_DAYS and is purged after that. Every reader excludes
 *    trashed workspaces.
 */
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/db";
import { prepareWorkspaceForSave, repairWorkspace } from "./repair";
import type { Workspace } from "./types";

export const TRASH_RETENTION_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Prisma filter for workspaces that are not in the trash. */
export const NOT_TRASHED = { deletedAt: null } as const;

async function requireUserId(): Promise<string> {
  const { userId } = await auth();
  if (!userId) throw new Error("Not authenticated");
  return userId;
}

function trashCutoff(now = new Date()): Date {
  return new Date(now.getTime() - TRASH_RETENTION_DAYS * DAY_MS);
}

/**
 * Parse a stored row into a workspace, repairing what it can. Returns null
 * only when the stored data is not a workspace at all.
 */
export function parseStoredWorkspace(row: {
  id: string;
  name?: string;
  data: string;
}): Workspace | null {
  let raw: unknown;
  try {
    raw = JSON.parse(row.data);
  } catch {
    console.error(`[StudyOS] workspace ${row.id} holds unreadable JSON`);
    return null;
  }
  const result = repairWorkspace(raw, { id: row.id, name: row.name });
  if (!result) {
    console.error(`[StudyOS] workspace ${row.id} could not be recovered`);
    return null;
  }
  if (result.issues.length > 0) {
    console.warn(
      `[StudyOS] workspace ${row.id} loaded with repairs:`,
      result.issues.slice(0, 10),
    );
  }
  return { ...result.workspace, id: row.id };
}

/** Persist a freshly generated workspace for the current user; returns its id. */
export async function saveNewWorkspace(ws: Workspace): Promise<string> {
  const ownerId = await requireUserId();
  const id = crypto.randomUUID();
  const { workspace, data } = prepareWorkspaceForSave({ ...ws, id }, id);
  await prisma.workspace.create({
    data: {
      id,
      ownerId,
      name: workspace.name,
      icon: workspace.icon ?? null,
      data,
    },
  });
  return id;
}

export interface WorkspaceState {
  workspace: Workspace;
  version: number;
}

/** Load a workspace and its version, only if the current user owns it. */
export async function getWorkspaceState(
  id: string,
): Promise<WorkspaceState | null> {
  const ownerId = await requireUserId();
  const row = await prisma.workspace.findFirst({
    where: { id, ownerId, ...NOT_TRASHED },
    select: { id: true, name: true, data: true, version: true },
  });
  if (!row) return null;
  const workspace = parseStoredWorkspace(row);
  return workspace ? { workspace, version: row.version } : null;
}

/** Load a workspace by id, only if it belongs to the current user. */
export async function getWorkspace(id: string): Promise<Workspace | null> {
  return (await getWorkspaceState(id))?.workspace ?? null;
}

/** The current saved version, or null when the workspace is gone or trashed. */
export async function getWorkspaceVersion(id: string): Promise<number | null> {
  const ownerId = await requireUserId();
  const row = await prisma.workspace.findFirst({
    where: { id, ownerId, ...NOT_TRASHED },
    select: { version: true },
  });
  return row?.version ?? null;
}

/** List the current user's workspaces, most-recently-updated first. */
export async function listWorkspaces() {
  const ownerId = await requireUserId();
  return prisma.workspace.findMany({
    where: { ownerId, ...NOT_TRASHED },
    orderBy: { updatedAt: "desc" },
    select: { id: true, name: true, icon: true, updatedAt: true },
  });
}

export type SaveWorkspaceResult =
  | { status: "saved"; version: number }
  | { status: "conflict"; version: number }
  | { status: "not_found" };

/**
 * Save a workspace the current user owns (autosave), but only if nobody saved
 * a newer version since `baseVersion` (another tab, or the AI agent). Each
 * save advances `version`, which is also how a concurrent agent task detects
 * that it must not overwrite newer work (see version-service.ts).
 *
 * Throws InvalidWorkspaceError / WorkspaceTooLargeError (repair.ts) when the
 * document cannot be stored.
 */
export async function saveWorkspace(
  id: string,
  ws: unknown,
  baseVersion: number,
): Promise<SaveWorkspaceResult> {
  const ownerId = await requireUserId();
  const { workspace, data } = prepareWorkspaceForSave(ws, id);
  const updated = await prisma.workspace.updateMany({
    where: { id, ownerId, version: baseVersion, ...NOT_TRASHED },
    data: {
      name: workspace.name,
      icon: workspace.icon ?? null,
      data,
      version: { increment: 1 },
    },
  });
  if (updated.count === 1) return { status: "saved", version: baseVersion + 1 };

  const current = await prisma.workspace.findFirst({
    where: { id, ownerId, ...NOT_TRASHED },
    select: { version: true },
  });
  if (!current) return { status: "not_found" };
  return { status: "conflict", version: current.version };
}

/** Move a workspace to the trash (restorable for TRASH_RETENTION_DAYS). */
export async function trashWorkspace(id: string): Promise<boolean> {
  const ownerId = await requireUserId();
  const result = await prisma.workspace.updateMany({
    where: { id, ownerId, ...NOT_TRASHED },
    data: { deletedAt: new Date() },
  });
  return result.count === 1;
}

/** Bring a workspace back from the trash, if it has not expired. */
export async function restoreWorkspace(id: string): Promise<boolean> {
  const ownerId = await requireUserId();
  const result = await prisma.workspace.updateMany({
    where: { id, ownerId, deletedAt: { not: null, gte: trashCutoff() } },
    data: { deletedAt: null },
  });
  return result.count === 1;
}

/** Permanently delete a workspace. Only possible once it is in the trash. */
export async function deleteWorkspacePermanently(id: string): Promise<boolean> {
  const ownerId = await requireUserId();
  const result = await prisma.workspace.deleteMany({
    where: { id, ownerId, deletedAt: { not: null } },
  });
  return result.count === 1;
}

/** Remove trashed workspaces older than the retention window. */
export async function purgeExpiredTrash(ownerId: string): Promise<number> {
  const result = await prisma.workspace.deleteMany({
    where: { ownerId, deletedAt: { not: null, lt: trashCutoff() } },
  });
  return result.count;
}

/**
 * The current user's trash, newest first, with the date each item will be
 * deleted for good. Expired items are purged first.
 */
export async function listTrashedWorkspaces() {
  const ownerId = await requireUserId();
  await purgeExpiredTrash(ownerId);
  const rows = await prisma.workspace.findMany({
    where: { ownerId, deletedAt: { not: null } },
    orderBy: { deletedAt: "desc" },
    select: { id: true, name: true, icon: true, deletedAt: true },
  });
  return rows.map((row) => {
    const deletedAt = row.deletedAt ?? new Date();
    return {
      id: row.id,
      name: row.name,
      icon: row.icon,
      deletedAt,
      purgeAt: new Date(deletedAt.getTime() + TRASH_RETENTION_DAYS * DAY_MS),
    };
  });
}

/**
 * Copy a workspace into a new one named `nameFor(original name)`. Ids inside
 * the document are kept: they are only unique within a workspace, so the copy
 * is independent.
 */
export async function duplicateWorkspace(
  id: string,
  nameFor: (name: string) => string,
): Promise<string | null> {
  const source = await getWorkspace(id);
  if (!source) return null;
  return saveNewWorkspace({ ...source, name: nameFor(source.name) });
}
