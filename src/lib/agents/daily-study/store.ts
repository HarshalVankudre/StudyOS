import "server-only";

import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/db";
import { safeParseWorkspace } from "@/lib/workspace/schema";
import type { Workspace } from "@/lib/workspace/types";
import { buildDailyStudyPlan, normalizeDailyMinutes } from "./planner";
import {
  DAILY_STUDY_AGENT_KEY,
  DEFAULT_DAILY_MINUTES,
  parseDailyStudyPlanItems,
  type AgentCenterSnapshot,
  type AgentRunData,
  type DailyStudyAgentConfigData,
  type DailyStudyPlanData,
} from "./types";

const DEFAULT_TIME_ZONE = "UTC";
const MAX_HISTORY_ROWS = 20;

export interface RunDailyStudyAgentInput {
  trigger: "auto" | "manual";
  timeZone?: string;
}

export interface UpdateDailyStudyAgentConfigInput {
  enabled: boolean;
  dailyMinutes: number;
  timeZone?: string;
}

export async function getAgentCenterSnapshot(
  historyLimit = 10,
): Promise<AgentCenterSnapshot> {
  const userId = await requireUserId();
  const configRow = await prisma.dailyStudyAgentConfig.findUnique({
    where: { userId },
  });
  const config = mapConfig(configRow);
  const localDate = localDateInTimeZone(config.timeZone);

  const [planRow, runRows] = await Promise.all([
    prisma.dailyStudyPlan.findUnique({
      where: { userId_localDate: { userId, localDate } },
    }),
    prisma.agentRun.findMany({
      where: { userId, agentKey: DAILY_STUDY_AGENT_KEY },
      orderBy: { startedAt: "desc" },
      take: clamp(Math.round(historyLimit), 1, MAX_HISTORY_ROWS),
    }),
  ]);

  return {
    config,
    plan: mapPlan(planRow),
    runs: runRows.map(mapRun),
  };
}

export async function getDailyStudyAgentOverview(): Promise<
  Pick<AgentCenterSnapshot, "config" | "plan">
> {
  const userId = await requireUserId();
  const configRow = await prisma.dailyStudyAgentConfig.findUnique({
    where: { userId },
  });
  const config = mapConfig(configRow);
  const localDate = localDateInTimeZone(config.timeZone);
  const planRow = await prisma.dailyStudyPlan.findUnique({
    where: { userId_localDate: { userId, localDate } },
  });
  return { config, plan: mapPlan(planRow) };
}

/**
 * Build today's plan from every workspace the current user owns. Automatic
 * runs are idempotent per local day; manual runs intentionally regenerate it.
 */
export async function runDailyStudyAgent(
  input: RunDailyStudyAgentInput,
): Promise<DailyStudyPlanData | null> {
  const userId = await requireUserId();
  const requestedTimeZone = normalizeTimeZone(input.timeZone);
  const existingConfig = await prisma.dailyStudyAgentConfig.findUnique({
    where: { userId },
  });
  const config = mapConfig(existingConfig);
  const timeZone = input.timeZone ? requestedTimeZone : config.timeZone;
  const localDate = localDateInTimeZone(timeZone);

  if (input.trigger === "auto" && !config.enabled) return null;

  if (input.trigger === "auto") {
    const existingPlan = await prisma.dailyStudyPlan.findUnique({
      where: { userId_localDate: { userId, localDate } },
    });
    const parsedExistingPlan = mapPlan(existingPlan);
    if (parsedExistingPlan) return parsedExistingPlan;
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
    const built = buildDailyStudyPlan(
      workspaces,
      localDate,
      config.dailyMinutes,
    );
    const generatedAt = new Date();
    const planRow = await prisma.dailyStudyPlan.upsert({
      where: { userId_localDate: { userId, localDate } },
      create: {
        userId,
        localDate,
        timeZone,
        summary: built.summary,
        items: JSON.stringify(built.items),
        sourceCount: built.sourceCount,
        candidateCount: built.candidateCount,
        generatedAt,
      },
      update: {
        timeZone,
        summary: built.summary,
        items: JSON.stringify(built.items),
        sourceCount: built.sourceCount,
        candidateCount: built.candidateCount,
        generatedAt,
      },
    });

    await prisma.agentRun.updateMany({
      where: { id: run.id, userId, status: "running" },
      data: {
        status: "completed",
        summary: built.summary,
        completedAt: new Date(),
      },
    });

    return mapPlan(planRow);
  } catch (error) {
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

export async function setDailyStudyItemCompleted(
  planId: string,
  itemId: string,
  completed: boolean,
): Promise<boolean> {
  const userId = await requireUserId();
  const row = await prisma.dailyStudyPlan.findFirst({
    where: { id: planId, userId },
    select: { items: true },
  });
  if (!row) return false;

  const items = parseDailyStudyPlanItems(row.items);
  const item = items.find((candidate) => candidate.id === itemId);
  if (!item) return false;
  item.completed = completed;

  const result = await prisma.dailyStudyPlan.updateMany({
    where: { id: planId, userId },
    data: { items: JSON.stringify(items) },
  });
  return result.count === 1;
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

async function loadOwnedWorkspaces(userId: string): Promise<Workspace[]> {
  const rows = await prisma.workspace.findMany({
    where: { ownerId: userId },
    orderBy: { updatedAt: "desc" },
    select: { id: true, data: true },
  });

  return rows.flatMap((row) => {
    try {
      const parsed = safeParseWorkspace(JSON.parse(row.data));
      return parsed.success ? [{ ...parsed.data, id: row.id }] : [];
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

function mapPlan(
  row:
    | {
        id: string;
        localDate: string;
        timeZone: string;
        summary: string;
        items: string;
        sourceCount: number;
        candidateCount: number;
        generatedAt: Date;
      }
    | null,
): DailyStudyPlanData | null {
  if (!row) return null;
  try {
    return {
      id: row.id,
      localDate: row.localDate,
      timeZone: row.timeZone,
      summary: row.summary,
      items: parseDailyStudyPlanItems(row.items),
      sourceCount: row.sourceCount,
      candidateCount: row.candidateCount,
      generatedAt: row.generatedAt,
    };
  } catch {
    return null;
  }
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
    summary: row.summary,
    error: row.error,
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
