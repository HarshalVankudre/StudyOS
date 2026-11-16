/**
 * Claiming an invite cookie for the signed-in student (server-only), from
 * wherever their first signed-in request after sign-up lands: the /app
 * layout and the /generate page (components/referral/ReferralClaim.tsx,
 * app/app/referral-actions.ts) and the build route itself (POST
 * /api/generate), so a friend whose first stop is the generator still earns
 * on that very build. Every rule is in attribution.ts; it is idempotent, so
 * all of them may run.
 */
import "server-only";

import { reportError } from "@/lib/ops/report-error";
import { attributeReferral } from "./attribution";

/**
 * Attribute `userId` to the invite in `cookieValue`. True when the cookie is
 * spent and should be cleared (recorded, refused, or unreadable: it will
 * never count); false when it must be kept for a later try (the program is
 * paused, or the database could not be reached: reported).
 */
export async function claimReferral(userId: string, cookieValue: string): Promise<boolean> {
  try {
    const outcome = await attributeReferral(userId, cookieValue);
    return !(outcome.kind === "skipped" && outcome.why === "paused");
  } catch (error) {
    reportError(error, { source: "referral-attribution", userId });
    return false;
  }
}
