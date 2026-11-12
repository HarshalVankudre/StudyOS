import { afterEach, describe, expect, it, vi } from "vitest";
import { feedUrlHash, openFeedUrl, sealFeedUrl } from "./secret";

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

  it("fingerprints a link without revealing it", () => {
    expect(feedUrlHash(LINK)).toMatch(/^[0-9a-f]{64}$/);
    expect(feedUrlHash(LINK)).toBe(feedUrlHash(LINK));
  });
});
