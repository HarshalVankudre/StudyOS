import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  calendarFeed: {
    updateMany: vi.fn(),
    findFirst: vi.fn(),
    count: vi.fn(),
    create: vi.fn(),
  },
}));
vi.mock("@/lib/db", () => ({ prisma: db }));

import { claimFeedForSync, connectFeed } from "./store";
import { openFeedUrl, sealFeedUrl } from "./secret";

const LINK = "https://canvas.university.edu/feeds/calendars/user_8hT3kQ0aZx1Yc2Vb7Nn4Mm5Ll6Kk.ics";

beforeEach(() => {
  for (const fn of Object.values(db.calendarFeed)) fn.mockReset();
});
afterEach(() => vi.unstubAllEnvs());

describe("feed link storage", () => {
  it("re-seals a link stored merely encoded the first time it is used after FEED_URL_KEY is set", async () => {
    vi.stubEnv("FEED_URL_KEY", "");
    const encoded = sealFeedUrl(LINK);
    expect(encoded.startsWith("p1:")).toBe(true);
    vi.stubEnv("FEED_URL_KEY", "now-a-real-key");

    db.calendarFeed.updateMany.mockResolvedValue({ count: 1 });
    db.calendarFeed.findFirst.mockResolvedValue({ urlSealed: encoded, databaseId: "db1", settings: "{}" });
    const claim = await claimFeedForSync("u1", "f1", false);
    expect(claim).toMatchObject({ ok: true, url: LINK });

    const reseal = db.calendarFeed.updateMany.mock.calls.find(([arg]) => arg.data?.urlSealed);
    expect(reseal).toBeDefined();
    const [arg] = reseal!;
    // Only replaces the exact value read (a concurrent reconnect is not overwritten).
    expect(arg.where).toEqual({ id: "f1", userId: "u1", urlSealed: encoded });
    expect(arg.data.urlSealed.startsWith("g1:")).toBe(true);
    expect(arg.data.urlSealed).not.toContain("8hT3kQ0aZx1Yc2Vb7Nn4Mm5Ll6Kk");
    expect(openFeedUrl(arg.data.urlSealed)).toBe(LINK);
  });

  it("does not rewrite an already sealed link", async () => {
    vi.stubEnv("FEED_URL_KEY", "key");
    db.calendarFeed.updateMany.mockResolvedValue({ count: 1 });
    db.calendarFeed.findFirst.mockResolvedValue({ urlSealed: sealFeedUrl(LINK), databaseId: "db1", settings: "{}" });
    await claimFeedForSync("u1", "f1", false);
    expect(db.calendarFeed.updateMany.mock.calls.some(([arg]) => arg.data?.urlSealed)).toBe(false);
  });

  it("refuses to connect a feed in production without FEED_URL_KEY (never stores it unencrypted)", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("FEED_URL_KEY", "");
    db.calendarFeed.count.mockResolvedValue(0);
    db.calendarFeed.findFirst.mockResolvedValue(null);
    const result = await connectFeed({
      userId: "u1",
      workspaceId: "w1",
      databaseId: "db1",
      url: LINK,
      platform: "canvas",
      mapping: {},
      series: [],
    });
    expect(result).toEqual({ ok: false, error: "links_unavailable" });
    expect(db.calendarFeed.create).not.toHaveBeenCalled();
  });

  it("pauses a connected feed while FEED_URL_KEY is missing instead of asking to reconnect", async () => {
    vi.stubEnv("FEED_URL_KEY", "the-key");
    const sealed = sealFeedUrl(LINK);
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("FEED_URL_KEY", "");
    db.calendarFeed.updateMany.mockResolvedValue({ count: 1 });
    db.calendarFeed.findFirst.mockResolvedValue({ urlSealed: sealed, databaseId: "db1", settings: "{}" });
    expect(await claimFeedForSync("u1", "f1", false)).toEqual({ ok: false, error: "links_unavailable" });
    const released = db.calendarFeed.updateMany.mock.calls.at(-1)![0];
    expect(released.data).toEqual({ syncLeaseUntil: null, lastError: "links_unavailable" });
    // Nothing was rewritten: the sealed link opens again once the key is back.
    expect(db.calendarFeed.updateMany.mock.calls.some(([arg]) => arg.data?.urlSealed)).toBe(false);
  });
});
