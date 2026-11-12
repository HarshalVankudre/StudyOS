/**
 * Fetch a student's calendar feed link (server-only), hardened against
 * server-side request forgery.
 *
 * The link is typed by a user, so it must only ever reach public internet
 * hosts over HTTPS. Built beside src/lib/net/controlled-fetch.ts (which is
 * allowlist-based for the AI agent) and sharing its address policy
 * (`isDeniedIp`), with one addition that matters for arbitrary hosts: the
 * DNS answer is PINNED. The address check runs inside the socket's own
 * `lookup`, so the address that was checked is the address that is
 * connected to; a DNS answer that changes between "check" and "connect"
 * (rebinding) cannot slip a private address in. Defenses:
 *   - https only, port 443 only, no credentials in the link, GET only, no
 *     cookies, no request body, no connection reuse;
 *   - IP-literal hosts and every DNS answer checked against private,
 *     loopback, link-local, CGNAT, multicast, documentation and cloud
 *     metadata ranges (IPv4, IPv6 and every IPv4-in-IPv6 form); one denied
 *     answer rejects the host;
 *   - redirects followed by hand (at most 3), each hop re-validated from
 *     scratch, never downgraded to http;
 *   - a total time limit, a response size cap counted on the decoded bytes
 *     (so a compressed bomb is stopped too);
 *   - errors come back as codes only. Nothing here logs, and no error message
 *     ever contains the link (which is a credential).
 */
import "server-only";

import https from "node:https";
import type { IncomingMessage } from "node:http";
import net from "node:net";
import zlib from "node:zlib";
import { isDeniedIp } from "@/lib/net/controlled-fetch";
import { pinnedLookup, systemResolve, type PinnedLookup, type ResolvedAddress } from "@/lib/net/pinned-lookup";

export type { ResolvedAddress } from "@/lib/net/pinned-lookup";

export const FEED_FETCH_LIMITS = {
  maxBytes: 3_000_000,
  timeoutMs: 10_000,
  maxRedirects: 3,
} as const;

export type FeedFetchErrorCode =
  | "invalid_url"
  | "blocked_address"
  | "host_not_found"
  | "unreachable"
  | "timeout"
  | "too_large"
  | "too_many_redirects"
  | "link_expired"
  | "remote_busy"
  | "remote_error";

/** A failure with a code the UI explains. Its message never contains the link. */
export class FeedFetchError extends Error {
  constructor(readonly code: FeedFetchErrorCode) {
    super(`calendar feed fetch failed: ${code}`);
    this.name = "FeedFetchError";
  }
}

export interface FeedFetchOptions {
  maxBytes?: number;
  timeoutMs?: number;
  maxRedirects?: number;
  signal?: AbortSignal;
  /** DNS resolver (tests fake it). Defaults to the system resolver. */
  resolve?: (hostname: string) => Promise<ResolvedAddress[]>;
  /** Address policy (tests may allow their loopback server). Defaults to "not denied". */
  isAllowedAddress?: (ip: string) => boolean;
  /** Ports allowed besides none; production is 443 only. */
  allowedPorts?: number[];
  /** Extra trusted CA (tests' self-signed server). Never set in production. */
  ca?: string | Buffer;
}

export interface FeedFetchResult {
  status: number;
  contentType: string | null;
  text: string;
  /** Host of the final hop (after redirects). */
  finalHost: string;
}

function stripBrackets(host: string): string {
  return host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;
}

/** Validate one hop's URL before anything is resolved or sent. */
function checkHop(raw: string, allowedPorts: number[], allowed: (ip: string) => boolean): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new FeedFetchError("invalid_url");
  }
  if (url.protocol !== "https:") throw new FeedFetchError("blocked_address");
  if (url.username || url.password) throw new FeedFetchError("blocked_address");
  const port = url.port ? Number(url.port) : 443;
  if (!allowedPorts.includes(port)) throw new FeedFetchError("blocked_address");
  const host = stripBrackets(url.hostname);
  if (!host) throw new FeedFetchError("invalid_url");
  if (net.isIP(host) && !allowed(host)) throw new FeedFetchError("blocked_address");
  if (/^metadata\.google\.internal\.?$/i.test(host)) throw new FeedFetchError("blocked_address");
  return url;
}

function mapNetworkError(error: unknown): FeedFetchError {
  if (error instanceof FeedFetchError) return error;
  const code = (error as NodeJS.ErrnoException | null)?.code ?? "";
  if (code === "ENOTFOUND" || code === "EAI_AGAIN" || code === "ENODATA") return new FeedFetchError("host_not_found");
  if (code === "ABORT_ERR" || code === "ETIMEDOUT") return new FeedFetchError("timeout");
  return new FeedFetchError("unreachable");
}

interface Hop {
  status: number;
  location: string | null;
  contentType: string | null;
  body: Buffer | null;
}

