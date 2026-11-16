import { describe, expect, it } from "vitest";
import { clientAddress, clientRateLimitKey, rateLimitKey, trustedProxyHops } from "./client-ip";

const h = (xff?: string) => new Headers(xff === undefined ? {} : { "x-forwarded-for": xff });

describe("clientAddress", () => {
  it("Cloud Run alone: the last entry is the address Google's front end saw", () => {
    expect(clientAddress(h("203.0.113.7"), 1)).toBe("203.0.113.7");
    // A forged leftmost entry is ignored.
    expect(clientAddress(h("6.6.6.6, 203.0.113.7"), 1)).toBe("203.0.113.7");
  });

  it("behind a Google load balancer: the entry before the balancer's own address", () => {
    // <supplied>,<client-ip>,<load-balancer-ip>
    expect(clientAddress(h("6.6.6.6, 203.0.113.7, 34.117.1.2"), 2)).toBe("203.0.113.7");
    expect(clientAddress(h("203.0.113.7,34.117.1.2"), 2)).toBe("203.0.113.7");
    // Two clients behind the same balancer get different buckets.
    expect(clientAddress(h("198.51.100.9,34.117.1.2"), 2)).not.toBe(
      clientAddress(h("203.0.113.7,34.117.1.2"), 2),
    );
  });

  it("falls back sensibly on short or missing headers", () => {
    expect(clientAddress(h("203.0.113.7"), 2)).toBe("203.0.113.7");
    expect(clientAddress(h(), 1)).toBe("unknown");
    expect(clientAddress(h(" , "), 1)).toBe("unknown");
  });
});

describe("rateLimitKey", () => {
  it("keeps an IPv4 address as its own bucket", () => {
    expect(rateLimitKey("203.0.113.7")).toBe("203.0.113.7");
    expect(rateLimitKey(" 203.0.113.7:51234 ")).toBe("203.0.113.7");
    expect(rateLimitKey("203.0.113.7")).not.toBe(rateLimitKey("203.0.113.8"));
  });

  it("counts an IPv4-mapped IPv6 address as the IPv4 address", () => {
    expect(rateLimitKey("::ffff:203.0.113.7")).toBe("203.0.113.7");
    expect(rateLimitKey("::FFFF:cb00:7107")).toBe("203.0.113.7");
    expect(rateLimitKey("[::ffff:203.0.113.7]:443")).toBe("203.0.113.7");
  });

  it("counts an IPv6 address by its /64, however it is written", () => {
    const key = rateLimitKey("2001:db8:85a3:42:1:2:3:4");
    expect(key).toBe("2001:db8:85a3:42::/64");
    // Every address of the same /64 is one bucket.
    for (const same of [
      "2001:db8:85a3:42::1",
      "2001:0DB8:85A3:0042:ffff:ffff:ffff:ffff",
      "[2001:db8:85a3:42::9]:8080",
      "2001:db8:85a3:42::5%eth0",
    ]) {
      expect(rateLimitKey(same), same).toBe(key);
    }
    expect(rateLimitKey("2001:db8:85a3:43::1")).not.toBe(key);
    expect(rateLimitKey("::1")).toBe("0:0:0:0::/64");
    expect(rateLimitKey("2001:db8::")).toBe("2001:db8:0:0::/64");
  });

  it("keeps what is not an address as it is", () => {
    expect(rateLimitKey("unknown")).toBe("unknown");
    expect(rateLimitKey("1:2:3")).toBe("1:2:3");
    expect(rateLimitKey("1::2::3")).toBe("1::2::3");
    expect(rateLimitKey("999.1.1.1")).toBe("999.1.1.1");
    expect(rateLimitKey("x".repeat(100))).toHaveLength(64);
  });

  it("reads the client from the trusted proxy entry", () => {
    expect(clientRateLimitKey(h("6.6.6.6, 2001:db8:1:2::77"), 1)).toBe("2001:db8:1:2::/64");
    expect(clientRateLimitKey(h(), 1)).toBe("unknown");
  });
});

describe("trustedProxyHops", () => {
  it("defaults to 1 and accepts small positive integers only", () => {
    expect(trustedProxyHops({})).toBe(1);
    expect(trustedProxyHops({ STUDYOS_TRUSTED_PROXY_HOPS: "2" })).toBe(2);
    expect(trustedProxyHops({ STUDYOS_TRUSTED_PROXY_HOPS: "0" })).toBe(1);
    expect(trustedProxyHops({ STUDYOS_TRUSTED_PROXY_HOPS: "abc" })).toBe(1);
    expect(trustedProxyHops({ STUDYOS_TRUSTED_PROXY_HOPS: "99" })).toBe(1);
  });
});
