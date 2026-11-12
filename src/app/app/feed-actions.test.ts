import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  userId: "user_1" as string | null,
  workspaceFindFirst: vi.fn(),
  feedFindFirst: vi.fn(),
  feedFindMany: vi.fn(),
  feedCount: vi.fn(),
  feedCreate: vi.fn(),
  feedUpdate: vi.fn(),
  feedUpdateMany: vi.fn(),
  feedDeleteMany: vi.fn(),
  usageCount: vi.fn(),
  usageCreate: vi.fn(),
  subFindUnique: vi.fn(),
  fetchFeed: vi.fn(),
  reportError: vi.fn(),
}));

vi.mock("@clerk/nextjs/server", () => ({ auth: async () => ({ userId: m.userId }) }));
vi.mock("@/lib/db", () => ({
  prisma: {
    workspace: { findFirst: m.workspaceFindFirst },
    calendarFeed: {
      findFirst: m.feedFindFirst,
      findMany: m.feedFindMany,
      count: m.feedCount,
      create: m.feedCreate,
      update: m.feedUpdate,
      updateMany: m.feedUpdateMany,
      deleteMany: m.feedDeleteMany,
    },
    usageEvent: { count: m.usageCount, create: m.usageCreate },
    subscription: { findUnique: m.subFindUnique },
    // Usage limits count and record under an advisory lock in a transaction.
    $transaction: async (fn: (tx: unknown) => unknown) =>
      fn({ $queryRaw: async () => [], usageEvent: { count: m.usageCount, create: m.usageCreate } }),
  },
}));
vi.mock("@/lib/ops/report-error", () => ({ reportError: m.reportError }));
vi.mock("@/lib/feeds/fetch-feed", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/feeds/fetch-feed")>();
  return { ...actual, fetchFeed: m.fetchFeed };
});

import { FeedFetchError } from "@/lib/feeds/fetch-feed";
import {
  connectFeedAction,
  disconnectFeedAction,
  fetchFeedForSyncAction,
  listFeedsAction,
  previewFeedAction,
  recordFeedSyncAction,
} from "./feed-actions";

const SECRET = "https://canvas.university.edu/feeds/calendars/user_8hT3kQ0aZx1Yc2Vb7Nn4Mm5Ll6Kk.ics";
const canvas = readFileSync(path.join(process.cwd(), "src/lib/feeds/fixtures/canvas.ics"), "utf8");

const feedRow = (over: Record<string, unknown> = {}) => ({
  id: "feed_1",
  databaseId: "db-assign",
  label: "canvas.university.edu",
  platform: "canvas",
  settings: JSON.stringify({ seen: ["a"], series: [], mapping: { title: "a-name" } }),
  lastSyncedAt: null,
  lastAttemptAt: null,
  lastError: null,
  lastSummary: null,
  ...over,
});

beforeEach(() => {
  m.userId = "user_1";
  for (const fn of Object.values(m)) if (typeof fn === "function" && "mockReset" in fn) fn.mockReset();
  m.workspaceFindFirst.mockResolvedValue({ id: "ws1" });
  m.usageCount.mockResolvedValue(0);
  m.usageCreate.mockResolvedValue({});
  m.subFindUnique.mockResolvedValue(null);
  m.feedFindFirst.mockResolvedValue(null);
  m.feedCount.mockResolvedValue(0);
  m.fetchFeed.mockResolvedValue({ status: 200, contentType: "text/calendar", text: canvas, finalHost: "canvas.university.edu" });
});
afterEach(() => vi.unstubAllEnvs());

