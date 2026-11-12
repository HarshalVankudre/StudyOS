/**
 * How an agent turn is paid for (server-only). One assistant message has a
 * published price (lib/price-list.ts messageQuote); the policy, consistent
 * with the workspace generator:
 *  - A turn that finished (reply, question, change, or a stop at its limit)
 *    is charged the message price. When the model's real cost for it was
 *    higher (a long request, or an expensive model), its real cost instead,
 *    never more than the plan's per-message ceiling (quote.max).
 *  - A cancelled turn is charged the share of the price for the work it did
 *    before the stop (its model spend against the request's estimate), never
 *    more than the price (its real cost when that is higher, as above).
 *  - A turn that failed and changed nothing is not charged — up to
 *    FREE_FAILURES_PER_DAY per student per day. Beyond that, a failure is
 *    charged like a cancelled turn, so failing (or cancelling) on purpose can
 *    never buy unlimited free model work.
 *  - A refusal before any model ran (too few credits, stale workspace, rate
 *    limit), or a turn in which no model ran, costs nothing.
 *  - A turn never costs more than the plan's per-message ceiling
 *    (TURN_CREDIT_CAP, shown on the pricing page), its sandbox renders
 *    included: the message charge is clamped to the ceiling minus what the
 *    turn's renders were charged. A render that finishes after the turn was
 *    settled (a cancel while it ran) is charged only within the room the
 *    settle left under the ceiling (closeSandboxTally).
 */
import "server-only";

import { claimWithinLimit } from "@/lib/usage-limits";
import {
  chargeCredits,
  releaseCreditHold,
  settleCreditHold,
  usageToCredits,
  usageToUsd,
  type CreditHold,
} from "@/lib/credits";
import {
  chargeForCompleted,
  chargeForPartial,
  FREE_FAILURES_PER_DAY,
  type PriceQuote,
} from "@/lib/price-list";
import type { TokenUsage } from "./usage-meter";
import { closeSandboxTally, takeSandboxCreditsCharged } from "./tools/sandbox-tool";

export { FREE_FAILURES_PER_DAY };
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

/**
 * Credits an outcome is billed by the price list, before the free-failure
 * allowance and the ceiling's render room. `typicalUsd` is what this request
 * was expected to spend (the route's estimate): a stopped turn's share of
 * the price is its spend against it.
 */
export function creditsForOutcome(input: {
  usage: TokenUsage;
  model: string;
  outcome: AgentTurnOutcome;
  quote: PriceQuote;
  typicalUsd?: number;
}): number {
  const real = usageToCredits(input.usage, input.model);
  if (real <= 0) return 0; // no model ran
  if (input.outcome === "completed") return chargeForCompleted(input.quote, real);
  const typical = input.typicalUsd ?? 0;
  const fraction = typical > 0 ? usageToUsd(input.usage, input.model) / typical : 1;
  return chargeForPartial(input.quote, real, fraction);
}

/**
 * Settle a turn: charge what the policy says and return the credits actually
 * removed (never below a zero balance). With a `hold` (the route reserves the
 * turn's ceiling with reserveCredits before any model work), the hold is
 * settled to the charge, or released in full when the outcome is free.
 * With `capCredits` (the ceiling), the message charge is clamped so the
 * turn's total (its sandbox renders, tallied under `taskId`, included)
 * stays within it.
 */
export async function settleAgentTurn(input: {
  userId: string;
  usage: TokenUsage;
  model: string;
  outcome: AgentTurnOutcome;
  quote: PriceQuote;
  typicalUsd?: number;
  hold?: CreditHold | null;
  capCredits?: number;
  taskId?: string | null;
}): Promise<number> {
  const sandbox = input.taskId ? takeSandboxCreditsCharged(input.taskId) : 0;
  const raw = creditsForOutcome(input);
  const credits =
    input.capCredits === undefined ? raw : Math.min(raw, Math.max(0, input.capCredits - sandbox));
  // Close the render tally first (synchronously, before any await), with
  // the room this charge leaves, so a render landing mid-settle cannot use
  // room the message charge is about to take.
  if (input.taskId) {
    closeSandboxTally(input.taskId, input.capCredits === undefined ? Infinity : input.capCredits - sandbox - credits);
  }
  const free = async () => {
    if (input.hold) await releaseCreditHold(input.hold);
    return 0;
  };
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
