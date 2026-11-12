import { prisma } from "@/lib/db";
import { publicConfigStatus } from "@/lib/ops/env";
import { reportError } from "@/lib/ops/report-error";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Liveness/readiness probe for Cloud Run and uptime monitors.
 * Verifies the process is serving AND the database is reachable, and reports a
 * secret-free configuration status (variable NAMES and feature on/off only) so
 * a deploy can be checked with one request.
 */
export async function GET() {
  const config = publicConfigStatus();
  try {
    await prisma.$queryRaw`SELECT 1`;
    return Response.json(
      { ok: true, config },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    reportError(error, { source: "api", route: "/api/health", method: "GET" });
    return Response.json(
      { ok: false, reason: "db", config },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
