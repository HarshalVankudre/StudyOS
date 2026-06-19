/**
 * Workspace persistence (server-only data layer).
 *
 * Every workspace is scoped to the signed-in user (`ownerId` = Clerk user id),
 * so users only ever see and modify their own. All callers run inside
 * Clerk-protected routes, so a user id is always available.
 */
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/db";
import { safeParseWorkspace } from "./schema";
import type { Workspace } from "./types";

async function requireUserId(): Promise<string> {
  const { userId } = await auth();
  if (!userId) throw new Error("Not authenticated");
  return userId;
}

/** Persist a freshly generated workspace for the current user; returns its id. */
export async function saveNewWorkspace(ws: Workspace): Promise<string> {
  const ownerId = await requireUserId();
  const id = crypto.randomUUID();
  const data: Workspace = { ...ws, id };
  await prisma.workspace.create({
    data: {
      id,
      ownerId,
      name: ws.name,
      icon: ws.icon ?? null,
      data: JSON.stringify(data),
    },
  });
  return id;
}

/** Load a workspace by id, only if it belongs to the current user. */
export async function getWorkspace(id: string): Promise<Workspace | null> {
  const ownerId = await requireUserId();
  const row = await prisma.workspace.findFirst({ where: { id, ownerId } });
  if (!row) return null;
  try {
    const parsed = safeParseWorkspace(JSON.parse(row.data));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** List the current user's workspaces, most-recently-updated first. */
export async function listWorkspaces() {
  const ownerId = await requireUserId();
  return prisma.workspace.findMany({
    where: { ownerId },
    orderBy: { updatedAt: "desc" },
    select: { id: true, name: true, icon: true, updatedAt: true },
  });
}

/**
 * Overwrite a workspace the current user owns (autosave).
 *
 * Each save advances `version` so a concurrent agent task working off an older
 * snapshot can detect the conflict and refuse to overwrite the newer state
 * (see version-service.ts).
 */
export async function updateWorkspace(id: string, ws: Workspace): Promise<void> {
  const ownerId = await requireUserId();
  await prisma.workspace.updateMany({
    where: { id, ownerId },
    data: {
      name: ws.name,
      icon: ws.icon ?? null,
      data: JSON.stringify({ ...ws, id }),
      version: { increment: 1 },
    },
  });
}

export async function deleteWorkspace(id: string): Promise<void> {
  const ownerId = await requireUserId();
  await prisma.workspace.deleteMany({ where: { id, ownerId } });
}
