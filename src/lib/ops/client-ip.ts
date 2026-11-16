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

const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

/** A dotted IPv4 address, normalised ("010.0.0.1" -> "10.0.0.1"), or null. */
function ipv4(value: string): string | null {
  const m = IPV4.exec(value);
  if (!m) return null;
  const octets = m.slice(1).map(Number);
  return octets.every((o) => o <= 255) ? octets.join(".") : null;
}

/** The eight 16-bit groups of an IPv6 address (zone id and an IPv4 tail allowed), or null. */
function ipv6Groups(value: string): number[] | null {
  let text = value.replace(/%.*$/, "").toLowerCase();
  // An IPv4 tail (::ffff:203.0.113.7) is the last two groups.
  const tail = /^(.*:)(\d{1,3}(?:\.\d{1,3}){3})$/.exec(text);
  if (tail) {
    const v4 = ipv4(tail[2]);
    if (!v4) return null;
    const [a, b, c, d] = v4.split(".").map(Number);
    text = `${tail[1]}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const halves = text.split("::");
  if (halves.length > 2) return null;
  const part = (s: string) => (s === "" ? [] : s.split(":"));
  const head = part(halves[0]);
  const rest = halves.length === 2 ? part(halves[1]) : [];
  const missing = 8 - head.length - rest.length;
  if (halves.length === 2 ? missing < 1 : missing !== 0) return null;
  const groups = [...head, ...Array<string>(halves.length === 2 ? missing : 0).fill("0"), ...rest];
  if (!groups.every((g) => /^[0-9a-f]{1,4}$/.test(g))) return null;
  return groups.map((g) => parseInt(g, 16));
}

/**
 * The bucket a per-address rate limit counts a client in. An IPv4 address is
 * its own bucket (an IPv4-mapped IPv6 address, ::ffff:203.0.113.7, is that
 * IPv4 address); an IPv6 address counts by its /64 prefix, the block one
 * subscriber is normally given, so a client cannot step through its own /64
 * for a fresh bucket per request. Brackets, a port and a zone id are ignored;
 * anything that is not an address ("unknown", junk) is kept as it is.
 */
export function rateLimitKey(address: string): string {
  let value = address.trim();
  const bracketed = /^\[([^\]]+)\](?::\d+)?$/.exec(value);
  if (bracketed) value = bracketed[1];
  const v4 = ipv4(value.replace(/:\d+$/, ""));
  if (v4) return v4;
  if (value.includes(":")) {
    const g = ipv6Groups(value);
    if (g) {
      if (g.slice(0, 5).every((x) => x === 0) && g[5] === 0xffff) {
        return [g[6] >> 8, g[6] & 255, g[7] >> 8, g[7] & 255].join(".");
      }
      return `${g
        .slice(0, 4)
        .map((x) => x.toString(16))
        .join(":")}::/64`;
    }
  }
  return value.slice(0, 64);
}

/** The rate-limit bucket of a request's client (clientAddress, then rateLimitKey). */
export function clientRateLimitKey(headers: Headers, hops = trustedProxyHops()): string {
  return rateLimitKey(clientAddress(headers, hops));
}
