import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ lookup: vi.fn() }));
vi.mock("node:dns/promises", () => ({
  default: { lookup: mocks.lookup },
  lookup: mocks.lookup,
}));

import {
  FetchDeniedError,
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

  it("never calls fetch for a denied URL", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      controlledFetch("http://evil.com", { allowlist: ["example.com"] }),
    ).rejects.toBeInstanceOf(FetchDeniedError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("never calls fetch when DNS resolves to a denied IP", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    mocks.lookup.mockResolvedValue([{ address: "169.254.169.254", family: 4 }]);
    await expect(
      controlledFetch("https://docs.example.com/x", { allowlist: ["example.com"] }),
    ).rejects.toBeInstanceOf(FetchDeniedError);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
