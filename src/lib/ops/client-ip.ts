/**
 * The client address of a request, for per-client rate limiting.
 *
 * X-Forwarded-For is a list every proxy appends to, so only the entries the
 * proxies we run behind appended can be trusted; anything to their left is
 * whatever the client sent. Counting from the right:
 * - Cloud Run on its own (run.app URL or a domain mapping): Google's front end
 *   appends the address it saw, so the client is the LAST entry (1 hop).
 * - A Google external Application Load Balancer in front of Cloud Run appends
 *   "<client-ip>,<load-balancer-ip>", so the client is the SECOND entry from
 *   the right (2 hops). Set STUDYOS_TRUSTED_PROXY_HOPS=2 there, and restrict
 *   the service's ingress to the load balancer so nobody can skip it.
 */

export const DEFAULT_TRUSTED_PROXY_HOPS = 1;
const MAX_HOPS = 5;

/** Trusted proxy hops from the environment (STUDYOS_TRUSTED_PROXY_HOPS). */
export function trustedProxyHops(env: Record<string, string | undefined> = process.env): number {
  const raw = Number(env.STUDYOS_TRUSTED_PROXY_HOPS ?? "");
  return Number.isInteger(raw) && raw >= 1 && raw <= MAX_HOPS ? raw : DEFAULT_TRUSTED_PROXY_HOPS;
}

/**
 * The entry `hops` from the right of X-Forwarded-For (all header lines joined),
 * or "unknown" when the header is missing. When the list is shorter than
 * `hops` (a request that did not pass every proxy), the leftmost entry is the
 * best available; it can be forged, but such a request can only exhaust its
 * own bucket and the per-instance ceiling still holds.
 */
export function clientAddress(headers: Headers, hops = trustedProxyHops()): string {
  const entries = (headers.get("x-forwarded-for") ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  if (entries.length === 0) return "unknown";
  const index = Math.max(0, entries.length - hops);
  return entries[index].slice(0, 64);
}
