/**
 * Reads the signed-in student's agenda (server-only, owner-scoped, never the
 * trash). Free and AI-free: the same workspaces the daily plan reads, read
 * by the plan's own row reader (./build), in the zone the student's days
 * follow everywhere else (the daily plan's, else the reminders', else UTC:
 * `insightsZone`).
 *
 * Bounded like search: at most MAX_AGENDA_WORKSPACES workspaces (most
 * recently updated first), and parsing stops once MAX_AGENDA_PARSE_BYTES of
 * stored JSON have been read, so one student's request never parses an
 * unbounded amount of data.
 */
import "server-only";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/db";
import { studentClock } from "@/lib/ai/student-clock";
import { cleanText } from "@/lib/agents/daily-study/classify";
import { gradesWeightResolver } from "@/lib/agents/daily-study/grades-hook";
import { reportError } from "@/lib/ops/report-error";
import { insightsZone } from "@/lib/study/insights-store";
import { NOT_TRASHED, parseStoredWorkspace } from "@/lib/workspace/store";
import type { Workspace } from "@/lib/workspace/types";
import { collectAgendaItems, type AgendaCourse, type AgendaItem } from "./build";

/** Most workspaces read (the same bound as search). */
export const MAX_AGENDA_WORKSPACES = 60;
/** Stored JSON parsed per request, at most (a dozen typical workspaces are well under 1 MB). */
export const MAX_AGENDA_PARSE_BYTES = 24 * 1024 * 1024;

export interface AgendaData {
  /** The student's local day. */
  today: string;
  timeZone: string;
  /** Every workspace read, as a course to filter by. */
  courses: AgendaCourse[];
  items: AgendaItem[];
  /** True when some workspaces were not read (over a bound). */
  partial: boolean;
}

/** The agenda of student `userId`, with days read in `timeZone`. */
export async function loadAgenda(userId: string, timeZone: string, now: Date = new Date()): Promise<AgendaData> {
  const today = studentClock(timeZone, now).date;
  const rows = await prisma.workspace.findMany({
    where: { ownerId: userId, ...NOT_TRASHED },
    orderBy: { updatedAt: "desc" },
    take: MAX_AGENDA_WORKSPACES + 1,
    select: { id: true, name: true, data: true },
  });

  let partial = rows.length > MAX_AGENDA_WORKSPACES;
  let parsed = 0;
  const workspaces: Workspace[] = [];
  for (const row of rows.slice(0, MAX_AGENDA_WORKSPACES)) {
    parsed += row.data.length;
    if (parsed > MAX_AGENDA_PARSE_BYTES) {
      partial = true;
      break;
    }
    const workspace = parseStoredWorkspace(row);
    if (workspace) workspaces.push(workspace);
  }

  return {
    today,
    timeZone,
    courses: workspaces.map((w) => ({ id: w.id, name: cleanText(w.name), icon: w.icon ?? null })),
    items: collectAgendaItems(workspaces, today, { weightOf: gradesWeightResolver() }),
    partial,
  };
}

/** The signed-in student's agenda, or null when nobody is signed in or it could not be read. */
export async function getAgenda(): Promise<AgendaData | null> {
  const { userId } = await auth();
  if (!userId) return null;
  try {
    return await loadAgenda(userId, await insightsZone(userId));
  } catch (error) {
    reportError(error, { source: "agenda", userId });
    return null;
  }
}
