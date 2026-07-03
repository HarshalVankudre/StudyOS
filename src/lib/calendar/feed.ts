import "server-only";
import { randomBytes } from "node:crypto";
import { prisma } from "@/lib/db";
import { safeParseWorkspace } from "@/lib/workspace/schema";
import { workspaceEvents, type CalendarEvent } from "./events";
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
export async function buildUserFeed(userId: string, now: Date): Promise<string> {
  const rows = await prisma.workspace.findMany({
    where: { ownerId: userId },
    select: { data: true },
  });
  const events: CalendarEvent[] = [];
  for (const row of rows) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(row.data);
    } catch {
      continue;
    }
    const result = safeParseWorkspace(parsed);
    if (result.success) events.push(...workspaceEvents(result.data));
  }
  events.sort((a, b) => a.date.localeCompare(b.date));
  return buildIcs(events, { name: "StudyOS deadlines", now });
}
