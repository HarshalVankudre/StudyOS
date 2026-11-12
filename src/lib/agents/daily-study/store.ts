import "server-only";

import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/db";
import { reportError } from "@/lib/ops/report-error";
import { repairWorkspace } from "@/lib/workspace/repair";
import { updateWorkspaceWith } from "@/lib/workspace/store";
import type { Workspace } from "@/lib/workspace/types";
import { addDays } from "@/lib/workspace/view-logic";
import {
  buildDailyStudyPlan,
  normalizeDailyMinutes,
  normalizeTodayMinutes,
  planSourcesKey,
  visiblePlanDetails,
  visiblePlanItems,
  type PreviousPlan,
} from "./planner";
import { gradesWeightResolver } from "./grades-hook";
import { applyCompletion, reconcilePlanItems, writesThrough } from "./reconcile";
import {
  DAILY_STUDY_AGENT_KEY,
  DEFAULT_DAILY_MINUTES,
  PLAN_VERSION,
  parseDailyStudyPlanItems,
  parsePlanDetails,
  parseRunSummary,
  parseStoredItemStates,
  type AgentCenterSnapshot,
  type AgentRunData,
  type DailyStudyAgentConfigData,
  type DailyStudyPlanData,
  type DailyStudyPlanItem,
  type RunSummary,
  type TodayPlanView,
} from "./types";

const DEFAULT_TIME_ZONE = "UTC";
const MAX_HISTORY_ROWS = 20;
/** Plans older than this are not used for roll-forward (a fresh start). */
const ROLL_FORWARD_WINDOW_DAYS = 14;

export interface RunDailyStudyAgentInput {
  trigger: "auto" | "manual";
  timeZone?: string;
  /** Minutes for today only ("I have 30 minutes today"). */
  todayMinutes?: number;
}

export interface UpdateDailyStudyAgentConfigInput {
  enabled: boolean;
  dailyMinutes: number;
  timeZone?: string;
}

type PlanRow = {
  id: string;
  localDate: string;
  timeZone: string;
  items: string;
  version: number;
  details: string;
  sourceCount: number;
  candidateCount: number;
  generatedAt: Date;
};

export async function getAgentCenterSnapshot(
  historyLimit = 10,
): Promise<AgentCenterSnapshot> {
  const userId = await requireUserId();
  const [today, runRows] = await Promise.all([
    loadToday(userId),
    prisma.agentRun.findMany({
      where: { userId, agentKey: DAILY_STUDY_AGENT_KEY },
      orderBy: { startedAt: "desc" },
      take: clamp(Math.round(historyLimit), 1, MAX_HISTORY_ROWS),
    }),
  ]);
  return { ...today, runs: runRows.map(mapRun) };
}

/** Settings and today's plan, kept in line with the workspaces. */
export async function getDailyStudyAgentOverview(): Promise<
  Pick<AgentCenterSnapshot, "config" | "plan">
> {
  const userId = await requireUserId();
  return loadToday(userId);
}

/**
 * Build today's plan from every workspace the current user owns. Automatic
 * runs are idempotent per local day; manual runs ("Rebuild from today")
 * re-plan the rest of the day, keeping what is already done.
 */
