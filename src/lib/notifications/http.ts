/** Small helpers shared by the /api/notifications routes. */
import { isSameOriginRequest } from "@/lib/http/same-origin";

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

/** Same-origin check for state-changing requests (see lib/http/same-origin). */
export function sameOrigin(req: Request): boolean {
  return isSameOriginRequest(req);
}

export const noStore = { "Cache-Control": "no-store" } as const;
