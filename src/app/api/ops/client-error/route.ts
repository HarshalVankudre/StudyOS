import { isSameOriginRequest } from "@/lib/http/same-origin";
import { clientAddress } from "@/lib/ops/client-ip";
import { reportError } from "@/lib/ops/report-error";
import { createMemoryRateLimiter } from "@/lib/ops/memory-rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY = 8_000;
// Per client: a crash loop reports a handful, not thousands.
const perClient = createMemoryRateLimiter({ limit: 5, windowMs: 60_000 });
// Per instance: a hard ceiling on log volume from this endpoint.
const instanceLimit = createMemoryRateLimiter({ limit: 120, windowMs: 60_000 });

const str = (v: unknown, max: number) =>
  typeof v === "string" ? v.slice(0, max) : undefined;

/**
 * Receives reports from the top-level error boundaries (app/error.tsx,
 * app/global-error.tsx) and forwards them to reportError. Same-origin only,
 * size-capped and rate-limited. Answers 204 with no body on success; the
 * caller ignores every response, so nothing is retried or surfaced.
 */
export async function POST(req: Request) {
  if (!isSameOriginRequest(req)) return new Response(null, { status: 403 });

  // The entry our own proxies appended (see lib/ops/client-ip); earlier
  // entries are client-supplied and could be forged to dodge the limit.
  const client = clientAddress(req.headers);
  if (!perClient(client) || !instanceLimit("all")) {
    return new Response(null, { status: 429 });
  }

  const text = await req.text().catch(() => "");
  if (text.length > MAX_BODY) return new Response(null, { status: 413 });
  let body: Record<string, unknown> = {};
  try {
    body = JSON.parse(text) as Record<string, unknown>;
  } catch {
    return new Response(null, { status: 400 });
  }

  const err = new Error(str(body.message, 500) ?? "Client error");
  err.name = str(body.name, 80) ?? "ClientError";
  const stack = str(body.stack, 4_000);
  err.stack = stack ? `${err.name}: ${err.message}\n${stack.split("\n").slice(1).join("\n")}` : undefined;

  reportError(err, {
    source: "client",
    boundary: str(body.boundary, 40),
    path: str(body.path, 300),
    digest: str(body.digest, 100),
  });
  return new Response(null, { status: 204 });
}