export async function runDailyStudyAgent(
  input: RunDailyStudyAgentInput,
): Promise<DailyStudyPlanData | null> {
  const userId = await requireUserId();
  const existingConfig = await prisma.dailyStudyAgentConfig.findUnique({
    where: { userId },
  });
  const config = mapConfig(existingConfig);
  const timeZone = input.timeZone ? normalizeTimeZone(input.timeZone) : config.timeZone;
  const localDate = localDateInTimeZone(timeZone);

  if (input.trigger === "auto" && !config.enabled) return null;

  const existing = await prisma.dailyStudyPlan.findUnique({
    where: { userId_localDate: { userId, localDate } },
  });
  if (input.trigger === "auto" && existing && existing.version >= PLAN_VERSION) {
    return mapPlan(existing);
  }

  await prisma.dailyStudyAgentConfig.upsert({
    where: { userId },
    create: {
      userId,
      enabled: config.enabled,
      dailyMinutes: config.dailyMinutes,
      timeZone,
    },
    update: { timeZone },
  });

  const run = await prisma.agentRun.create({
    data: {
      userId,
      agentKey: DAILY_STUDY_AGENT_KEY,
      trigger: input.trigger,
      status: "running",
    },
    select: { id: true },
  });

  try {
    const workspaces = await loadOwnedWorkspaces(userId);
    const planRow = await buildAndStore({
      userId,
      localDate,
      timeZone,
      dailyMinutes: config.dailyMinutes,
      todayMinutes: input.trigger === "manual" ? normalizeTodayMinutes(input.todayMinutes) : undefined,
      workspaces,
      existing,
    });
    const plan = mapPlan(planRow);
    const shown = plan ? visiblePlanItems(plan.items, workspaces) : [];
    const summary: RunSummary = {
      v: 2,
      items: shown.length,
      minutes: shown.reduce((sum, item) => sum + item.minutes, 0),
      workspaces: new Set(shown.map((item) => item.target.workspaceId)).size,
      ...(plan?.details.workload?.overloaded ? { overloaded: true } : {}),
    };

    await prisma.agentRun.updateMany({
      where: { id: run.id, userId, status: "running" },
      data: {
        status: "completed",
        summary: JSON.stringify(summary),
        completedAt: new Date(),
      },
    });

    return plan;
  } catch (error) {
    reportError(error, { source: "daily-study.run" });
    await prisma.agentRun
      .updateMany({
        where: { id: run.id, userId, status: "running" },
        data: {
          status: "failed",
          error: safeErrorMessage(error),
          completedAt: new Date(),
        },
      })
      .catch(() => {});
    throw new Error("The Daily Study Agent could not build a plan.");
  }
}

export async function updateDailyStudyAgentConfig(
  input: UpdateDailyStudyAgentConfigInput,
): Promise<DailyStudyAgentConfigData> {
  const userId = await requireUserId();
  const current = await prisma.dailyStudyAgentConfig.findUnique({
    where: { userId },
  });
  const timeZone = input.timeZone
    ? normalizeTimeZone(input.timeZone)
    : mapConfig(current).timeZone;
  const dailyMinutes = normalizeDailyMinutes(input.dailyMinutes);

  const row = await prisma.dailyStudyAgentConfig.upsert({
    where: { userId },
    create: {
      userId,
      enabled: input.enabled,
      dailyMinutes,
      timeZone,
    },
    update: { enabled: input.enabled, dailyMinutes, timeZone },
  });
  return mapConfig(row);
}

export type SetItemResult =
  | { ok: true; completed: boolean; wroteThrough: boolean }
  | { ok: false; reason: "not_found" | "conflict" };

/**
 * Check a plan item off (or back on). Where it makes sense the source is
 * completed too, through the version-checked workspace save: a to-do gets
 * checked, a row gets its database's done value. `finish` asks to complete a
 * work session's row as well ("I finished it"). Unchecking reopens whatever
 * StudyOS completed.
 */
