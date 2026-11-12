/**
 * Today's plan for a student who is not looking at StudyOS (the daily
 * notification). Uses the Daily Study Agent's deterministic planner (no AI)
 * and its reconcile step exactly as the Today view does, and stores a newly
 * built plan, so what the notification names is what the student finds when
 * they open the app. An existing plan for today is read and brought in line
 * with the workspaces; it is planned again (keeping check-offs) only when the
 * workspaces it was built from changed, exactly as the Today view does.
 */
import "server-only";

import { prisma } from "@/lib/db";
import {
  buildDailyStudyPlan,
  normalizeDailyMinutes,
  planSourcesKey,
  visiblePlanItems,
  type PreviousPlan,
} from "@/lib/agents/daily-study/planner";
import { gradesWeightResolver } from "@/lib/agents/daily-study/grades-hook";
import { reconcilePlanItems } from "@/lib/agents/daily-study/reconcile";
import {
  DAILY_STUDY_AGENT_KEY,
  DEFAULT_DAILY_MINUTES,
  PLAN_VERSION,
  parseDailyStudyPlanItems,
  parsePlanDetails,
  type DailyStudyPlanItem,
} from "@/lib/agents/daily-study/types";
import type { Workspace } from "@/lib/workspace/types";
import { addDays } from "@/lib/workspace/view-logic";

/** Same window the agent uses for roll-forward. */
const ROLL_FORWARD_WINDOW_DAYS = 14;

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: string }).code === "P2002";
}

export async function ensureTodayPlan(
  userId: string,
  localDate: string,
  timeZone: string,
  workspaces: Workspace[],
  now: Date,
): Promise<DailyStudyPlanItem[] | null> {
  const config = await prisma.dailyStudyAgentConfig.findUnique({
    where: { userId },
    select: { enabled: true, dailyMinutes: true },
  });
  // A student who paused the Daily Study Agent gets no plan, so no daily note.
  if (config && !config.enabled) return null;

  const existing = await prisma.dailyStudyPlan.findUnique({
    where: { userId_localDate: { userId, localDate } },
    select: { id: true, items: true, version: true, timeZone: true, details: true },
  });
  if (existing && existing.version >= PLAN_VERSION) {
    let items: DailyStudyPlanItem[];
    try {
      items = parseDailyStudyPlanItems(existing.items);
    } catch {
      return null;
    }
    const reconciled = reconcilePlanItems(items, workspaces, localDate, existing.timeZone, now).items;
    const details = parsePlanDetails(existing.details);
    if (details.sources === planSourcesKey(workspaces)) return visiblePlanItems(reconciled, workspaces);
    // The workspaces changed since the plan was built: plan again the way the
    // Today view does, keeping check-offs, so both name the same work.
    const rebuilt = buildDailyStudyPlan({
      workspaces,
      localDate,
      dailyMinutes: normalizeDailyMinutes(config?.dailyMinutes ?? DEFAULT_DAILY_MINUTES),
      todayMinutes: details.budgetOverride ? details.budgetMinutes : undefined,
      previous: await loadPreviousPlan(userId, localDate),
      current: { items: reconciled, progress: details.progress },
      refresh: true,
      weightOf: gradesWeightResolver(),
    });
    const next = reconcilePlanItems(rebuilt.items, workspaces, localDate, existing.timeZone, now).items;
    await prisma.dailyStudyPlan
      .updateMany({
        where: { id: existing.id, userId, items: existing.items },
        data: {
          items: JSON.stringify(next),
          details: JSON.stringify(rebuilt.details),
          sourceCount: rebuilt.sourceCount,
          candidateCount: rebuilt.candidateCount,
          generatedAt: now,
        },
      })
      .catch(() => undefined);
    return visiblePlanItems(next, workspaces);
  }

  const previous = await loadPreviousPlan(userId, localDate);
  const built = buildDailyStudyPlan({
    workspaces,
    localDate,
    dailyMinutes: normalizeDailyMinutes(config?.dailyMinutes ?? DEFAULT_DAILY_MINUTES),
    previous,
    current: null,
    weightOf: gradesWeightResolver(),
  });
  const items = reconcilePlanItems(built.items, workspaces, localDate, timeZone, now).items;
  // An old-format plan for today is left for the Today view to upgrade.
  if (existing) return items;

  try {
    await prisma.dailyStudyPlan.create({
      data: {
        userId,
        localDate,
        timeZone,
        summary: "",
        items: JSON.stringify(items),
        version: PLAN_VERSION,
        details: JSON.stringify(built.details),
        sourceCount: built.sourceCount,
        candidateCount: built.candidateCount,
        generatedAt: now,
      },
    });
  } catch (error) {
    // The student planned their day at the same moment: theirs wins.
    if (!isUniqueViolation(error)) throw error;
    return ensureTodayPlan(userId, localDate, timeZone, workspaces, now);
  }
  // Visible in the Agent Center history like any automatic run.
  await prisma.agentRun
    .create({
      data: {
        userId,
        agentKey: DAILY_STUDY_AGENT_KEY,
        trigger: "auto",
        status: "completed",
        summary: JSON.stringify({
          v: 2,
          items: items.length,
          minutes: items.reduce((sum, item) => sum + item.minutes, 0),
          workspaces: new Set(items.map((item) => item.target.workspaceId)).size,
          ...(built.details.workload?.overloaded ? { overloaded: true } : {}),
        }),
        startedAt: now,
        completedAt: now,
      },
    })
    .catch(() => undefined);
  return items;
}

async function loadPreviousPlan(userId: string, localDate: string): Promise<PreviousPlan | null> {
  const row = await prisma.dailyStudyPlan.findFirst({
    where: { userId, localDate: { lt: localDate, gte: addDays(localDate, -ROLL_FORWARD_WINDOW_DAYS) } },
    orderBy: { localDate: "desc" },
    select: { localDate: true, items: true, version: true, details: true },
  });
  if (!row || row.version < PLAN_VERSION) return null;
  try {
    return {
      localDate: row.localDate,
      items: parseDailyStudyPlanItems(row.items),
      progress: parsePlanDetails(row.details).progress,
    };
  } catch {
    return null;
  }
}
