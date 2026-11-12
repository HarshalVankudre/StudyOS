import { auth } from "@clerk/nextjs/server";
import { z } from "zod";
import { pushConfigured } from "@/lib/notifications/config";
import { checkSubscription, deviceLabel } from "@/lib/notifications/endpoint";
import { readJsonBody, sameOrigin } from "@/lib/notifications/http";
import { addPushSubscription, getNotificationSettings, removePushSubscriptions } from "@/lib/notifications/service";
import { reportError } from "@/lib/ops/report-error";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Devices with notifications on.
 *   POST   { subscription, timeZone?, locale? }  add (or refresh) this browser
 *   DELETE { endpoint } | { all: true }          turn one device, or all, off
 * The endpoint is a capability URL: it is stored, never logged, never returned.
 */
export async function POST(req: Request) {
  if (!sameOrigin(req)) return Response.json({ error: "forbidden" }, { status: 403 });
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "unauthorized" }, { status: 401 });
  if (!pushConfigured()) return Response.json({ error: "not_found" }, { status: 404 });

  const body = (await readJsonBody(req)) as Record<string, unknown> | null;
  const check = checkSubscription(body?.subscription);
  if (!check.ok) return Response.json({ error: check.reason }, { status: 400 });
  try {
    await addPushSubscription(userId, check, {
      timeZone: typeof body?.timeZone === "string" ? body.timeZone : undefined,
      locale: typeof body?.locale === "string" ? body.locale : undefined,
      label: deviceLabel(req.headers.get("user-agent")),
    });
    const settings = await getNotificationSettings(userId);
    return Response.json({ ok: true, devices: settings.devices, preferences: settings.preferences });
  } catch (error) {
    reportError(error, { source: "api", route: "/api/notifications/subscriptions", method: "POST", userId });
    return Response.json({ error: "failed" }, { status: 500 });
  }
}

const removeSchema = z.union([
  z.object({ endpoint: z.string().min(1).max(2_000) }).strict(),
  z.object({ all: z.literal(true) }).strict(),
]);

export async function DELETE(req: Request) {
  if (!sameOrigin(req)) return Response.json({ error: "forbidden" }, { status: 403 });
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "unauthorized" }, { status: 401 });
  const parsed = removeSchema.safeParse(await readJsonBody(req));
  if (!parsed.success) return Response.json({ error: "invalid" }, { status: 400 });
  try {
    // Works even when push was switched off in configuration: turning off is always allowed.
    const removed = await removePushSubscriptions(
      userId,
      "all" in parsed.data ? { all: true } : { endpoint: parsed.data.endpoint },
    );
    const settings = await getNotificationSettings(userId);
    return Response.json({ ok: true, removed, devices: settings.devices });
  } catch (error) {
    reportError(error, { source: "api", route: "/api/notifications/subscriptions", method: "DELETE", userId });
    return Response.json({ error: "failed" }, { status: 500 });
  }
}