export async function setDailyStudyItemCompleted(
  planId: string,
  itemId: string,
  completed: boolean,
  options: { finish?: boolean } = {},
): Promise<SetItemResult> {
  const userId = await requireUserId();
  const row = await prisma.dailyStudyPlan.findFirst({
    where: { id: planId, userId },
    select: { items: true, version: true },
  });
  if (!row || row.version < PLAN_VERSION) return { ok: false, reason: "not_found" };

  let items: DailyStudyPlanItem[];
  try {
    items = parseDailyStudyPlanItems(row.items);
  } catch {
    return { ok: false, reason: "not_found" };
  }
  const index = items.findIndex((candidate) => candidate.id === itemId);
  if (index < 0) return { ok: false, reason: "not_found" };
  let item = items[index];

  const reopenSource = !completed && (item.mode === "finish" || item.restore !== undefined);
  const touchSource = completed ? writesThrough(item, options.finish) : reopenSource && writesThrough(item, true);
  let wroteThrough = false;

  if (touchSource) {
    const result = await updateWorkspaceWith(item.target.workspaceId, (draft) => {
      const outcome = applyCompletion(draft, item, completed);
      return { changed: outcome.changed, result: outcome };
    });
    if (result.status === "conflict") return { ok: false, reason: "conflict" };
    if (result.status === "saved" || result.status === "unchanged") {
      wroteThrough = result.result.applied;
      if (completed && result.result.restore !== undefined) {
        item = { ...item, restore: result.result.restore };
      }
      if (!result.result.applied && item.mode === "finish") {
        // The source cannot be completed (no done column): keep it plan-only.
        item = { ...item, mode: "session" };
      }
      if (completed && options.finish && result.result.applied && item.mode === "session") {
        item = { ...item, mode: "finish" };
      }
    }
  }

  const next: DailyStudyPlanItem = { ...item, completed };
  if (completed) next.completedAt = new Date().toISOString();
  else {
    delete next.completedAt;
    if (wroteThrough) delete next.restore;
  }
  items[index] = next;

  const update = await prisma.dailyStudyPlan.updateMany({
    where: { id: planId, userId },
    data: { items: JSON.stringify(items) },
  });
  if (update.count !== 1) return { ok: false, reason: "not_found" };
  return { ok: true, completed, wroteThrough };
}

export function localDateInTimeZone(
  timeZone: string,
  now = new Date(),
): string {
  const normalized = normalizeTimeZone(timeZone);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: normalized,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((candidate) => candidate.type === type)?.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function normalizeTimeZone(value: string | undefined): string {
  const candidate = value?.trim().slice(0, 100);
  if (!candidate) return DEFAULT_TIME_ZONE;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: candidate }).format();
    return candidate;
  } catch {
    return DEFAULT_TIME_ZONE;
  }
}

// ---------------------------------------------------------------------------
// Internals

async function loadToday(
  userId: string,
): Promise<Pick<AgentCenterSnapshot, "config" | "plan">> {
  const configRow = await prisma.dailyStudyAgentConfig.findUnique({
    where: { userId },
  });
  const config = mapConfig(configRow);
  const localDate = localDateInTimeZone(config.timeZone);
  let planRow: PlanRow | null = await prisma.dailyStudyPlan.findUnique({
    where: { userId_localDate: { userId, localDate } },
  });
  if (!planRow) return { config, plan: null };

  let workspaces: Workspace[] | null = null;
  try {
    workspaces = await loadOwnedWorkspaces(userId);
    const stored = planRow.version >= PLAN_VERSION ? mapPlan(planRow) : null;
    if (planRow.version < PLAN_VERSION) {
      // A plan stored as English sentences: rebuild it in structured form,
      // keeping what the student had already checked off.
      planRow = await buildAndStore({
        userId,
        localDate,
        timeZone: planRow.timeZone,
        dailyMinutes: config.dailyMinutes,
        workspaces,
        existing: planRow,
      });
    } else if (stored && stored.details.sources !== planSourcesKey(workspaces)) {
      // The workspaces changed since the plan was built (the first workspace
      // was generated, one was duplicated, restored or trashed, or deadlines
      // were imported): plan again, keeping what is checked off and today's
      // chosen amount of time.
      planRow = await buildAndStore({
        userId,
        localDate,
        timeZone: planRow.timeZone,
        dailyMinutes: config.dailyMinutes,
        todayMinutes: stored.details.budgetOverride ? stored.details.budgetMinutes : undefined,
        refresh: true,
        workspaces,
        existing: planRow,
      });
    } else {
      const plan = stored;
      if (plan) {
        const reconciled = reconcilePlanItems(plan.items, workspaces, localDate, plan.timeZone);
        if (reconciled.changed) {
          await prisma.dailyStudyPlan.updateMany({
            where: { id: planRow.id, userId },
            data: { items: JSON.stringify(reconciled.items) },
          });
          planRow = { ...planRow, items: JSON.stringify(reconciled.items) };
        }
      }
    }
  } catch (error) {
    // Showing the stored plan as it is beats showing none.
    reportError(error, { source: "daily-study.load" });
  }

  const plan = mapPlan(planRow);
  return { config, plan: plan && plan.version >= PLAN_VERSION ? toView(plan, workspaces) : null };
}