function requestOnce(url: URL, opts: Required<Pick<FeedFetchOptions, "maxBytes">> & FeedFetchOptions, signal: AbortSignal, lookup: PinnedLookup): Promise<Hop> {
  return new Promise<Hop>((resolvePromise, reject) => {
    let settled = false;
    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      reject(mapNetworkError(error));
    };
    const host = stripBrackets(url.hostname);
    const req = https.request(
      {
        protocol: "https:",
        hostname: host,
        port: url.port ? Number(url.port) : 443,
        path: `${url.pathname}${url.search}`,
        method: "GET",
        agent: false,
        lookup: lookup as never,
        ...(opts.ca ? { ca: opts.ca } : {}),
        ...(net.isIP(host) ? {} : { servername: host }),
        headers: {
          accept: "text/calendar, text/plain;q=0.8, */*;q=0.1",
          "accept-encoding": "gzip, deflate, br",
          "user-agent": "StudyOS-CalendarImport/1.0",
        },
        signal,
      },
      (res: IncomingMessage) => {
        const status = res.statusCode ?? 0;
        // Bodies of redirects and errors are never read: close the socket
        // so a server cannot keep it streaming after we moved on.
        if (status >= 300 && status < 400) {
          res.destroy();
          settled = true;
          resolvePromise({ status, location: res.headers.location ?? null, contentType: null, body: null });
          return;
        }
        if (status < 200 || status >= 300) {
          res.destroy();
          settled = true;
          resolvePromise({ status, location: null, contentType: null, body: null });
          return;
        }
        const declared = Number(res.headers["content-length"]);
        if (Number.isFinite(declared) && declared > opts.maxBytes) {
          res.destroy();
          fail(new FeedFetchError("too_large"));
          return;
        }
        const encoding = String(res.headers["content-encoding"] ?? "").toLowerCase().trim();
        let stream: NodeJS.ReadableStream = res;
        if (encoding === "gzip" || encoding === "x-gzip") stream = res.pipe(zlib.createGunzip());
        else if (encoding === "deflate") stream = res.pipe(zlib.createInflate());
        else if (encoding === "br") stream = res.pipe(zlib.createBrotliDecompress());
        else if (encoding && encoding !== "identity") {
          res.destroy();
          fail(new FeedFetchError("remote_error"));
          return;
        }
        const chunks: Buffer[] = [];
        let received = 0;
        let wire = 0;
        res.on("data", (chunk: Buffer) => {
          wire += chunk.length;
          if (wire > opts.maxBytes) {
            res.destroy();
            fail(new FeedFetchError("too_large"));
          }
        });
        stream.on("data", (chunk: Buffer) => {
          received += chunk.length;
          if (received > opts.maxBytes) {
            res.destroy();
            if (stream !== res) (stream as zlib.Gunzip).destroy();
            fail(new FeedFetchError("too_large"));
            return;
          }
          chunks.push(chunk);
        });
        stream.on("end", () => {
          if (settled) return;
          settled = true;
          resolvePromise({
            status,
            location: null,
            contentType: res.headers["content-type"] ?? null,
            body: Buffer.concat(chunks),
          });
        });
        stream.on("error", fail);
        res.on("error", fail);
      },
    );
    req.on("error", fail);
    req.end();
  });
}

/**
 * GET a calendar feed. Resolves with the decoded text of a 2xx response;
 * throws FeedFetchError (with a code) for everything else.
 */
export async function fetchFeed(rawUrl: string, options: FeedFetchOptions = {}): Promise<FeedFetchResult> {
  const maxBytes = options.maxBytes ?? FEED_FETCH_LIMITS.maxBytes;
  const timeoutMs = options.timeoutMs ?? FEED_FETCH_LIMITS.timeoutMs;
  const maxRedirects = options.maxRedirects ?? FEED_FETCH_LIMITS.maxRedirects;
  const allowedPorts = options.allowedPorts ?? [443];
  const allowed = options.isAllowedAddress ?? ((ip: string) => !isDeniedIp(ip));
  const lookup = pinnedLookup(options.resolve ?? systemResolve, allowed, () => new FeedFetchError("blocked_address"));

  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(new FeedFetchError("timeout")), timeoutMs);
  const signal = options.signal ? AbortSignal.any([options.signal, timeout.signal]) : timeout.signal;
  try {
    let current = rawUrl;
    for (let hop = 0; hop <= maxRedirects; hop += 1) {
      const url = checkHop(current, allowedPorts, allowed);
      let result: Hop;
      try {
        result = await requestOnce(url, { ...options, maxBytes }, signal, lookup);
      } catch (error) {
        if (timeout.signal.aborted) throw new FeedFetchError("timeout");
        throw error;
      }
      if (result.status >= 300 && result.status < 400) {
        if (!result.location) throw new FeedFetchError("remote_error");
        try {
          current = new URL(result.location, url).href;
        } catch {
          throw new FeedFetchError("remote_error");
        }
        continue; // re-validate the next hop from scratch
      }
      if (result.status === 401 || result.status === 403 || result.status === 404 || result.status === 410) {
        throw new FeedFetchError("link_expired");
      }
      if (result.status === 429 || result.status === 503) throw new FeedFetchError("remote_busy");
      if (result.status < 200 || result.status >= 300 || !result.body) throw new FeedFetchError("remote_error");
      return {
        status: result.status,
        contentType: result.contentType,
        text: new TextDecoder("utf-8", { fatal: false }).decode(result.body),
        finalHost: stripBrackets(url.hostname),
      };
    }
    throw new FeedFetchError("too_many_redirects");
  } finally {
    clearTimeout(timer);
  }
}
