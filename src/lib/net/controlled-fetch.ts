/**
 * Controlled, SSRF-hardened outbound fetch (server-only).
 *
 * The agent may read allowlisted web content for research. Untrusted input (a
 * model- or page-supplied URL) must never reach internal services, cloud
 * metadata, or private ranges. Defenses, layered:
 *   - HTTPS only; GET/HEAD only; never sends a request body.
 *   - Host allowlist (exact or subdomain).
 *   - Resolved-IP denylist: every DNS answer is checked against private/
 *     link-local/loopback/metadata ranges (incl. IPv4-mapped IPv6), so an
 *     allowlisted hostname that resolves to a private IP is rejected.
 *   - `metadata.google.internal` denied by name; numeric/encoded IP hosts are
 *     normalized by the URL parser and caught by the IP denylist.
 *   - Redirects followed manually, re-validating every hop.
 *   - Response size + total-time caps; per-fetch audit (never the body).
 *
 * Residual: this is an app-layer control. A compromised host process could
 * bypass it, and there is a small DNS TOCTOU window (no kernel IP pinning).
 * The platform-level network jail (VPC egress proxy) is added with the isolated
 * sandbox (Increment B); this layer is the in-process line of defense.
 */
import "server-only";

import { lookup } from "node:dns/promises";
import net from "node:net";

export class FetchDeniedError extends Error {}
export class FetchTooLargeError extends Error {}

export interface ControlledFetchOptions {
  allowlist: string[];
  maxBytes?: number;
  timeoutMs?: number;
  maxRedirects?: number;
  method?: "GET" | "HEAD";
  /** Caller cancellation (e.g. a cancelled agent task); combined with the timeout. */
  signal?: AbortSignal;
  audit?: (record: { host: string; status: number; bytes: number }) => void;
}

export interface ControlledFetchResult {
  status: number;
  bytes: number;
  contentType: string | null;
  text: string;
}

const DENIED_HOSTNAMES = new Set([
  "metadata.google.internal",
  "metadata.google.internal.",
]);

const DENIED_V4_CIDRS = [
  "0.0.0.0/8",
  "10.0.0.0/8",
  "100.64.0.0/10",
  "127.0.0.0/8",
  "169.254.0.0/16",
  "172.16.0.0/12",
  "192.0.0.0/24",
  "192.168.0.0/16",
  "198.18.0.0/15",
  "224.0.0.0/4",
  "240.0.0.0/4",
];

function ipv4ToLong(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let n = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const octet = Number(part);
    if (octet > 255) return null;
    n = n * 256 + octet;
  }
  return n >>> 0;
}

function inCidr(long: number, cidr: string): boolean {
  const [base, bitsRaw] = cidr.split("/");
  const bits = Number(bitsRaw);
  const baseLong = ipv4ToLong(base);
  if (baseLong === null) return false;
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
  return (long & mask) === (baseLong & mask);
}

function isDeniedIpv4(ip: string): boolean {
  const long = ipv4ToLong(ip);
  if (long === null) return true; // unparseable → deny
  return DENIED_V4_CIDRS.some((cidr) => inCidr(long, cidr));
}

function isDeniedIpv6(ip: string): boolean {
  const lc = ip.toLowerCase();
  const mapped = lc.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (mapped) return isDeniedIpv4(mapped[1]);
  if (lc === "::1" || lc === "::") return true; // loopback / unspecified
  if (/^fe[89ab]/.test(lc)) return true; // fe80::/10 link-local
  if (/^f[cd]/.test(lc)) return true; // fc00::/7 unique-local
  return false;
}

/** True if `ip` (a literal) is in a denied range. Non-IP strings return false. */
export function isDeniedIp(ip: string): boolean {
  const family = net.isIP(ip);
  if (family === 4) return isDeniedIpv4(ip);
  if (family === 6) return isDeniedIpv6(ip);
  return false;
}

export function isHostAllowed(hostname: string, allowlist: string[]): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  if (DENIED_HOSTNAMES.has(hostname.toLowerCase())) return false;
  return allowlist.some((entry) => {
    const allowed = entry.toLowerCase().replace(/\.$/, "");
    return host === allowed || host.endsWith(`.${allowed}`);
  });
}

/** Validate a URL string against scheme/host/IP-literal rules. Throws if denied. */
export function assertUrlAllowed(rawUrl: string, allowlist: string[]): URL {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new FetchDeniedError("invalid URL");
  }
  if (url.protocol !== "https:") {
    throw new FetchDeniedError("only https is allowed");
  }
  // URL parser normalizes numeric/encoded IPv4 hosts to dotted form.
  if (isDeniedIp(url.hostname)) {
    throw new FetchDeniedError("host resolves to a denied address");
  }
  if (!isHostAllowed(url.hostname, allowlist)) {
    throw new FetchDeniedError("host is not on the allowlist");
  }
  return url;
}

/** Resolve a hostname and reject if ANY answer is in a denied range. */
export async function assertResolvedIpsSafe(hostname: string): Promise<void> {
  const answers = await lookup(hostname, { all: true });
  for (const { address } of answers) {
    if (isDeniedIp(address)) {
      throw new FetchDeniedError("host resolves to a denied address");
    }
  }
}

export async function controlledFetch(
  rawUrl: string,
  options: ControlledFetchOptions,
): Promise<ControlledFetchResult> {
  const {
    allowlist,
    maxBytes = 2_000_000,
    timeoutMs = 10_000,
    maxRedirects = 3,
    method = "GET",
    audit,
  } = options;

  // The fetch is bounded by a timeout AND the caller's cancellation: a cancelled
  // task must abort an in-flight web read, not just wait out the time cap.
  const timeout = new AbortController();
  const timer = setTimeout(
    () => timeout.abort(new Error("controlled fetch timed out")),
    timeoutMs,
  );
  const signal = options.signal
    ? AbortSignal.any([options.signal, timeout.signal])
    : timeout.signal;
  try {
    let current = rawUrl;
    for (let hop = 0; hop <= maxRedirects; hop += 1) {
      const url = assertUrlAllowed(current, allowlist);
      await assertResolvedIpsSafe(url.hostname);

      const response = await fetch(url, {
        method,
        redirect: "manual",
        signal,
        headers: { accept: "text/html,text/plain,application/json" },
      });

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        if (!location) throw new FetchDeniedError("redirect without location");
        current = new URL(location, url).toString();
        continue; // re-validate the next hop
      }

      const reader = response.body?.getReader();
      let received = 0;
      const chunks: Uint8Array[] = [];
      while (reader) {
        const { done, value } = await reader.read();
        if (done) break;
        received += value.length;
        if (received > maxBytes) {
          await reader.cancel();
          throw new FetchTooLargeError(`response exceeded ${maxBytes} bytes`);
        }
        chunks.push(value);
      }
      audit?.({ host: url.hostname, status: response.status, bytes: received });

      const buffer = new Uint8Array(received);
      let offset = 0;
      for (const chunk of chunks) {
        buffer.set(chunk, offset);
        offset += chunk.length;
      }
      return {
        status: response.status,
        bytes: received,
        contentType: response.headers.get("content-type"),
        text: new TextDecoder().decode(buffer),
      };
    }
    throw new FetchDeniedError("too many redirects");
  } finally {
    clearTimeout(timer);
  }
}
