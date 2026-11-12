import { auth } from "@clerk/nextjs/server";
import { reportError } from "@/lib/ops/report-error";
import { MAX_QUERY_LENGTH } from "@/lib/search";
import { searchForOwner } from "@/lib/search/server";
import { checkUsageLimit } from "@/lib/usage-limits";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

/**
 * GET /api/search?q=… — the command palette's search across every workspace
 * the signed-in student owns (trash excluded). An empty query returns the
 * student's workspaces as a jump list. Responses are never cached.
 */
export async function GET(request: Request) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "unauthorized" }, { status: 401, headers: NO_STORE });

  const q = (new URL(request.url).searchParams.get("q") ?? "").slice(0, MAX_QUERY_LENGTH);

  try {
    const limit = await checkUsageLimit(userId, "search");
    if (!limit.allowed) {
      return Response.json({ error: "rate_limited" }, { status: 429, headers: NO_STORE });
    }
    const results = await searchForOwner(userId, q);
    return Response.json(results, { headers: NO_STORE });
  } catch (error) {
    reportError(error, { source: "api", route: "/api/search", method: "GET", userId });
    return Response.json({ error: "search_failed" }, { status: 500, headers: NO_STORE });
  }
}
