/**
 * Per-user usage limits (server-only).
 *
 * Credits bound how much a user can spend in total; these limits bound how
 * FAST anyone can spend (abuse, runaway clients, cost spikes). Counts live in
 * the database (UsageEvent), so limits hold across serverless instances.
 *
 * The check counts and records in one transaction holding a per-user,
 * per-kind advisory lock (lib/db-lock), so parallel requests cannot all pass
 * at the boundary: each sees the events the others recorded.
 */
import { prisma } from "@/lib/db";
import { userLockKey, withKeyLock } from "@/lib/db-lock";
import { USAGE_LIMITS, type LimitedKind } from "@/lib/price-list";

// The caps per plan are part of the plan definitions (lib/price-list.ts),
// which the pricing page reads too.
export { USAGE_LIMITS, type LimitedKind };

/**
 * Workspaces one account may store, trash included (trashed ones still take
 * space until they are purged). Far beyond any student's semesters; stops
 * scripted mass creation of 2 MB documents.
 */
export const MAX_WORKSPACES_PER_USER = 200;

/** True when the user already stores MAX_WORKSPACES_PER_USER workspaces. */
export async function workspaceLimitReached(userId: string): Promise<boolean> {
  const stored = await prisma.workspace.count({ where: { ownerId: userId } });
  return stored >= MAX_WORKSPACES_PER_USER;
}

/** Max simultaneously running agent tasks per user (see AgentTask). */
export const MAX_CONCURRENT_AGENT_TASKS = 3;

async function isProUser(userId: string): Promise<boolean> {
  const sub = await prisma.subscription.findUnique({ where: { userId } });
  return sub?.status === "active";
}

/**
 * Enforce a usage limit: returns { allowed: true } and records the event, or
 * { allowed: false } when the window is exhausted. Count and record happen
 * atomically per user and kind, so N parallel requests at the boundary let
 * exactly the remaining number through. Fails open when the database errors.
 */
export async function checkUsageLimit(
  userId: string,
  kind: LimitedKind,
): Promise<{ allowed: boolean; remaining: number }> {
  const cfg = USAGE_LIMITS[kind];
  const limit = (await isProUser(userId)) ? cfg.pro : cfg.free;
  try {
    return await claimWithinLimit(userId, kind, limit, cfg.windowMs);
  } catch {
    // Fail open on a database hiccup: the limit is a throttle, and an outage
    // of it must not become an outage of the product. Credits still bound spend.
    return { allowed: true, remaining: 0 };
  }
}

/**
 * Record one `kind` event for the user if fewer than `limit` were recorded in
 * the last `windowMs`, atomically (see lib/db-lock). For limits that are not
 * in USAGE_LIMITS (the agent's free-failure allowance, for one).
 */
export async function claimWithinLimit(
  userId: string,
  kind: string,
  limit: number,
  windowMs: number,
): Promise<{ allowed: boolean; remaining: number }> {
  return withKeyLock(userLockKey(`usage:${kind}`, userId), async (tx) => {
    const since = new Date(Date.now() - windowMs);
    const used = await tx.usageEvent.count({
      where: { userId, kind, createdAt: { gte: since } },
    });
    if (used >= limit) return { allowed: false, remaining: 0 };
    await tx.usageEvent.create({ data: { userId, kind } });
    return { allowed: true, remaining: limit - used - 1 };
  });
}

/**
 * True when `kind`'s window is exhausted, WITHOUT recording anything. For
 * limits on outcomes (generate_failed) that are recorded only when the
 * outcome happens, with recordUsageEvent.
 */
export async function isUsageLimitReached(userId: string, kind: LimitedKind): Promise<boolean> {
  const cfg = USAGE_LIMITS[kind];
  const limit = (await isProUser(userId)) ? cfg.pro : cfg.free;
  const used = await prisma.usageEvent.count({
    where: { userId, kind, createdAt: { gte: new Date(Date.now() - cfg.windowMs) } },
  });
  return used >= limit;
}

/**
 * For outcome limits (generate_failed, study_kit_failed): claim one slot of
 * `kind` up front, before the work starts, and return its event id, or null
 * when the window is already full. Counted and recorded atomically, so work
 * in flight counts as a possible failure and parallel requests cannot all
 * start past the quota. Withdraw the claim with releaseOutcomeSlot when the
 * work ends any other way than the outcome being limited. Fails open.
 */
export async function claimOutcomeSlot(
  userId: string,
  kind: LimitedKind,
): Promise<{ allowed: boolean; slot: string | null }> {
  const cfg = USAGE_LIMITS[kind];
  const limit = (await isProUser(userId)) ? cfg.pro : cfg.free;
  try {
    return await withKeyLock(userLockKey(`usage:${kind}`, userId), async (tx) => {
      const used = await tx.usageEvent.count({
        where: { userId, kind, createdAt: { gte: new Date(Date.now() - cfg.windowMs) } },
      });
      if (used >= limit) return { allowed: false, slot: null };
      const row = await tx.usageEvent.create({ data: { userId, kind }, select: { id: true } });
      return { allowed: true, slot: row.id };
    });
  } catch {
    return { allowed: true, slot: null };
  }
}

/** Withdraw a slot claimed with claimOutcomeSlot (the limited outcome did not happen). Never throws. */
export async function releaseOutcomeSlot(slot: string | null): Promise<void> {
  if (!slot) return;
  await prisma.usageEvent.deleteMany({ where: { id: slot } }).catch(() => {});
}

/** Record one event of a limited kind. Never throws. */
export async function recordUsageEvent(userId: string, kind: LimitedKind): Promise<void> {
  await prisma.usageEvent.create({ data: { userId, kind } }).catch(() => {});
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
