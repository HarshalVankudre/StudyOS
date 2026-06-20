/**
 * Durable agent-task records (server-only, owner-scoped).
 *
 * A task survives the user disconnecting: its status/result live in the DB for a
 * short window so the client can reconnect by id and still receive the outcome.
 * Every read/mutation is scoped to the authenticated user, and `cancelTask`
 * flips a flag the apply step checks before committing.
 */
import "server-only";

import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/db";
import type { AgentStreamEvent } from "@/lib/ai/agent-shared";

/** How long a finished task's status/result remains reconnectable. */
export const TASK_TTL_MS = 10 * 60 * 1000;

export type AgentTaskStatus = "running" | "done" | "cancelled" | "error";

async function requireUserId(): Promise<string> {
  const { userId } = await auth();
  if (!userId) throw new Error("Not authenticated");
  return userId;
}

export async function createTask(input: {
  workspaceId: string;
  baseVersion: number;
}): Promise<{ id: string }> {
  const userId = await requireUserId();
  return prisma.agentTask.create({
    data: {
      userId,
      workspaceId: input.workspaceId,
      baseVersion: input.baseVersion,
      status: "running",
      expiresAt: new Date(Date.now() + TASK_TTL_MS),
    },
    select: { id: true },
  });
}

/** Owner-scoped load for reconnect. Returns null for another user's task. */
export async function getTask(id: string) {
  const userId = await requireUserId();
  return prisma.agentTask.findFirst({ where: { id, userId } });
}

/** Cancel a running task. Returns true only if this user owned a running task. */
export async function cancelTask(id: string): Promise<boolean> {
  const userId = await requireUserId();
  const result = await prisma.agentTask.updateMany({
    where: { id, userId, status: "running" },
    data: { status: "cancelled" },
  });
  return result.count === 1;
}

/** True if the task was cancelled — consulted before applying a result. */
export async function isTaskCancelled(id: string): Promise<boolean> {
  const userId = await requireUserId();
  const row = await prisma.agentTask.findFirst({
    where: { id, userId },
    select: { status: true },
  });
  return row?.status === "cancelled";
}

export async function markTaskDone(id: string, result: string): Promise<void> {
  const userId = await requireUserId();
  await prisma.agentTask.updateMany({
    where: { id, userId, status: "running" },
    data: { status: "done", result },
  });
}

/** Append a sanitized progress event to the durable task (capped) for reconnect replay. */
export async function appendTaskEvent(id: string, event: AgentStreamEvent): Promise<void> {
  const userId = await requireUserId();
  const row = await prisma.agentTask.findFirst({ where: { id, userId }, select: { events: true } });
  if (!row) return;
  let events: AgentStreamEvent[] = [];
  if (row.events) {
    try { events = JSON.parse(row.events) as AgentStreamEvent[]; } catch { events = []; }
  }
  events.push(event);
  await prisma.agentTask.updateMany({
    where: { id, userId },
    data: { events: JSON.stringify(events.slice(-200)) },
  });
}

export async function markTaskError(id: string, error: string): Promise<void> {
  const userId = await requireUserId();
  await prisma.agentTask.updateMany({
    where: { id, userId },
    data: { status: "error", error },
  });
}
