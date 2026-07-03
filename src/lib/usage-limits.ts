/**
 * Per-user usage limits (server-only).
 *
 * Credits bound how much a user can spend in total; these limits bound how
 * FAST anyone can spend (abuse, runaway clients, cost spikes). Counts live in
 * the database (UsageEvent), so limits hold across serverless instances.
 *
 * The check is count-then-insert without a transaction: two racing requests
 * can each pass at the boundary. That's fine — the limit is a throttle, not a
 * ledger, and being off by one request is harmless.
 */
import { prisma } from "@/lib/db";

export type LimitedKind = "generate" | "agent" | "sandbox_run";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

/** Per-window request caps. Generous for real users, hard walls for abuse. */
export const USAGE_LIMITS: Record<
  LimitedKind,
  { free: number; pro: number; windowMs: number }
> = {
  // Workspace generations are the most expensive request (~100s of model time).
  generate: { free: 10, pro: 30, windowMs: HOUR },
  // Agent chat turns.
  agent: { free: 60, pro: 180, windowMs: HOUR },
  // Sandbox runs cost real Daytona compute per call — cap per day.
  sandbox_run: { free: 20, pro: 60, windowMs: DAY },
};

/** Max simultaneously running agent tasks per user (see AgentTask). */
export const MAX_CONCURRENT_AGENT_TASKS = 3;

async function isProUser(userId: string): Promise<boolean> {
  const sub = await prisma.subscription.findUnique({ where: { userId } });
  return sub?.status === "active";
}

/**
 * Enforce a usage limit: returns { allowed: true } and records the event, or
 * { allowed: false } when the window is exhausted. Never throws on DB hiccups
 * in the recording step — the action proceeds (fail-open keeps limits from
 * becoming an outage).
 */
export async function checkUsageLimit(
  userId: string,
  kind: LimitedKind,
): Promise<{ allowed: boolean; remaining: number }> {
  const cfg = USAGE_LIMITS[kind];
  const limit = (await isProUser(userId)) ? cfg.pro : cfg.free;
  const since = new Date(Date.now() - cfg.windowMs);
  const used = await prisma.usageEvent.count({
    where: { userId, kind, createdAt: { gte: since } },
  });
  if (used >= limit) return { allowed: false, remaining: 0 };
  await prisma.usageEvent
    .create({ data: { userId, kind } })
    .catch(() => {});
  return { allowed: true, remaining: limit - used - 1 };
}

/**
 * Fire-and-forget funnel event (first-party analytics). Kinds are namespaced
 * "evt:*" so they never collide with rate-limited kinds.
 */
export function recordFunnelEvent(userId: string, name: string): void {
  void prisma.usageEvent
    .create({ data: { userId, kind: `evt:${name}` } })
    .catch(() => {});
}