async function buildAndStore(input: {
  userId: string;
  localDate: string;
  timeZone: string;
  dailyMinutes: number;
  todayMinutes?: number;
  /** An automatic refresh after the workspaces changed (see planner `refresh`). */
  refresh?: boolean;
  workspaces: Workspace[];
  existing: PlanRow | null;
}): Promise<PlanRow> {
  const { userId, localDate, timeZone, workspaces, existing } = input;
  const previous = await loadPreviousPlan(userId, localDate);

  // Rebuilding today: keep what is done. A version-1 plan only tells us
  // which ids were done; the same ids are used in version 2.
  let current: { items: DailyStudyPlanItem[]; progress?: Record<string, number> } | null = null;
  let legacyDone = new Set<string>();
  if (existing && existing.version >= PLAN_VERSION) {
    const parsed = mapPlan(existing);
    if (parsed) {
      const reconciled = reconcilePlanItems(parsed.items, workspaces, localDate, timeZone);
      current = { items: reconciled.items, progress: parsed.details.progress };
    }
  } else if (existing) {
    legacyDone = new Set(
      parseStoredItemStates(existing.items).filter((s) => s.completed).map((s) => s.id),
    );
  }

  const built = buildDailyStudyPlan({
    workspaces,
    localDate,
    dailyMinutes: input.dailyMinutes,
    todayMinutes: input.todayMinutes,
    previous,
    current,
    refresh: input.refresh,
    weightOf: gradesWeightResolver(),
  });

  let items = built.items;
  if (legacyDone.size > 0) {
    // Version-1 check-offs were plan-only; keep them that way.
    items = items.map((item) =>
      legacyDone.has(item.id)
        ? { ...item, completed: true, mode: item.mode === "finish" ? "session" : item.mode }
        : item,
    );
  }
  items = reconcilePlanItems(items, workspaces, localDate, timeZone).items;

  const data = {
    timeZone,
    summary: "",
    items: JSON.stringify(items),
    version: PLAN_VERSION,
    details: JSON.stringify(built.details),
    sourceCount: built.sourceCount,
    candidateCount: built.candidateCount,
    generatedAt: new Date(),
  };
  if (input.refresh && existing) {
    // Only replace the plan that was read: a check-off that landed while this
    // refresh was planning wins, and the next load plans again.
    const update = await prisma.dailyStudyPlan.updateMany({
      where: { id: existing.id, userId, items: existing.items },
      data,
    });
    if (update.count === 1) return { ...existing, ...data };
    const latest = await prisma.dailyStudyPlan.findUnique({
      where: { userId_localDate: { userId, localDate } },
    });
    return latest ?? existing;
  }
  return prisma.dailyStudyPlan.upsert({
    where: { userId_localDate: { userId, localDate } },
    create: { userId, localDate, ...data },
    update: data,
  });
}

/** The most recent plan before `localDate` (within two weeks), for roll-forward. */
async function loadPreviousPlan(userId: string, localDate: string): Promise<PreviousPlan | null> {
  const row = await prisma.dailyStudyPlan.findFirst({
    where: {
      userId,
      localDate: { lt: localDate, gte: addDays(localDate, -ROLL_FORWARD_WINDOW_DAYS) },
    },
    orderBy: { localDate: "desc" },
    select: { localDate: true, items: true, version: true, details: true },
  });
  if (!row) return null;
  if (row.version >= PLAN_VERSION) {
    try {
      const items = parseDailyStudyPlanItems(row.items);
      return { localDate: row.localDate, items, progress: parsePlanDetails(row.details).progress };
    } catch {
      // fall through to the tolerant reading
    }
  }
  return {
    localDate: row.localDate,
    items: parseStoredItemStates(row.items).map((s) => ({
      id: s.id,
      completed: s.completed,
      kind: "task" as const,
      mode: "session" as const,
      minutes: 0,
    })),
    progress: {},
  };
}

