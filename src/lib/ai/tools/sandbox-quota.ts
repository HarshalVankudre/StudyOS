// src/lib/ai/tools/sandbox-quota.ts
import "server-only";
import {
  releaseCreditHold,
  reserveCredits,
  RENDER_CREDITS as SANDBOX_RUN_CREDITS,
  settleCreditHold,
} from "@/lib/credits";
import { checkUsageLimit } from "@/lib/usage-limits";
import type { SandboxQuota } from "./sandbox-tool";

/**
 * The sandbox's cost guard. Every run spins a paid Daytona container, so a
 * run needs its flat price in credits AND a slot of the daily quota. The
 * credits are reserved first (atomically, so parallel runs cannot all start
 * on the same credits, and a broke user's refusal does not burn a quota
 * slot); if the quota then refuses, they go straight back. A run that
 * delivered an image settles the hold; any other outcome releases it.
 */
export function sandboxRunQuota(): SandboxQuota {
  return {
    reserve: async (ownerId) => {
      const hold = await reserveCredits(ownerId, {
        estimate: SANDBOX_RUN_CREDITS,
        min: SANDBOX_RUN_CREDITS,
        reason: "sandbox_run",
      });
      if (!hold) return { ok: false, reason: "credits" };
      let quota: { allowed: boolean };
      try {
        quota = await checkUsageLimit(ownerId, "sandbox_run");
      } catch (error) {
        await releaseCreditHold(hold).catch(() => false);
        throw error;
      }
      if (!quota.allowed) {
        await releaseCreditHold(hold).catch(() => false);
        return { ok: false, reason: "quota" };
      }
      return {
        ok: true,
        charge: {
          settle: async () => {
            await settleCreditHold(hold, SANDBOX_RUN_CREDITS);
          },
          release: async () => {
            await releaseCreditHold(hold);
          },
        },
      };
    },
  };
}
