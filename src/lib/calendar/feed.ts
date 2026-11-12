import "server-only";
import { randomBytes } from "node:crypto";
import { prisma } from "@/lib/db";
import { repairWorkspace } from "@/lib/workspace/repair";
import type { Workspace } from "@/lib/workspace/types";
import { mergeWorkspaceEvents, type FeedOptions } from "./events";
import { buildIcs } from "./ics";

/** New unguessable, URL-safe token. */
function newToken(): string {
  return randomBytes(24).toString("base64url");
}

/** The user's calendar token, creating one on first request. */
export async function getOrCreateCalendarToken(userId: string): Promise<string> {
  const existing = await prisma.calendarToken.findUnique({ where: { userId } });
  if (existing) return existing.token;
  const token = newToken();
  try {
    await prisma.calendarToken.create({ data: { token, userId } });
    return token;
  } catch {
    // Lost a race — return whatever now exists.
    const row = await prisma.calendarToken.findUnique({ where: { userId } });
    return row?.token ?? token;
  }
}

/** Rotate the token, revoking the old feed URL. Returns the new token. */
export async function resetCalendarToken(userId: string): Promise<string> {
  const token = newToken();
  await prisma.calendarToken.upsert({
    where: { userId },
    create: { token, userId },
    update: { token },
  });
  return token;
}

/** Resolve a feed token to its owner, or null if unknown/revoked. */
export async function resolveUserByToken(token: string): Promise<string | null> {
  if (!token) return null;
  const row = await prisma.calendarToken.findUnique({ where: { token } });
  return row?.userId ?? null;
}

/** Build the ICS body aggregating every dated row across the user's workspaces. */
export async function buildUserFeed(
  userId: string,
  now: Date,
  opts: FeedOptions = {},
): Promise<string> {
  const rows = await prisma.workspace.findMany({
    // Trashed workspaces must not leak deadlines into the feed.
    where: { ownerId: userId, deletedAt: null },
    // Oldest first: an untouched copy's events give way to the original's.
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true, data: true },
  });
  const workspaces: Workspace[] = [];
  for (const row of rows) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(row.data);
    } catch {
      continue;
    }
    // Tolerant, like the editor: one imperfect block never hides every deadline.
    const result = repairWorkspace(parsed, { id: row.id, name: row.name });
    if (result) workspaces.push({ ...result.workspace, id: row.id });
  }
  return buildIcs(mergeWorkspaceEvents(workspaces, opts), { name: "StudyOS deadlines", now });
}
