// @vitest-environment node
import { readFileSync } from "node:fs";
import https from "node:https";
import type { AddressInfo } from "node:net";
import path from "node:path";
import zlib from "node:zlib";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { isDeniedIp } from "@/lib/net/controlled-fetch";
import { FeedFetchError, fetchFeed, type FeedFetchOptions, type ResolvedAddress } from "./fetch-feed";

/**
 * The fetch layer against a real local HTTPS server (self-signed, test-only
 * certificate) with faked DNS. The server listens on 127.0.0.1, which the
 * real policy denies, so the "public" test hosts use a policy that allows
 * exactly that one loopback address and denies everything else the real
 * policy denies. No test touches the network.
 */
const fixtures = path.join(process.cwd(), "src/lib/feeds/fixtures");
const key = readFileSync(path.join(fixtures, "test-server.key"));
const cert = readFileSync(path.join(fixtures, "test-server.crt"));
const ICS = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nEND:VCALENDAR\r\n";

let port = 0;
const hits: string[] = [];
let handler: (req: { url?: string }, res: import("node:http").ServerResponse) => void = (_req, res) => res.end(ICS);
const server = https.createServer({ key, cert }, (req, res) => {
  hits.push(req.url ?? "");
  handler(req, res);
});

beforeAll(async () => {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = (server.address() as AddressInfo).port;
});
afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});
beforeEach(() => {
  hits.length = 0;
  handler = (_req, res) => res.end(ICS);
});

const PUBLIC_HOSTS: Record<string, ResolvedAddress[]> = {
  "lms.university-test.edu": [{ address: "127.0.0.1", family: 4 }],
  "calendar.university-test.edu": [{ address: "127.0.0.1", family: 4 }],
  "redirect.university-test.edu": [{ address: "127.0.0.1", family: 4 }],
  "internal.university-test.edu": [{ address: "10.0.0.5", family: 4 }],
  "metadata-alias.university-test.edu": [{ address: "169.254.169.254", family: 4 }],
  "mixed.university-test.edu": [
    { address: "127.0.0.1", family: 4 },
    { address: "192.168.1.20", family: 4 },
  ],
  "v6-private.university-test.edu": [{ address: "::ffff:a00:1", family: 6 }],
};

function setup(overrides: Partial<FeedFetchOptions> = {}) {
  const resolve = vi.fn(async (host: string) => {
    const answers = PUBLIC_HOSTS[host];
    if (!answers) throw Object.assign(new Error("not found"), { code: "ENOTFOUND" });
    return answers;
  });
  const options: FeedFetchOptions = {
    resolve,
    ca: cert,
    allowedPorts: [port],
    // The test server's loopback address stands in for a public host.
    isAllowedAddress: (ip) => ip === "127.0.0.1" || !isDeniedIp(ip),
    ...overrides,
  };
  return { resolve, options };
}

const url = (host: string, p = "/feeds/calendars/user_secretTOKEN123456789.ics") => `https://${host}:${port}${p}`;

async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
    return "ok";
  } catch (error) {
    expect(error).toBeInstanceOf(FeedFetchError);
    // An error never carries the (secret) link.
    expect(String((error as Error).message)).not.toContain("secretTOKEN");
    expect(String((error as Error).stack)).not.toContain("secretTOKEN");
    return (error as FeedFetchError).code;
  }
}

describe("fetching a feed from a public host", () => {
  it("returns the calendar text, resolving the host exactly once (the checked address is the one connected)", async () => {
    const { resolve, options } = setup();
    const result = await fetchFeed(url("lms.university-test.edu"), options);
    expect(result.text).toBe(ICS);
    expect(result.finalHost).toBe("lms.university-test.edu");
    expect(resolve).toHaveBeenCalledTimes(1);
    expect(hits).toEqual(["/feeds/calendars/user_secretTOKEN123456789.ics"]);
  });

  it("decodes a gzip response", async () => {
    handler = (_req, res) => {
      res.setHeader("content-encoding", "gzip");
      res.end(zlib.gzipSync(ICS));
    };
    const { options } = setup();
    expect((await fetchFeed(url("lms.university-test.edu"), options)).text).toBe(ICS);
  });

  it("follows a redirect to another public host, re-validating it", async () => {
    handler = (req, res) => {
      if (req.url === "/start") {
        res.writeHead(302, { location: url("calendar.university-test.edu", "/final.ics") });
        res.end();
      } else res.end(ICS);
    };
    const { resolve, options } = setup();
    const result = await fetchFeed(url("redirect.university-test.edu", "/start"), options);
    expect(result.text).toBe(ICS);
    expect(result.finalHost).toBe("calendar.university-test.edu");
    expect(resolve.mock.calls.map((c) => c[0])).toEqual(["redirect.university-test.edu", "calendar.university-test.edu"]);
  });
});