describe("previewFeedAction", () => {
  it("fetches a webcal link over https and returns events, never the link", async () => {
    const result = await previewFeedAction("ws1", SECRET.replace("https://", "webcal://"));
    expect(m.fetchFeed).toHaveBeenCalledWith(SECRET);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.label).toBe("canvas.university.edu");
    expect(result.feed.platform).toBe("canvas");
    expect(result.feed.events.length).toBeGreaterThan(0);
    expect(JSON.stringify(result)).not.toContain("user_8hT3kQ0aZx1Yc2Vb7Nn4Mm5Ll6Kk");
    expect(m.usageCreate).toHaveBeenCalledWith({ data: { userId: "user_1", kind: "feed_sync" } });
  });

  it("requires sign-in and ownership of the workspace", async () => {
    m.userId = null;
    expect(await previewFeedAction("ws1", SECRET)).toEqual({ ok: false, error: "not_found" });
    m.userId = "user_1";
    m.workspaceFindFirst.mockResolvedValue(null);
    expect(await previewFeedAction("ws-of-someone-else", SECRET)).toEqual({ ok: false, error: "not_found" });
    expect(m.workspaceFindFirst.mock.calls[0][0].where).toMatchObject({ ownerId: "user_1", deletedAt: null });
    expect(m.fetchFeed).not.toHaveBeenCalled();
  });

  it("rejects links it will not fetch before any request", async () => {
    expect(await previewFeedAction("ws1", "javascript:alert(1)")).toEqual({ ok: false, error: "unsupported_link" });
    expect(await previewFeedAction("ws1", "https://localhost/feed.ics")).toEqual({ ok: false, error: "unsupported_link" });
    expect(await previewFeedAction("ws1", "https://lms.edu:8080/feed.ics")).toEqual({ ok: false, error: "unsupported_link" });
    expect(await previewFeedAction("ws1", "not a link")).toEqual({ ok: false, error: "invalid_url" });
    expect(m.fetchFeed).not.toHaveBeenCalled();
  });

  it("is rate limited per user", async () => {
    m.usageCount.mockResolvedValue(30);
    expect(await previewFeedAction("ws1", SECRET)).toEqual({ ok: false, error: "rate_limited" });
    expect(m.fetchFeed).not.toHaveBeenCalled();
  });

  it("explains what went wrong: expired link, a page that is not a calendar", async () => {
    m.fetchFeed.mockRejectedValueOnce(new FeedFetchError("link_expired"));
    expect(await previewFeedAction("ws1", SECRET)).toEqual({ ok: false, error: "link_expired" });
    m.fetchFeed.mockResolvedValueOnce({ status: 200, contentType: "text/html", text: "<html>Log in</html>", finalHost: "x" });
    expect(await previewFeedAction("ws1", SECRET)).toEqual({ ok: false, error: "not_calendar" });
  });

  it("reports unexpected failures without the link", async () => {
    m.fetchFeed.mockRejectedValueOnce(new Error(`socket hang up while reading ${SECRET}`));
    expect(await previewFeedAction("ws1", SECRET)).toEqual({ ok: false, error: "failed" });
    const reported = JSON.stringify(m.reportError.mock.calls);
    expect(reported).not.toContain("user_8hT3kQ0aZx1Yc2Vb7Nn4Mm5Ll6Kk");
    expect(reported).not.toContain("canvas.university.edu");
  });
});

describe("connectFeedAction", () => {
  it("stores the link sealed, and returns only the host", async () => {
    m.feedCreate.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => feedRow({ settings: data.settings }));
    const result = await connectFeedAction({
      workspaceId: "ws1",
      databaseId: "db-assign",
      url: SECRET,
      platform: "canvas",
      mapping: { title: "a-name", due: "a-due" },
      series: [],
    });
    expect(result.ok).toBe(true);
    const data = m.feedCreate.mock.calls[0][0].data;
    expect(data.userId).toBe("user_1");
    expect(data.urlSealed).not.toContain("user_8hT3kQ0aZx1Yc2Vb7Nn4Mm5Ll6Kk");
    expect(data.urlHash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(result)).not.toContain("user_8hT3kQ0aZx1Yc2Vb7Nn4Mm5Ll6Kk");
  });

  it("refuses the same link twice in one workspace", async () => {
    m.feedFindFirst.mockResolvedValueOnce({ id: "feed_1" });
    const result = await connectFeedAction({
      workspaceId: "ws1",
      databaseId: "db-assign",
      url: SECRET,
      platform: "canvas",
      mapping: {},
      series: [],
    });
    expect(result).toEqual({ ok: false, error: "already_connected" });
    expect(m.feedCreate).not.toHaveBeenCalled();
  });

  it("without FEED_URL_KEY in production: preview still works once, connecting is refused, nothing is stored", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("FEED_URL_KEY", "");
    const preview = await previewFeedAction("ws1", SECRET);
    expect(preview).toMatchObject({ ok: true, canConnect: false });
    const result = await connectFeedAction({
      workspaceId: "ws1",
      databaseId: "db-assign",
      url: SECRET,
      platform: "canvas",
      mapping: {},
      series: [],
    });
    expect(result).toEqual({ ok: false, error: "links_unavailable" });
    expect(m.feedCreate).not.toHaveBeenCalled();
    vi.stubEnv("FEED_URL_KEY", "a-real-key");
    expect(await previewFeedAction("ws1", SECRET)).toMatchObject({ ok: true, canConnect: true });
  });
});

