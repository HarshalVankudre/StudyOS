/**
 * Cross-site request protection for state-changing API routes (POST, PUT,
 * PATCH, DELETE), on top of the session cookie's SameSite=Lax.
 *
 * A request is refused when the browser says it came from another site:
 *   - Sec-Fetch-Site (sent by every current browser) is anything other than
 *     "same-origin" or "none" (a typed URL, a bookmark). "same-site" is
 *     refused too: a sibling subdomain is not us.
 *   - Origin is present and is not this deployment's origin: the request's
 *     own host (Host / X-Forwarded-Host, as the proxy saw it) or APP_URL.
 *     "Origin: null" (sandboxed frames, some redirects) is refused.
 *
 * A request with neither header passes. Browsers send Origin on every
 * cross-origin POST/PUT/PATCH/DELETE (fetch and form posts alike) and
 * Sec-Fetch-Site on every request, so a request without both cannot be a
 * cross-site request from a browser; it is a server-side client (curl, a
 * test), which carries no victim's cookie and is not CSRF.
 *
 * Not for the Stripe and Clerk webhooks (signed, sent by servers) or the ops
 * routes authenticated by a bearer secret.
 */

const ALLOWED_FETCH_SITES = new Set(["same-origin", "none"]);

function firstValue(value: string | null): string | null {
  const first = value?.split(",")[0]?.trim();
  return first ? first.toLowerCase() : null;
}

function appHost(): string | null {
  const raw = process.env.APP_URL ?? process.env.NEXT_PUBLIC_APP_URL;
  if (!raw) return null;
  try {
    return new URL(raw).host.toLowerCase();
  } catch {
    return null;
  }
}

/** True when the request may change state (not a cross-site browser request). */
export function isSameOriginRequest(req: Request): boolean {
  const site = req.headers.get("sec-fetch-site")?.trim().toLowerCase();
  if (site && !ALLOWED_FETCH_SITES.has(site)) return false;

  const origin = req.headers.get("origin")?.trim();
  if (!origin) return true;
  let originHost: string;
  try {
    const parsed = new URL(origin);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return false;
    originHost = parsed.host.toLowerCase();
  } catch {
    return false; // Includes "null".
  }
  const hosts = [
    firstValue(req.headers.get("x-forwarded-host")),
    firstValue(req.headers.get("host")),
    appHost(),
  ].filter((h): h is string => Boolean(h));
  return hosts.includes(originHost);
}

/** The 403 answer for a cross-site request. */
export function crossSiteResponse(): Response {
  return Response.json({ error: "forbidden" }, { status: 403 });
}

/**
 * One line at the top of a state-changing handler:
 *   const blocked = rejectCrossSite(req); if (blocked) return blocked;
 */
export function rejectCrossSite(req: Request): Response | null {
  return isSameOriginRequest(req) ? null : crossSiteResponse();
}
