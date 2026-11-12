import { auth } from "@clerk/nextjs/server";
import { pushConfigured } from "@/lib/notifications/config";
import { noStore, readJsonBody, sameOrigin } from "@/lib/notifications/http";
import { getNotificationSettings, saveNotificationPreferences } from "@/lib/notifications/service";
import { reportError } from "@/lib/ops/report-error";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The signed-in student's notification settings:
 *   GET  -> { configured, publicKey, preferences, devices, agentEnabled, dailyCap }
 *   PUT  { ...partial preferences } -> { preferences }
 * `configured: false` (no VAPID keys) tells the UI to hide every notification control.
 */
export async function GET() {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "unauthorized" }, { status: 401, headers: noStore });
  try {
    return Response.json(await getNotificationSettings(userId), { headers: noStore });
  } catch (error) {
    reportError(error, { source: "api", route: "/api/notifications/settings", method: "GET", userId });
    return Response.json({ error: "failed" }, { status: 500, headers: noStore });
  }
}

export async function PUT(req: Request) {
  if (!sameOrigin(req)) return Response.json({ error: "forbidden" }, { status: 403 });
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "unauthorized" }, { status: 401 });
  if (!pushConfigured()) return Response.json({ error: "not_found" }, { status: 404 });
  const body = await readJsonBody(req);
  if (!body) return Response.json({ error: "invalid" }, { status: 400 });
  try {
    const result = await saveNotificationPreferences(userId, body);
    if (!result.ok) return Response.json({ error: "invalid" }, { status: 400 });
    return Response.json({ preferences: result.preferences }, { headers: noStore });
  } catch (error) {
    reportError(error, { source: "api", route: "/api/notifications/settings", method: "PUT", userId });
    return Response.json({ error: "failed" }, { status: 500 });
  }
}
