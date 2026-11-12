/**
 * How an agent turn is paid for (server-only). Policy, consistent with the
 * workspace generator:
 *  - A turn that finished (reply, question, change, or a stop at its limit)
 *    is charged for the tokens it actually used, priced per model.
 *  - A cancelled turn is charged for the tokens it used before the stop.
 *  - A turn that failed and changed nothing is not charged — up to
 *    FREE_FAILURES_PER_DAY per student per day. Beyond that, a failure is
 *    charged for what it consumed, so failing (or cancelling) on purpose can
 *    never buy unlimited free model work.
 *  - A refusal before any model ran (too few credits, stale workspace, rate
 *    limit) costs nothing.
 */
import "server-only";

import { prisma } from "@/lib/db";
import {
  chargeCredits,
  releaseCreditHold,
  settleCreditHold,
  usageToCredits,
  type CreditHold,
} from "@/lib/credits";
import type { TokenUsage } from "./usage-meter";

/** Uncharged failed turns allowed per student per rolling day. */
export const FREE_FAILURES_PER_DAY = 3;
/** UsageEvent kind recording an uncharged failure (pruned with rate-limit kinds). */
export const AGENT_FREE_FAILURE_KIND = "agent_free_failure";
const DAY_MS = 24 * 60 * 60 * 1000;

export type AgentTurnOutcome = "completed" | "cancelled" | "failed";

/**
 * Whether this failure may go uncharged, and if so records it. Count-then-
 * record (like lib/usage-limits): a burst of parallel failures can slip one or
 * two past the allowance, which only errs in the student's favour.
 */
export async function claimFreeFailure(userId: string, now = new Date()): Promise<boolean> {
  const since = new Date(now.getTime() - DAY_MS);
  const used = await prisma.usageEvent.count({
    where: { userId, kind: AGENT_FREE_FAILURE_KIND, createdAt: { gte: since } },
  });
  if (used >= FREE_FAILURES_PER_DAY) return false;
  await prisma.usageEvent.create({ data: { userId, kind: AGENT_FREE_FAILURE_KIND } }).catch(() => {});
  return true;
}

/** Credits the outcome is billed, before the free-failure allowance. */
export function creditsForOutcome(usage: TokenUsage, model: string): number {
  return usageToCredits(usage, model);
}

/**
 * Settle a turn: charge what the policy says and return the credits actually
 * removed (never below a zero balance). With a `hold` (the route reserves the
 * up-front estimate with reserveCredits before any model work), the hold is
 * settled to the real cost, or released in full when the outcome is free.
 */
export async function settleAgentTurn(input: {
  userId: string;
  usage: TokenUsage;
  model: string;
  outcome: AgentTurnOutcome;
  hold?: CreditHold | null;
}): Promise<number> {
  const free = async () => {
    if (input.hold) await releaseCreditHold(input.hold);
    return 0;
  };
  const credits = creditsForOutcome(input.usage, input.model);
  if (credits <= 0) return free();
  if (input.outcome === "failed" && (await claimFreeFailure(input.userId))) return free();
  const reason =
    input.outcome === "completed" ? "agent" : input.outcome === "cancelled" ? "agent_cancelled" : "agent_failed";
  if (input.hold) return settleCreditHold(input.hold, credits, { reason });
  return chargeCredits(input.userId, credits, reason);
}

/** Give the reserved estimate back (an outcome that is never charged). */
export async function releaseAgentHold(hold: CreditHold | null | undefined): Promise<void> {
  if (hold) await releaseCreditHold(hold);
}
