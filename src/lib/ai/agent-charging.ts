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
 *  - A turn never costs more than the plan's per-message cap (TURN_CREDIT_CAP,
 *    shown on the pricing page), its sandbox renders included: the model
 *    charge is clamped to the cap minus what the turn's renders were charged
 *    (the loop sizes calls from estimates and credits round up, so without
 *    the clamp a turn could end a little above it).
 */
import "server-only";

import { claimWithinLimit } from "@/lib/usage-limits";
import {
  chargeCredits,
  releaseCreditHold,
  settleCreditHold,
  usageToCredits,
  type CreditHold,
} from "@/lib/credits";
import type { TokenUsage } from "./usage-meter";
import { takeSandboxCreditsCharged } from "./tools/sandbox-tool";

/** Uncharged failed turns allowed per student per rolling day. */
export const FREE_FAILURES_PER_DAY = 3;
/** UsageEvent kind recording an uncharged failure (pruned with rate-limit kinds). */
export const AGENT_FREE_FAILURE_KIND = "agent_free_failure";
const DAY_MS = 24 * 60 * 60 * 1000;

export type AgentTurnOutcome = "completed" | "cancelled" | "failed";

/**
 * Whether this failure may go uncharged, and if so records it. Counted and
 * recorded atomically per user (lib/usage-limits claimWithinLimit), so a
 * burst of parallel failures cannot slip past the allowance.
 */
export async function claimFreeFailure(userId: string): Promise<boolean> {
  const claim = await claimWithinLimit(userId, AGENT_FREE_FAILURE_KIND, FREE_FAILURES_PER_DAY, DAY_MS);
  return claim.allowed;
}

/** Credits the outcome is billed, before the free-failure allowance. */
export function creditsForOutcome(usage: TokenUsage, model: string): number {
  return usageToCredits(usage, model);
}

/**
 * Settle a turn: charge what the policy says and return the credits actually
 * removed (never below a zero balance). With a `hold` (the route reserves the
 * turn's spend ceiling with reserveCredits before any model work), the hold
 * is settled to the real cost, or released in full when the outcome is free.
 * With `capCredits`, the model charge is clamped so the turn's total (its
 * sandbox renders, tallied under `taskId`, included) stays within it.
 */
export async function settleAgentTurn(input: {
  userId: string;
  usage: TokenUsage;
  model: string;
  outcome: AgentTurnOutcome;
  hold?: CreditHold | null;
  capCredits?: number;
  taskId?: string | null;
}): Promise<number> {
  const free = async () => {
    if (input.hold) await releaseCreditHold(input.hold);
    return 0;
  };
  const sandbox = input.taskId ? takeSandboxCreditsCharged(input.taskId) : 0;
  const raw = creditsForOutcome(input.usage, input.model);
  const credits =
    input.capCredits === undefined ? raw : Math.min(raw, Math.max(0, input.capCredits - sandbox));
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
