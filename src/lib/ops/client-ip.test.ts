import { describe, expect, it } from "vitest";
import { clientAddress, trustedProxyHops } from "./client-ip";

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

describe("trustedProxyHops", () => {
  it("defaults to 1 and accepts small positive integers only", () => {
    expect(trustedProxyHops({})).toBe(1);
    expect(trustedProxyHops({ STUDYOS_TRUSTED_PROXY_HOPS: "2" })).toBe(2);
    expect(trustedProxyHops({ STUDYOS_TRUSTED_PROXY_HOPS: "0" })).toBe(1);
    expect(trustedProxyHops({ STUDYOS_TRUSTED_PROXY_HOPS: "abc" })).toBe(1);
    expect(trustedProxyHops({ STUDYOS_TRUSTED_PROXY_HOPS: "99" })).toBe(1);
  });
});