describe("syncing a connected feed", () => {
  it("auto-sync only runs when the feed is stale and no other tab holds it", async () => {
    m.feedUpdateMany.mockResolvedValueOnce({ count: 0 });
    m.feedFindFirst.mockResolvedValueOnce({ syncLeaseUntil: null });
    expect(await fetchFeedForSyncAction("feed_1", true)).toEqual({ ok: false, error: "fresh" });
    const where = m.feedUpdateMany.mock.calls[0][0].where;
    expect(where).toMatchObject({ id: "feed_1", userId: "user_1" });
    expect(JSON.stringify(where)).toContain("lastSyncedAt");
    expect(m.fetchFeed).not.toHaveBeenCalled();
  });

  it("fetches with the stored link and returns the events and what was decided before", async () => {
    m.feedUpdateMany.mockResolvedValue({ count: 1 });
    const sealed = `p1:${Buffer.from(SECRET).toString("base64url")}`;
    m.feedFindFirst.mockResolvedValueOnce({ urlSealed: sealed, databaseId: "db-assign", settings: feedRow().settings });
    const result = await fetchFeedForSyncAction("feed_1", false);
    expect(m.fetchFeed).toHaveBeenCalledWith(SECRET);
    expect(result).toMatchObject({ ok: true, databaseId: "db-assign", seen: ["a"], mapping: { title: "a-name" } });
    expect(JSON.stringify(result)).not.toContain("user_8hT3kQ0aZx1Yc2Vb7Nn4Mm5Ll6Kk");
  });

  it("keeps the error code and releases the feed when the fetch fails", async () => {
    m.feedUpdateMany.mockResolvedValue({ count: 1 });
    m.feedFindFirst.mockResolvedValueOnce({ urlSealed: `p1:${Buffer.from(SECRET).toString("base64url")}`, databaseId: "d", settings: "{}" });
    m.fetchFeed.mockRejectedValueOnce(new FeedFetchError("link_expired"));
    expect(await fetchFeedForSyncAction("feed_1", false)).toEqual({ ok: false, error: "link_expired" });
    expect(m.feedUpdateMany).toHaveBeenLastCalledWith({
      where: { id: "feed_1", userId: "user_1" },
      data: { syncLeaseUntil: null, lastError: "link_expired" },
    });
  });

  it("records what changed and remembers the decided events", async () => {
    m.feedFindFirst.mockResolvedValueOnce({ settings: feedRow().settings });
    m.feedUpdate.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => feedRow({ ...data }));
    const summary = {
      at: "x",
      added: 1,
      updated: 0,
      flagged: 0,
      restored: 0,
      linked: 0,
      keptEdits: 0,
      titles: { added: ["Lab 10"], updated: [], flagged: [], restored: [] },
    };
    const info = await recordFeedSyncAction("feed_1", { summary, considered: ["b", "a"] });
    expect(info?.lastSummary?.titles.added).toEqual(["Lab 10"]);
    const saved = JSON.parse(m.feedUpdate.mock.calls[0][0].data.settings);
    expect(saved.seen).toEqual(["b", "a"]);
    expect(m.feedUpdate.mock.calls[0][0].data.syncLeaseUntil).toBeNull();
  });

  it("lists and disconnects only the user's own feeds", async () => {
    m.feedFindMany.mockResolvedValueOnce([feedRow()]);
    const list = await listFeedsAction("ws1");
    expect(list[0]).toMatchObject({ id: "feed_1", label: "canvas.university.edu", stale: true });
    expect(m.feedFindMany.mock.calls[0][0].where).toEqual({ userId: "user_1", workspaceId: "ws1" });
    expect(m.feedFindMany.mock.calls[0][0].select).not.toHaveProperty("urlSealed");

    m.feedDeleteMany.mockResolvedValueOnce({ count: 1 });
    expect(await disconnectFeedAction("feed_1")).toBe(true);
    expect(m.feedDeleteMany).toHaveBeenCalledWith({ where: { id: "feed_1", userId: "user_1" } });
  });
});
