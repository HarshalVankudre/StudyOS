import { dispatchChannels } from "@/lib/notifications/channels";
import { runNotificationDispatch } from "@/lib/notifications/dispatch";
import { prismaNotificationStore } from "@/lib/notifications/store";
import { reportError } from "@/lib/ops/report-error";
import { bearerToken, maintenanceSecret, secretsMatch } from "@/lib/ops/secret";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// A run starts no new student after ~45 s; one started just before still
// finishes, which can take about 95 s more with a stalling mail server
// (lib/notifications/dispatch, "Time").
export const maxDuration = 150;

/**
 * Notifications dispatch for Cloud Scheduler, every 5 minutes:
 *   POST /api/ops/notifications   Authorization: Bearer $MAINTENANCE_SECRET
 * 404 when MAINTENANCE_SECRET is not configured, 401 on a wrong or missing
 * secret. With neither push nor email configured there is no channel and the
 * run does nothing (every student's schedule stays as it is).
 * Safe to call more often, twice at once, or again after a failure: nothing
 * is ever sent twice (see dispatch.ts).
 */
export async function POST(req: Request) {
  const expected = maintenanceSecret();
  if (!expected) return new Response("Not found", { status: 404 });

  const presented = bearerToken(req);
  if (!presented || !secretsMatch(presented, expected)) {
    return new Response("Unauthorized", { status: 401 });
  }

  const channels = dispatchChannels();
  if (channels.length === 0) return Response.json({ ok: true, skipped: "not_configured" });

  try {
    const result = await runNotificationDispatch({ store: prismaNotificationStore, channels });
    // Counts only, never who or where.
    console.log(JSON.stringify({ severity: "INFO", message: "[StudyOS] notifications dispatch", result }));
    return Response.json({ ok: true, result });
  } catch (error) {
    reportError(error, { source: "api", route: "/api/ops/notifications", method: "POST" });
    return Response.json({ ok: false }, { status: 500 });
  }
}
