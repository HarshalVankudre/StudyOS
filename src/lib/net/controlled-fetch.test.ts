// @vitest-environment node
import { readFileSync } from "node:fs";
import https from "node:https";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ lookup: vi.fn() }));
vi.mock("node:dns/promises", () => ({
  default: { lookup: mocks.lookup },
  lookup: mocks.lookup,
}));

import {
  FetchDeniedError,
  FetchTooLargeError,
  assertResolvedIpsSafe,
  assertUrlAllowed,
  controlledFetch,
  isDeniedIp,
  isHostAllowed,
} from "./controlled-fetch";

describe("controlled fetch SSRF defenses", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("denies private / loopback / link-local / metadata IPs", () => {
    for (const ip of [
      "169.254.169.254",
      "10.0.0.1",
      "192.168.1.1",
      "172.16.0.1",
      "127.0.0.1",
      "100.64.0.1",
      "0.0.0.0",
      "::1",
      "fe80::1",
      "fd00::1",
      "::ffff:10.0.0.1",
    ]) {
      expect(isDeniedIp(ip), ip).toBe(true);
    }
  });

  it("allows public IPs", () => {
    for (const ip of ["93.184.216.34", "8.8.8.8", "2606:4700:4700::1111"]) {
      expect(isDeniedIp(ip), ip).toBe(false);
    }
  });

  it("allowlists by exact host and subdomain, denies metadata name", () => {
    expect(isHostAllowed("example.com", ["example.com"])).toBe(true);
    expect(isHostAllowed("docs.example.com", ["example.com"])).toBe(true);
    expect(isHostAllowed("evil.com", ["example.com"])).toBe(false);
    expect(isHostAllowed("notexample.com", ["example.com"])).toBe(false);
    expect(isHostAllowed("metadata.google.internal", ["metadata.google.internal"])).toBe(
      false,
    );
  });

  it("rejects non-https, non-allowlisted, and IP-literal/encoded hosts", () => {
    const allow = ["example.com"];
    expect(() => assertUrlAllowed("http://example.com", allow)).toThrow(
      FetchDeniedError,
    );
    expect(() => assertUrlAllowed("https://evil.com", allow)).toThrow(
      FetchDeniedError,
    );
    expect(() => assertUrlAllowed("https://169.254.169.254", allow)).toThrow(
      FetchDeniedError,
    );
    expect(() => assertUrlAllowed("https://10.0.0.1", allow)).toThrow(
      FetchDeniedError,
    );
    // numeric/encoded IP host (normalized by the URL parser, else not allowlisted)
    expect(() => assertUrlAllowed("https://2130706433", allow)).toThrow(
      FetchDeniedError,
    );
    expect(() =>
      assertUrlAllowed("https://docs.example.com/page", allow),
    ).not.toThrow();
  });

  it("rejects an allowlisted host that resolves to a denied IP (rebinding)", async () => {
    mocks.lookup.mockResolvedValue([{ address: "10.0.0.5", family: 4 }]);
    await expect(assertResolvedIpsSafe("docs.example.com")).rejects.toBeInstanceOf(
      FetchDeniedError,
    );
  });

  it("accepts a host resolving only to public IPs", async () => {
    mocks.lookup.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
    await expect(assertResolvedIpsSafe("example.com")).resolves.toBeUndefined();
  });


  it("denies anything that is not a valid IP address (review: 'not-an-ip' passed)", () => {
    for (const value of ["not-an-ip", "", "localhost", "999.1.1.1", "1.2.3", "::ffff:127.0.0.01", "0127.0.0.1", "[::1"]) {
      expect(isDeniedIp(value), value).toBe(true);
    }
  });

  it("rejects credentials in the URL and any port but 443", () => {
    const allow = ["example.com"];
    expect(() => assertUrlAllowed("https://user:pass@example.com/", allow)).toThrow(FetchDeniedError);
    expect(() => assertUrlAllowed("https://user@example.com/", allow)).toThrow(FetchDeniedError);
    expect(() => assertUrlAllowed("https://example.com:8443/", allow)).toThrow(FetchDeniedError);
    expect(() => assertUrlAllowed("https://example.com:22/", allow)).toThrow(FetchDeniedError);
    expect(() => assertUrlAllowed("https://example.com:443/", allow)).not.toThrow();
  });
});

