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
import { reportError } from "@/lib/ops/report-error";
import { prepareWorkspaceForSave, repairWorkspace } from "./repair";
import { readSaveLog, recordSave, serializeSaveLog, type SaveLog } from "./save-ids";
import type { Workspace } from "./types";

export const TRASH_RETENTION_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * A workspace's name or icon as stored in its own text column. Postgres
 * rejects a NUL character (and the driver an unpaired surrogate) in a text
 * column, which would make every save of that workspace fail; inside the JSON
 * `data` column they are escaped and harmless, so only the columns are
 * cleaned (the document itself is stored exactly as given).
 */
export function columnText(value: string): string {
  const clean = value.replace(/\u0000/g, "");
  return typeof clean.toWellFormed === "function" ? clean.toWellFormed() : clean;
}

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
    // The parser's message quotes the stored text, so it is not reported.
    reportError(new Error("Stored workspace holds unreadable JSON"), {
      source: "workspace-store",
      workspaceId: row.id,
    });
    return null;
  }
  const result = repairWorkspace(raw, { id: row.id, name: row.name });
  if (!result) {
    reportError(new Error("Stored workspace could not be recovered"), {
      source: "workspace-store",
      workspaceId: row.id,
    });
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
      name: columnText(workspace.name),
      icon: workspace.icon == null ? null : columnText(workspace.icon),
      data,
    },
  });
  return id;
}

export interface WorkspaceState {
  workspace: Workspace;
  version: number;
  /** Which editor save produced which version, as of this read (save-ids.ts). */
  saves?: SaveLog;
}

/** Load a workspace and its version, only if the current user owns it. */
export async function getWorkspaceState(
  id: string,
): Promise<WorkspaceState | null> {
  const ownerId = await requireUserId();
  const row = await prisma.workspace.findFirst({
    where: { id, ownerId, ...NOT_TRASHED },
    select: { id: true, name: true, data: true, version: true, saveIds: true },
  });
  if (!row) return null;
  const workspace = parseStoredWorkspace(row);
  return workspace
    ? { workspace, version: row.version, saves: readSaveLog(row.saveIds, row.version) }
    : null;
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
  | { status: "conflict"; version: number; saves?: SaveLog }
  | { status: "not_found" };

/**
 * Save a workspace the current user owns: the ONE way an editor's work
 * reaches the server. A compare-and-swap on the whole document: it is written
 * only if the row is still at `baseVersion` (nobody saved since: another tab,
 * the AI agent, a server-side edit), and then produces exactly version
 * `baseVersion + 1`. The server never merges an editor's changes onto a
 * version the editor has not seen; merging happens in the tab, which has both
 * documents (components/workspace/workspace-sync.ts).
 *
 * `saveId` and `tabId` (from the editor) are recorded with the version this
 * save produces, in the same statement as the document, and the log comes
 * back with a refused save and with every read: that is how a tab whose reply
 * was lost learns, for certain, whether its save landed (save-ids.ts).
 * Server-side callers pass neither; their write still keeps the log in step.
 *
 * Throws InvalidWorkspaceError / WorkspaceTooLargeError (repair.ts) when the
 * document cannot be stored.
 */
export async function saveWorkspace(
  id: string,
  ws: unknown,
  baseVersion: number,
  saveId?: string,
  tabId?: string,
): Promise<SaveWorkspaceResult> {
  const ownerId = await requireUserId();
  const { workspace, data } = prepareWorkspaceForSave(ws, id);
  // The log is read at `baseVersion` and written back only if the row is
  // still at it, so the version check keeps document and log consistent.
  const row = await prisma.workspace.findFirst({
    where: { id, ownerId, ...NOT_TRASHED },
    select: { version: true, saveIds: true },
  });
  if (!row) return { status: "not_found" };
  const saves = readSaveLog(row.saveIds, row.version);
  if (row.version !== baseVersion) return { status: "conflict", version: row.version, saves };
  const updated = await prisma.workspace.updateMany({
    where: { id, ownerId, version: baseVersion, ...NOT_TRASHED },
    data: {
      name: columnText(workspace.name),
      icon: workspace.icon == null ? null : columnText(workspace.icon),
      data,
      saveIds: serializeSaveLog(recordSave(saves, baseVersion + 1, tabId, saveId)),
      version: { increment: 1 },
    },
  });
  if (updated.count === 1) return { status: "saved", version: baseVersion + 1 };

  const current = await prisma.workspace.findFirst({
    where: { id, ownerId, ...NOT_TRASHED },
    select: { version: true, saveIds: true },
  });
  if (!current) return { status: "not_found" };
  return {
    status: "conflict",
    version: current.version,
    saves: readSaveLog(current.saveIds, current.version),
  };
}

export type UpdateWorkspaceResult<T> =
  | { status: "saved"; version: number; result: T }
  | { status: "unchanged"; result: T }
  | { status: "conflict" }
  | { status: "not_found" };

/**
 * Server-side read-modify-write of a workspace the current user owns, through
 * the same version-checked save as autosave. `mutate` edits a fresh copy and
 * returns `{ changed, result }`; nothing is written when nothing changed. A
 * concurrent save (another tab, the AI agent) makes the save conflict, in
 * which case the latest version is re-read and `mutate` runs again, up to
 * `attempts` times. An open editor sees the new version as "updated
 * elsewhere" and reloads it.
 */
export async function updateWorkspaceWith<T>(
  id: string,
  mutate: (draft: Workspace) => { changed: boolean; result: T },
  attempts = 3,
): Promise<UpdateWorkspaceResult<T>> {
  for (let attempt = 0; attempt < attempts; attempt++) {
    const state = await getWorkspaceState(id);
    if (!state) return { status: "not_found" };
    const draft = structuredClone(state.workspace);
    const { changed, result } = mutate(draft);
    if (!changed) return { status: "unchanged", result };
    const saved = await saveWorkspace(id, draft, state.version);
    if (saved.status === "saved") return { status: "saved", version: saved.version, result };
    if (saved.status === "not_found") return { status: "not_found" };
  }
  return { status: "conflict" };
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
