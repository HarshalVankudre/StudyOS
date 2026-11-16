import { auth } from "@clerk/nextjs/server";
import { z } from "zod";
import { emailConfigured } from "@/lib/email/config";
import { noStore, readJsonBody, sameOrigin } from "@/lib/notifications/http";
import { setEmailReminders } from "@/lib/notifications/service";
import { reportError } from "@/lib/ops/report-error";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z
  .object({
    enabled: z.boolean(),
    timeZone: z.string().max(100).optional(),
    locale: z.string().max(10).optional(),
  })
  .strict();

/**
 * The signed-in student's "Also send reminders by email" switch:
 *   PUT { enabled, timeZone?, locale? } -> { ok: true, email }
 * Turning on needs a verified primary address on the account: 409
 * { error: "no_address" | "unverified" } otherwise, 503 { error:
 * "unavailable" } when Clerk cannot be asked. Turning off always works.
 * 404 when email is not configured on this server.
 */
export async function PUT(req: Request) {
  if (!sameOrigin(req)) return Response.json({ error: "forbidden" }, { status: 403 });
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "unauthorized" }, { status: 401 });
  if (!emailConfigured()) return Response.json({ error: "not_found" }, { status: 404 });
  const parsed = bodySchema.safeParse(await readJsonBody(req));
  if (!parsed.success) return Response.json({ error: "invalid" }, { status: 400 });
  try {
    const { enabled, timeZone, locale } = parsed.data;
    const result = await setEmailReminders(userId, enabled, { timeZone, locale });
    if (result.ok) return Response.json({ ok: true, email: result.email }, { headers: noStore });
    if (result.reason === "not_configured") return Response.json({ error: "not_found" }, { status: 404 });
    if (result.reason === "unavailable") return Response.json({ error: "unavailable" }, { status: 503 });
    return Response.json({ error: result.reason }, { status: 409 });
  } catch (error) {
    reportError(error, { source: "api", route: "/api/notifications/email", method: "PUT", userId });
    return Response.json({ error: "failed" }, { status: 500 });
  }
}
