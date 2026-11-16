import { auth } from "@clerk/nextjs/server";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { defaultChannels } from "@/lib/notifications/channels";
import { TEST_EMAIL_KIND, TEST_EMAILS_PER_DAY } from "@/lib/notifications/config";
import { testEmailMessage, testMessage } from "@/lib/notifications/content";
import { readJsonBody, sameOrigin } from "@/lib/notifications/http";
import { getNotificationSettings } from "@/lib/notifications/service";
import { createMemoryRateLimiter } from "@/lib/ops/memory-rate-limit";
import { reportError } from "@/lib/ops/report-error";
import { claimWithinLimit } from "@/lib/usage-limits";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// A test is a request the student makes by hand: a few per ten minutes, per channel.
const perUser = createMemoryRateLimiter({ limit: 3, windowMs: 10 * 60_000 });
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * "Send a test" (no body, or { channel: "push" }): one notification to every
 * device of the signed-in student. "Send a test email" ({ channel: "email" }):
 * one email to their verified address, when email is on for them. Test
 * emails are also capped per day in the database (TEST_EMAILS_PER_DAY, across
 * server instances); 429 { error: "rate_limited" } past either limit.
 */
export async function POST(req: Request) {
  if (!sameOrigin(req)) return Response.json({ error: "forbidden" }, { status: 403 });
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "unauthorized" }, { status: 401 });
  const body = (await readJsonBody(req)) as { channel?: unknown } | null;
  const wanted = body?.channel ?? "push";
  if (wanted !== "push" && wanted !== "email") return Response.json({ error: "invalid" }, { status: 400 });
  const channel = defaultChannels().find((c) => c.name === wanted);
  if (!channel) return Response.json({ error: "not_found" }, { status: 404 });
  if (!perUser(`${wanted}:${userId}`)) return Response.json({ error: "rate_limited" }, { status: 429 });
  try {
    if (wanted === "email" && !(await claimWithinLimit(userId, TEST_EMAIL_KIND, TEST_EMAILS_PER_DAY, DAY_MS)).allowed) {
      return Response.json({ error: "rate_limited" }, { status: 429 });
    }
    const { preferences } = await getNotificationSettings(userId);
    const dict = getDictionary(preferences.locale);
    const message =
      wanted === "email" ? testEmailMessage(dict, preferences.locale) : testMessage(dict, preferences.locale);
    const delivered = (await channel.reachable(userId)) ? (await channel.deliver(userId, message)).delivered : 0;
    return Response.json({ ok: delivered > 0, delivered });
  } catch (error) {
    reportError(error, { source: "api", route: "/api/notifications/test", method: "POST", userId });
    return Response.json({ error: "failed" }, { status: 500 });
  }
}
