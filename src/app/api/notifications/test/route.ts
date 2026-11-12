import { auth } from "@clerk/nextjs/server";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { defaultChannels } from "@/lib/notifications/channels";
import { testMessage } from "@/lib/notifications/content";
import { sameOrigin } from "@/lib/notifications/http";
import { getNotificationSettings } from "@/lib/notifications/service";
import { createMemoryRateLimiter } from "@/lib/ops/memory-rate-limit";
import { reportError } from "@/lib/ops/report-error";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// A test is a request the student makes by hand: a few per ten minutes.
const perUser = createMemoryRateLimiter({ limit: 3, windowMs: 10 * 60_000 });

/** "Send a test": one notification to every device of the signed-in student. */
export async function POST(req: Request) {
  if (!sameOrigin(req)) return Response.json({ error: "forbidden" }, { status: 403 });
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "unauthorized" }, { status: 401 });
  const channels = defaultChannels();
  if (channels.length === 0) return Response.json({ error: "not_found" }, { status: 404 });
  if (!perUser(userId)) return Response.json({ error: "rate_limited" }, { status: 429 });
  try {
    const { preferences } = await getNotificationSettings(userId);
    const message = testMessage(getDictionary(preferences.locale), preferences.locale);
    let delivered = 0;
    for (const channel of channels) {
      if (await channel.reachable(userId)) delivered += (await channel.deliver(userId, message)).delivered;
    }
    return Response.json({ ok: delivered > 0, delivered });
  } catch (error) {
    reportError(error, { source: "api", route: "/api/notifications/test", method: "POST", userId });
    return Response.json({ error: "failed" }, { status: 500 });
  }
}
