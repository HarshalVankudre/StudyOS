/**
 * The refusals a student sees when an AI action needs more credits than they
 * have. Each says what still works (everything they made, and studying,
 * which never uses credits). With payments switched on they point to Pro and
 * credit packs; without them (lib/stripe.ts isBillingConfigured) nothing can
 * be bought, so they say so instead. Free is a one-time trial: there is no
 * monthly top-up to wait for. Server only (reads the environment).
 */
import type { Dictionary } from "@/lib/i18n/dictionaries/en";
import { fmt } from "@/lib/i18n/interpolate";
import { isBillingConfigured } from "@/lib/stripe";

type T = Pick<Dictionary, "credits" | "spend">;

/** Out of credits (balance 0) for a build or an assistant request. */
export function outOfCreditsMessage(T: T, kind: "generate" | "agent", billing = isBillingConfigured()): string {
  if (!billing) return T.spend.outOfCredits;
  return kind === "agent" ? T.credits.outAgent : T.credits.outGenerate;
}

/** Some credits, but fewer than a build's price. */
export function belowBuildMinimumMessage(T: T, min: number, billing = isBillingConfigured()): string {
  return fmt(billing ? T.credits.belowGenerateMinimum : T.spend.belowMinimum, { min });
}

/** An assistant request priced above the balance (`cost` and `balance` already formatted). */
export function agentTooExpensiveMessage(
  T: T,
  vars: { cost: string; balance: string | number },
  billing = isBillingConfigured(),
): string {
  return fmt(billing ? T.credits.agentTooExpensive : T.spend.agentTooExpensive, vars);
}
