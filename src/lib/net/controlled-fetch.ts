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
  "192.0.2.0/24", // TEST-NET-1
  "192.88.99.0/24", // 6to4 relay anycast
  "192.168.0.0/16",
  "198.18.0.0/15",
  "198.51.100.0/24", // TEST-NET-2
  "203.0.113.0/24", // TEST-NET-3
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

/** The 16 bytes of an IPv6 literal (zone id ignored), or null if unparseable. */
function ipv6Bytes(ip: string): number[] | null {
  let text = ip.split("%")[0].toLowerCase();
  // A trailing dotted IPv4 (::ffff:1.2.3.4, 64:ff9b::1.2.3.4) becomes two groups.
  const v4 = text.match(/(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (v4) {
    const long = ipv4ToLong(v4[1]);
    if (long === null) return null;
    text = `${text.slice(0, -v4[1].length)}${(long >>> 16).toString(16)}:${(long & 0xffff).toString(16)}`;
  }
  const halves = text.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = 8 - head.length - tail.length;
  if (halves.length === 1 ? missing !== 0 : missing < 1) return null;
  const groups = [...head, ...Array<string>(halves.length === 2 ? missing : 0).fill("0"), ...tail];
  const bytes: number[] = [];
  for (const group of groups) {
    if (!/^[0-9a-f]{1,4}$/.test(group)) return null;
    const value = parseInt(group, 16);
    bytes.push(value >> 8, value & 0xff);
  }
  return bytes;
}

function embeddedV4Denied(bytes: number[], offset: number): boolean {
  return isDeniedIpv4(bytes.slice(offset, offset + 4).join("."));
}

/**
 * IPv6 policy: only global unicast (2000::/3) is reachable, minus the ranges
 * inside it that are documentation or that tunnel an IPv4 address (6to4,
 * Teredo, NAT64), whose embedded IPv4 must itself be public. Every form that
 * maps or embeds an IPv4 address (::ffff:a.b.c.d in dotted or hex form,
 * IPv4-compatible ::a.b.c.d) is judged by that IPv4 address.
 */
function isDeniedIpv6(ip: string): boolean {
  const b = ipv6Bytes(ip);
  if (!b) return true; // unparseable → deny
  const zeros = (from: number, to: number) => b.slice(from, to).every((x) => x === 0);
  // ::ffff:0:0/96 IPv4-mapped
  if (zeros(0, 10) && b[10] === 0xff && b[11] === 0xff) return embeddedV4Denied(b, 12);
  // ::/96 (unspecified, loopback, deprecated IPv4-compatible)
  if (zeros(0, 12)) {
    if (zeros(12, 15) && b[15] <= 1) return true;
    return embeddedV4Denied(b, 12);
  }
  // 64:ff9b::/96 NAT64 well-known prefix; 64:ff9b:1::/48 local-use NAT64
  if (b[0] === 0x00 && b[1] === 0x64 && b[2] === 0xff && b[3] === 0x9b) {
    return zeros(4, 12) ? embeddedV4Denied(b, 12) : true;
  }
  // Anything outside global unicast 2000::/3: link-local, unique-local,
  // site-local, multicast, discard-only, reserved.
  if ((b[0] & 0xe0) !== 0x20) return true;
  // 2002::/16 6to4 embeds an IPv4 address in bytes 2..5
  if (b[0] === 0x20 && b[1] === 0x02) return embeddedV4Denied(b, 2);
  // 2001::/32 Teredo (embeds an obfuscated IPv4); 2001:db8::/32 documentation;
  // 2001:10::/28, 2001:20::/28 ORCHID
  if (b[0] === 0x20 && b[1] === 0x01) {
    if (b[2] === 0x00 && b[3] === 0x00) return true;
    if (b[2] === 0x0d && b[3] === 0xb8) return true;
    if (b[2] === 0x00 && (b[3] & 0xf0) === 0x10) return true;
    if (b[2] === 0x00 && (b[3] & 0xf0) === 0x20) return true;
  }
  // 3fff::/20 documentation (RFC 9637)
  if (b[0] === 0x3f && b[1] === 0xff && (b[2] & 0xf0) === 0x00) return true;
  return false;
}

/**
 * True if `ip` (a literal) is in a denied range. Non-IP strings return false.
 * A bracketed IPv6 URL host ("[::1]", as `URL.hostname` returns it) and an
 * IPv6 zone id ("fe80::1%eth0") are understood.
 */
export function isDeniedIp(raw: string): boolean {
  const ip = raw.startsWith("[") && raw.endsWith("]") ? raw.slice(1, -1) : raw;
  const family = net.isIP(ip.split("%")[0]);
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