describe("SSRF protections", () => {
  it("refuses private, loopback, link-local and metadata IP literals before any lookup", async () => {
    const { resolve } = setup();
    for (const target of [
      "https://127.0.0.1/x.ics",
      "https://10.1.2.3/x.ics",
      "https://169.254.169.254/latest/meta-data/",
      "https://[::1]/x.ics",
      "https://[::ffff:127.0.0.1]/x.ics",
      "https://[fd00::1]/x.ics",
      "https://2130706433/x.ics", // 127.0.0.1 written as a number
      "https://0x7f.1/x.ics",
      "https://metadata.google.internal/computeMetadata/v1/",
    ]) {
      // The real policy: no loopback exception.
      expect(await codeOf(fetchFeed(target, { resolve })), target).toMatch(/blocked_address|host_not_found/);
    }
    expect(hits).toEqual([]);
  });

  it("refuses a host whose DNS answer is private, without connecting", async () => {
    const { options } = setup();
    expect(await codeOf(fetchFeed(url("internal.university-test.edu"), options))).toBe("blocked_address");
    expect(await codeOf(fetchFeed(url("metadata-alias.university-test.edu"), options))).toBe("blocked_address");
    expect(await codeOf(fetchFeed(url("v6-private.university-test.edu"), options))).toBe("blocked_address");
    expect(hits).toEqual([]);
  });

  it("refuses a host if ANY of its DNS answers is private", async () => {
    const { options } = setup();
    expect(await codeOf(fetchFeed(url("mixed.university-test.edu"), options))).toBe("blocked_address");
    expect(hits).toEqual([]);
  });

  it("DNS rebinding: an answer that changes after the first lookup is never used", async () => {
    let calls = 0;
    const resolve = vi.fn(async (): Promise<ResolvedAddress[]> => {
      calls += 1;
      return calls === 1 ? [{ address: "127.0.0.1", family: 4 }] : [{ address: "10.0.0.9", family: 4 }];
    });
    const { options } = setup({ resolve });
    // Each connection resolves once, inside the socket's own lookup, and is
    // pinned to that checked answer: no second lookup can redirect it.
    await fetchFeed(url("lms.university-test.edu"), options);
    expect(resolve).toHaveBeenCalledTimes(1);
    // A second fetch sees the rebound (private) answer and is refused.
    expect(await codeOf(fetchFeed(url("lms.university-test.edu"), options))).toBe("blocked_address");
    expect(hits).toHaveLength(1);
  });

  it("re-validates every redirect hop: private literals, private DNS, http downgrade, other ports", async () => {
    const targets = [
      "https://169.254.169.254/latest/meta-data/iam/security-credentials/",
      "https://127.0.0.1/admin",
      `https://internal.university-test.edu:${port}/secrets`,
      `http://calendar.university-test.edu:${port}/feed.ics`,
      "https://calendar.university-test.edu:6379/",
      "https://user:pass@calendar.university-test.edu/feed.ics",
    ];
    for (const target of targets) {
      hits.length = 0;
      handler = (_req, res) => {
        res.writeHead(302, { location: target });
        res.end();
      };
      const { options } = setup({ isAllowedAddress: (ip) => ip === "127.0.0.1" ? hits.length === 0 : !isDeniedIp(ip) });
      expect(await codeOf(fetchFeed(url("redirect.university-test.edu", "/start"), options)), target).toBe("blocked_address");
      expect(hits).toEqual(["/start"]);
    }
  });

  it("stops after 3 redirects", async () => {
    handler = (_req, res) => {
      res.writeHead(301, { location: url("redirect.university-test.edu", `/loop${hits.length}`) });
      res.end();
    };
    const { options } = setup();
    expect(await codeOf(fetchFeed(url("redirect.university-test.edu", "/loop"), options))).toBe("too_many_redirects");
    expect(hits).toHaveLength(4);
  });

  it("only port 443 is allowed by default", async () => {
    const { resolve } = setup();
    expect(await codeOf(fetchFeed(url("lms.university-test.edu"), { resolve, ca: cert }))).toBe("blocked_address");
    expect(resolve).not.toHaveBeenCalled();
  });
});

