import { auth } from "@clerk/nextjs/server";
import { getI18n } from "@/lib/i18n/server";
import { insightsCsv, insightsCsvFilename, parsePeriod } from "@/lib/study/insights";
import { getInsights } from "@/lib/study/insights-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * "Download CSV" on the insights page: the signed-in student's per-day
 * numbers for ?period=7d|30d|90d, headers in their language. Owner-scoped
 * through getInsights (it reads only the signed-in student's rows).
 */
export async function GET(request: Request) {
  // The proxy already sends signed-out visitors to sign-in; this is the backstop.
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "unauthorized" }, { status: 401 });
  const period = parsePeriod(new URL(request.url).searchParams.get("period"));
  const [insights, { dict }] = await Promise.all([getInsights({ period }), getI18n()]);
  if (!insights) {
    return Response.json({ error: "unavailable" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
  return new Response(insightsCsv(insights.perDay, dict.insights.csv), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${insightsCsvFilename(period, insights.today)}"`,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
