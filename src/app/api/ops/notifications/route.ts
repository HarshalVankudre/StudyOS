import { defaultChannels } from "@/lib/notifications/channels";
import { runNotificationDispatch } from "@/lib/notifications/dispatch";
import { prismaNotificationStore } from "@/lib/notifications/store";
import { reportError } from "@/lib/ops/report-error";
import { bearerToken, secretsMatch } from "@/lib/ops/secret";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// One run stops claiming new students after ~45 s (lib/notifications/dispatch).
export const maxDuration = 60;

/**
 * Notifications dispatch for Cloud Scheduler, every 5 minutes:
 *   POST /api/ops/notifications   Authorization: Bearer $MAINTENANCE_SECRET
 * 404 when MAINTENANCE_SECRET is not configured, 401 on a wrong or missing
 * secret. Without VAPID keys there is no channel and the run does nothing.
 * Safe to call more often, twice at once, or again after a failure: nothing
 * is ever sent twice (see dispatch.ts).
 */
export async function POST(req: Request) {
  const expected = process.env.MAINTENANCE_SECRET;
  if (!expected) return new Response("Not found", { status: 404 });

  const presented = bearerToken(req);
  if (!presented || !secretsMatch(presented, expected)) {
    return new Response("Unauthorized", { status: 401 });
  }

  const channels = defaultChannels();
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