async function loadOwnedWorkspaces(userId: string): Promise<Workspace[]> {
  const rows = await prisma.workspace.findMany({
    // The agent never plans from workspaces in the trash.
    where: { ownerId: userId, deletedAt: null },
    orderBy: { updatedAt: "desc" },
    select: { id: true, data: true },
  });

  return rows.flatMap((row) => {
    try {
      const parsed = repairWorkspace(JSON.parse(row.data), { id: row.id });
      return parsed ? [{ ...parsed.workspace, id: row.id }] : [];
    } catch {
      return [];
    }
  });
}

async function requireUserId(): Promise<string> {
  const { userId } = await auth();
  if (!userId) throw new Error("Not authenticated");
  return userId;
}

function mapConfig(
  row:
    | {
        enabled: boolean;
        dailyMinutes: number;
        timeZone: string;
      }
    | null,
): DailyStudyAgentConfigData {
  return {
    enabled: row?.enabled ?? true,
    dailyMinutes: normalizeDailyMinutes(row?.dailyMinutes ?? DEFAULT_DAILY_MINUTES),
    timeZone: normalizeTimeZone(row?.timeZone),
  };
}

function mapPlan(row: PlanRow | null): DailyStudyPlanData | null {
  if (!row) return null;
  const version = row.version ?? 1;
  if (version < PLAN_VERSION) {
    return {
      id: row.id,
      localDate: row.localDate,
      timeZone: row.timeZone,
      version,
      items: [],
      details: parsePlanDetails(null),
      sourceCount: row.sourceCount,
      candidateCount: row.candidateCount,
      generatedAt: row.generatedAt,
    };
  }
  try {
    return {
      id: row.id,
      localDate: row.localDate,
      timeZone: row.timeZone,
      version,
      items: parseDailyStudyPlanItems(row.items),
      details: parsePlanDetails(row.details),
      sourceCount: row.sourceCount,
      candidateCount: row.candidateCount,
      generatedAt: row.generatedAt,
    };
  } catch {
    return null;
  }
}

/** `workspaces`: the student's current (not trashed) workspaces, when known. */
function toView(plan: DailyStudyPlanData, workspaces: Workspace[] | null): TodayPlanView {
  return {
    id: plan.id,
    localDate: plan.localDate,
    timeZone: plan.timeZone,
    items: workspaces ? visiblePlanItems(plan.items, workspaces) : plan.items,
    // Every part of Today comes from the same plan as the list it shows.
    details: workspaces ? visiblePlanDetails(plan.details, workspaces) : plan.details,
    sourceCount: plan.sourceCount,
    candidateCount: plan.candidateCount,
    generatedAt: plan.generatedAt.toISOString(),
  };
}

function mapRun(row: {
  id: string;
  trigger: string;
  status: string;
  summary: string | null;
  error: string | null;
  startedAt: Date;
  completedAt: Date | null;
}): AgentRunData {
  return {
    id: row.id,
    trigger: row.trigger === "auto" ? "auto" : "manual",
    status:
      row.status === "completed" || row.status === "failed"
        ? row.status
        : "running",
    // Older runs stored an English sentence; those show a localized status.
    result: parseRunSummary(row.summary),
    startedAt: row.startedAt,
    completedAt: row.completedAt,
  };
}

function safeErrorMessage(error: unknown): string {
  return (error instanceof Error ? error.message : "Unknown planner error").slice(
    0,
    500,
  );
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
