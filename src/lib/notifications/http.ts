/** Small helpers shared by the /api/notifications routes. */

const MAX_BODY_BYTES = 8_000;

/** The request's JSON body (null when missing, too large or not JSON). */
export async function readJsonBody(req: Request): Promise<unknown | null> {
  const length = Number(req.headers.get("content-length") ?? "0");
  if (length > MAX_BODY_BYTES) return null;
  let text: string;
  try {
    text = await req.text();
  } catch {
    return null;
  }
  if (!text || text.length > MAX_BODY_BYTES) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * Same-origin check for state-changing requests from the browser. A request
 * without an Origin header (not a browser form or fetch) passes; Clerk's
 * session cookie is SameSite=Lax on top of this.
 */
export function sameOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return true;
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  if (!host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

export const noStore = { "Cache-Control": "no-store" } as const;
