import { retryOrphanedAssetDeletes } from "@/lib/account/erase-user-data";
import { retryOrphanedNotebookFiles } from "@/lib/notebooks/server/store";
import { reseedNotificationSchedules } from "@/lib/notifications/service";
import { reportError } from "@/lib/ops/report-error";
import { runRetention } from "@/lib/ops/retention";
import { bearerToken, maintenanceSecret, secretsMatch } from "@/lib/ops/secret";
import { retryPendingReferralRewards } from "@/lib/referral/reward";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Data-retention job for Cloud Scheduler:
 *   POST /api/ops/maintenance   Authorization: Bearer $MAINTENANCE_SECRET
 * 404 when MAINTENANCE_SECRET is not configured (the route does not exist),
 * 401 on a wrong or missing secret.
 */
export async function POST(req: Request) {
  const expected = maintenanceSecret();
  if (!expected) return new Response("Not found", { status: 404 });

  const presented = bearerToken(req);
  if (!presented || !secretsMatch(presented, expected)) {
    return new Response("Unauthorized", { status: 401 });
  }

  try {
    const result = await runRetention();
    // Files of deleted accounts that could not be removed at deletion time.
    const orphanedAssets = await retryOrphanedAssetDeletes().catch((error) => {
      reportError(error, { source: "api", route: "/api/ops/maintenance", method: "POST" });
      return null;
    });
    // Invite rewards that had to wait (unverified email, Clerk or the
    // database unreachable at the friend's first charged build).
    const referralRewards = await retryPendingReferralRewards().catch((error) => {
      reportError(error, { source: "api", route: "/api/ops/maintenance", method: "POST" });
      return null;
    });
    // Students with a device or email on who fell off the notifications
    // schedule (a channel briefly not configured, a failed release).
    const notificationSchedules = await reseedNotificationSchedules().catch((error) => {
      reportError(error, { source: "api", route: "/api/ops/maintenance", method: "POST" });
      return null;
    });
    // Imported notebook PDFs whose stored object could not be deleted when
    // their notebook was purged or their account erased.
    const orphanedNotebookFiles = await retryOrphanedNotebookFiles().catch((error) => {
      reportError(error, { source: "api", route: "/api/ops/maintenance", method: "POST" });
      return null;
    });
    // One structured INFO line (counts only) for Cloud Logging.
    console.log(
      JSON.stringify({
        severity: "INFO",
        message: "[StudyOS] retention run",
        result,
        orphanedAssets,
        referralRewards,
        notificationSchedules,
        orphanedNotebookFiles,
      }),
    );
    return Response.json({ ok: true, result, orphanedAssets, referralRewards, notificationSchedules, orphanedNotebookFiles });
  } catch (error) {
    reportError(error, { source: "api", route: "/api/ops/maintenance", method: "POST" });
    return Response.json({ ok: false }, { status: 500 });
  }
}
