import { prisma } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Liveness/readiness probe for Cloud Run and uptime monitors.
 * Verifies the process is serving AND the database is reachable.
 */
export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return Response.json({ ok: true });
  } catch {
    return Response.json({ ok: false, reason: "db" }, { status: 503 });
  }
}