describe("limits and failures", () => {
  it("caps the response size (declared, streamed and decompressed)", async () => {
    const { options } = setup({ maxBytes: 10_000 });
    handler = (_req, res) => {
      res.setHeader("content-length", "50000");
      res.end("x".repeat(50_000));
    };
    expect(await codeOf(fetchFeed(url("lms.university-test.edu"), options))).toBe("too_large");

    handler = (_req, res) => {
      res.write("x".repeat(6_000));
      res.end("x".repeat(6_000));
    };
    expect(await codeOf(fetchFeed(url("lms.university-test.edu"), options))).toBe("too_large");

    handler = (_req, res) => {
      res.setHeader("content-encoding", "gzip");
      res.end(zlib.gzipSync(Buffer.alloc(5_000_000))); // a few KB on the wire
    };
    expect(await codeOf(fetchFeed(url("lms.university-test.edu"), options))).toBe("too_large");
  });

  it("times out a server that never answers", async () => {
    handler = () => {
      /* never respond */
    };
    const { options } = setup({ timeoutMs: 300 });
    const started = Date.now();
    expect(await codeOf(fetchFeed(url("lms.university-test.edu"), options))).toBe("timeout");
    expect(Date.now() - started).toBeLessThan(3_000);
  });

  it("explains an expired or revoked link, a busy server and a broken one", async () => {
    const { options } = setup();
    for (const [status, code] of [
      [401, "link_expired"],
      [403, "link_expired"],
      [404, "link_expired"],
      [410, "link_expired"],
      [429, "remote_busy"],
      [500, "remote_error"],
    ] as const) {
      handler = (_req, res) => {
        res.statusCode = status;
        res.end("nope");
      };
      expect(await codeOf(fetchFeed(url("lms.university-test.edu"), options)), String(status)).toBe(code);
    }
  });

  it("reports a mistyped host as not found", async () => {
    const { options } = setup();
    expect(await codeOf(fetchFeed(url("canvas.university-tset.edu"), options))).toBe("host_not_found");
  });
});

describe("address policy (shared with the agent's controlled fetch)", () => {
  it("denies every IPv4-in-IPv6 form of a private address and non-global IPv6", () => {
    for (const ip of [
      "::ffff:7f00:1", // ::ffff:127.0.0.1 in hex
      "::ffff:a9fe:a9fe", // 169.254.169.254
      "::127.0.0.1", // IPv4-compatible
      "64:ff9b::10.0.0.1", // NAT64
      "64:ff9b::a9fe:a9fe",
      "2002:a00:1::1", // 6to4 of 10.0.0.1
      "2001:0:4136:e378::1", // Teredo
      "2001:db8::1", // documentation
      "ff02::1", // multicast
      "fe80::1%eth0",
      "fec0::1",
      "[::1]",
      "100::1",
      "192.0.2.10",
      "198.51.100.7",
      "203.0.113.9",
    ]) {
      expect(isDeniedIp(ip), ip).toBe(true);
    }
  });

  it("still allows public addresses, including public IPv4 inside 6to4 or NAT64", () => {
    for (const ip of ["8.8.8.8", "2606:4700:4700::1111", "[2606:4700::1]", "64:ff9b::808:808", "2002:808:808::1", "::ffff:8.8.8.8"]) {
      expect(isDeniedIp(ip), ip).toBe(false);
    }
  });
});
