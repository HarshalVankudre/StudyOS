import { prisma } from "@/lib/db";
import { publicConfigStatus } from "@/lib/ops/env";
import { reportError } from "@/lib/ops/report-error";
import { bearerToken, secretsMatch } from "@/lib/ops/secret";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

/** True when the request carries `Authorization: Bearer <MAINTENANCE_SECRET>`. */
function isOperator(request: Request): boolean {
  const expected = process.env.MAINTENANCE_SECRET?.trim();
  if (!expected) return false;
  const presented = bearerToken(request);
  return presented !== null && secretsMatch(presented, expected);
}

/**
 * Liveness/readiness probe for Cloud Run and uptime monitors.
 *
 * 200 only when the process is serving, every required environment variable
 * is set, and the database answers; otherwise 503. Anonymous callers get a
 * bare `{ ok }` and nothing else (which features are switched on is not
 * public information). An operator presenting the maintenance secret
 * (`Authorization: Bearer $MAINTENANCE_SECRET`) also gets the secret-free
 * configuration view: required variable NAMES that are missing, feature
 * on/off flags, and first of all the startup WARNINGS (features switched off
 * because an optional secret is missing, with what that means). Never values.
 * Warnings never make the probe fail: only missing required configuration or
 * an unreachable database do.
 */
export async function GET(request: Request) {
  const config = publicConfigStatus();
  let database = true;
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch (error) {
    database = false;
    reportError(error, { source: "api", route: "/api/health", method: "GET" });
  }
  const ok = config.ok && database;
  const status = ok ? 200 : 503;

  if (!isOperator(request)) {
    return Response.json({ ok }, { status, headers: NO_STORE });
  }
  const reason = !database ? "db" : !config.ok ? "config" : undefined;
  const { warnings, ...rest } = config;
  return Response.json(
    { ok, ...(reason ? { reason } : {}), warnings, config: rest },
    { status, headers: NO_STORE },
  );
}