/**
 * The transport against a real local HTTPS server (self-signed test
 * certificate, faked DNS). The server's loopback address stands in for a
 * public host; every other address follows the real policy. Nothing here
 * touches the network.
 */
describe("controlled fetch transport (pinned DNS)", () => {
  const fixtures = path.join(process.cwd(), "src/lib/feeds/fixtures");
  const key = readFileSync(path.join(fixtures, "test-server.key"));
  const cert = readFileSync(path.join(fixtures, "test-server.crt"));
  let port = 0;
  const hits: string[] = [];
  let handler: (req: { url?: string }, res: import("node:http").ServerResponse) => void = (_q, res) => res.end("hello");
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
    handler = (_q, res) => res.end("hello");
  });

  const hooks = (answers: (host: string, call: number) => string) => {
    let calls = 0;
    const resolve = vi.fn(async (host: string) => {
      calls += 1;
      const address = answers(host, calls);
      return [{ address, family: address.includes(":") ? 6 : 4 }];
    });
    return {
      resolve,
      ca: cert,
      allowedPorts: [port],
      isAllowedAddress: (ip: string) => ip === "127.0.0.1" || !isDeniedIp(ip),
    };
  };
  const url = (p = "/page") => `https://lms.university-test.edu:${port}${p}`;

  it("reads an allowlisted page, resolving each hop exactly once", async () => {
    const opts = hooks(() => "127.0.0.1");
    const result = await controlledFetch(url(), { allowlist: ["university-test.edu"], ...opts });
    expect(result.text).toBe("hello");
    expect(result.status).toBe(200);
    expect(opts.resolve).toHaveBeenCalledTimes(1);
  });

  it("connects only to the checked address: a private DNS answer never reaches a socket", async () => {
    const opts = hooks(() => "169.254.169.254");
    await expect(controlledFetch(url(), { allowlist: ["university-test.edu"], ...opts })).rejects.toBeInstanceOf(FetchDeniedError);
    expect(hits).toEqual([]);
  });

  it("re-checks DNS on every redirect hop (rebinding between hops is refused)", async () => {
    handler = (req, res) => {
      if (req.url === "/start") {
        res.writeHead(302, { location: "/next" });
        res.end();
      } else res.end("landed");
    };
    // First lookup public, second private: the second hop must not connect.
    const opts = hooks((_h, call) => (call === 1 ? "127.0.0.1" : "10.0.0.1"));
    await expect(controlledFetch(url("/start"), { allowlist: ["university-test.edu"], ...opts })).rejects.toBeInstanceOf(
      FetchDeniedError,
    );
    expect(hits).toEqual(["/start"]);
  });

  it("rejects a redirect to userinfo or another port before connecting", async () => {
    for (const location of [`https://u:p@lms.university-test.edu:${port}/x`, "https://lms.university-test.edu:8443/x"]) {
      hits.length = 0;
      handler = (_q, res) => {
        res.writeHead(302, { location });
        res.end();
      };
      const opts = hooks(() => "127.0.0.1");
      await expect(controlledFetch(url("/start"), { allowlist: ["university-test.edu"], ...opts })).rejects.toBeInstanceOf(
        FetchDeniedError,
      );
      expect(hits).toEqual(["/start"]);
    }
  });

  it("caps the response size", async () => {
    handler = (_q, res) => res.end(Buffer.alloc(5_000, 65));
    const opts = hooks(() => "127.0.0.1");
    await expect(
      controlledFetch(url(), { allowlist: ["university-test.edu"], maxBytes: 1_000, ...opts }),
    ).rejects.toBeInstanceOf(FetchTooLargeError);
  });

  it("forwards caller cancellation", async () => {
    handler = () => {}; // never answers
    const opts = hooks(() => "127.0.0.1");
    const controller = new AbortController();
    const pending = controlledFetch(url(), { allowlist: ["university-test.edu"], signal: controller.signal, ...opts });
    setTimeout(() => controller.abort(new Error("cancelled")), 50);
    await expect(pending).rejects.toThrow("cancelled");
  });

  it("uses the system resolver through the same pinned check by default", async () => {
    mocks.lookup.mockResolvedValue([{ address: "10.0.0.5", family: 4 }]);
    await expect(controlledFetch("https://docs.example.com/x", { allowlist: ["example.com"] })).rejects.toBeInstanceOf(
      FetchDeniedError,
    );
  });
});
