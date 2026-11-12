import { afterEach, describe, expect, it, vi } from "vitest";
import { FeedKeyMissingError, feedLinksAvailable, feedUrlHash, needsReseal, openFeedUrl, sealFeedUrl } from "./secret";

const LINK = "https://canvas.university.edu/feeds/calendars/user_8hT3kQ0aZx1Yc2Vb7Nn4Mm5Ll6Kk.ics";

afterEach(() => vi.unstubAllEnvs());

describe("sealing feed links", () => {
  it("encrypts with FEED_URL_KEY and opens again only with the same key", () => {
    vi.stubEnv("FEED_URL_KEY", "a-long-random-production-secret");
    const sealed = sealFeedUrl(LINK);
    expect(sealed.startsWith("g1:")).toBe(true);
    expect(sealed).not.toContain("8hT3kQ0aZx1Yc2Vb7Nn4Mm5Ll6Kk");
    expect(sealFeedUrl(LINK)).not.toBe(sealed); // random IV
    expect(openFeedUrl(sealed)).toBe(LINK);

    vi.stubEnv("FEED_URL_KEY", "a-different-secret");
    expect(openFeedUrl(sealed)).toBeNull();
    vi.stubEnv("FEED_URL_KEY", "");
    expect(openFeedUrl(sealed)).toBeNull();
  });

  it("without a key, stores the link encoded (local development) and still opens it", () => {
    vi.stubEnv("FEED_URL_KEY", "");
    const sealed = sealFeedUrl(LINK);
    expect(sealed.startsWith("p1:")).toBe(true);
    expect(openFeedUrl(sealed)).toBe(LINK);
  });

  it("rejects tampered or foreign values", () => {
    vi.stubEnv("FEED_URL_KEY", "k");
    const sealed = sealFeedUrl(LINK);
    expect(openFeedUrl(`${sealed.slice(0, -2)}xx`)).toBeNull();
    expect(openFeedUrl("https://plain.example/feed.ics")).toBeNull();
  });

  it("pins the GCM tag length: a truncated or padded tag never opens (review: a 4-byte tag was accepted)", () => {
    vi.stubEnv("FEED_URL_KEY", "k".repeat(40));
    const sealed = sealFeedUrl(LINK);
    const [iv, tag, body] = sealed.slice(3).split(".");
    const tagBytes = Buffer.from(tag, "base64url");
    expect(tagBytes.length).toBe(16);
    for (const n of [0, 4, 8, 12, 15]) {
      expect(openFeedUrl(`g1:${iv}.${tagBytes.subarray(0, n).toString("base64url")}.${body}`), `${n} bytes`).toBeNull();
    }
    expect(openFeedUrl(`g1:${iv}.${Buffer.concat([tagBytes, Buffer.from([0])]).toString("base64url")}.${body}`)).toBeNull();
    expect(openFeedUrl(`g1:${iv}.${tag}.${body}.extra`)).toBeNull();
    expect(openFeedUrl(sealed)).toBe(LINK);
  });

  it("says calendar links are unavailable only in production without a key", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("FEED_URL_KEY", "");
    expect(feedLinksAvailable()).toBe(false);
    vi.stubEnv("FEED_URL_KEY", "a-key");
    expect(feedLinksAvailable()).toBe(true);
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("FEED_URL_KEY", "");
    expect(feedLinksAvailable()).toBe(true);
  });

  it("refuses to store a link unencrypted in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("FEED_URL_KEY", "");
    expect(() => sealFeedUrl(LINK)).toThrow(FeedKeyMissingError);
    vi.stubEnv("FEED_URL_KEY", "a-key");
    expect(sealFeedUrl(LINK).startsWith("g1:")).toBe(true);
  });

  it("flags a merely encoded value for resealing once a key is set", () => {
    vi.stubEnv("FEED_URL_KEY", "");
    const encoded = sealFeedUrl(LINK);
    expect(needsReseal(encoded)).toBe(false);
    vi.stubEnv("FEED_URL_KEY", "now-set");
    expect(needsReseal(encoded)).toBe(true);
    expect(openFeedUrl(encoded)).toBe(LINK);
    expect(needsReseal(sealFeedUrl(LINK))).toBe(false);
  });

  it("fingerprints a link without revealing it", () => {
    expect(feedUrlHash(LINK)).toMatch(/^[0-9a-f]{64}$/);
    expect(feedUrlHash(LINK)).toBe(feedUrlHash(LINK));
  });
});
