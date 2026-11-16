/**
 * Reads what the grades overview needs (server-only, owner-scoped).
 *
 * One query: the student's own workspaces that are not in the trash, the
 * most recently updated MAX_OVERVIEW_WORKSPACES of them. Only documents that
 * hold a grade tracker are parsed (a cheap text check first), and the grades
 * themselves are computed by the tracker's own functions (overview.ts).
 * Free and deterministic: no credits, no model.
 */
import "server-only";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/db";
import { studentClock } from "@/lib/ai/student-clock";
import { reportError } from "@/lib/ops/report-error";
import { insightsZone } from "@/lib/study/insights-store";
import { NOT_TRASHED, parseStoredWorkspace } from "@/lib/workspace/store";
import type { Workspace } from "@/lib/workspace/types";
import { MAX_OVERVIEW_WORKSPACES, buildGradesOverview, type GradesOverview } from "./overview";
import type { UkClassLabels } from "./scales";

/** A stored document that may hold a grade tracker (every one that does contains this). */
const MAY_HOLD_TRACKER = '"grades"';

/** The overview of student `userId` for their local day `today`. */
export async function loadGradesOverview(
  userId: string,
  options: { today: string; ukLabels?: UkClassLabels },
): Promise<GradesOverview> {
  const rows = await prisma.workspace.findMany({
    where: { ownerId: userId, ...NOT_TRASHED },
    orderBy: { updatedAt: "desc" },
    take: MAX_OVERVIEW_WORKSPACES,
    select: { id: true, name: true, data: true },
  });
  const workspaces: Workspace[] = [];
  for (const row of rows) {
    if (!row.data.includes(MAY_HOLD_TRACKER)) continue;
    const ws = parseStoredWorkspace(row);
    if (ws) workspaces.push(ws);
  }
  return buildGradesOverview(workspaces, options);
}

/**
 * The signed-in student's grades overview, or null when nobody is signed in
 * or it could not be read. "Next" assessments count from today in the zone
 * the daily plan uses (else UTC), like the insights page.
 */
export async function getGradesOverview(options: { ukLabels?: UkClassLabels } = {}): Promise<GradesOverview | null> {
  const { userId } = await auth();
  if (!userId) return null;
  try {
    const zone = await insightsZone(userId);
    return await loadGradesOverview(userId, { today: studentClock(zone).date, ukLabels: options.ukLabels });
  } catch (error) {
    reportError(error, { source: "grades-overview", userId });
    return null;
  }
}
