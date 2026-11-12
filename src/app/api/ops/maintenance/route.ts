import { reportError } from "@/lib/ops/report-error";
import { runRetention } from "@/lib/ops/retention";
import { bearerToken, secretsMatch } from "@/lib/ops/secret";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Data-retention job for Cloud Scheduler:
 *   POST /api/ops/maintenance   Authorization: Bearer $MAINTENANCE_SECRET
 * 404 when MAINTENANCE_SECRET is not configured (the route does not exist),
 * 401 on a wrong or missing secret.
 */
export async function POST(req: Request) {
  const expected = process.env.MAINTENANCE_SECRET;
  if (!expected) return new Response("Not found", { status: 404 });

  const presented = bearerToken(req);
  if (!presented || !secretsMatch(presented, expected)) {
    return new Response("Unauthorized", { status: 401 });
  }

  try {
    const result = await runRetention();
    console.log(JSON.stringify({ severity: "INFO", message: "[StudyOS] retention run", result }));
    return Response.json({ ok: true, result });
  } catch (error) {
    reportError(error, { source: "api", route: "/api/ops/maintenance", method: "POST" });
    return Response.json({ ok: false }, { status: 500 });
  }
}
