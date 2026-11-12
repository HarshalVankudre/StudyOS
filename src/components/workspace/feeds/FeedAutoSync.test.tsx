import { readFileSync } from "node:fs";
import path from "node:path";
import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "@/lib/i18n/client";
import { en } from "@/lib/i18n/dictionaries/en";
import { readFeed } from "@/lib/feeds/normalize";
import type { FeedInfo } from "@/lib/feeds/types";
import type { Workspace } from "@/lib/workspace/types";
import { WorkspaceProvider, type SaveStatus } from "../WorkspaceContext";
import { FeedAutoSync } from "./FeedAutoSync";

const m = vi.hoisted(() => ({
  listFeedsAction: vi.fn(),
  fetchFeedForSyncAction: vi.fn(),
  recordFeedSyncAction: vi.fn(),
  releaseFeedAction: vi.fn(),
  toast: vi.fn(),
}));
vi.mock("@/app/app/feed-actions", () => ({
  listFeedsAction: m.listFeedsAction,
  fetchFeedForSyncAction: m.fetchFeedForSyncAction,
  recordFeedSyncAction: m.recordFeedSyncAction,
  releaseFeedAction: m.releaseFeedAction,
}));
vi.mock("sonner", () => ({ toast: m.toast }));

const canvas = readFeed(readFileSync(path.join(process.cwd(), "src/lib/feeds/fixtures/canvas.ics"), "utf8"), {
  now: Date.parse("2026-11-12T15:00:00Z"),
});

const workspace: Workspace = {
  id: "ws1",
  name: "Fall",
  pages: [],
  databases: [
    {
      id: "db",
      name: "Assignments",
      properties: [
        { id: "name", name: "Assignment", type: "text" },
        { id: "due", name: "Due", type: "date" },
      ],
      rows: [],
      views: [],
    },
  ],
};

const feed = (id: string, stale: boolean): FeedInfo => ({
  id,
  databaseId: "db",
  label: "canvas.university.edu",
  platform: "canvas",
  lastSyncedAt: null,
  lastAttemptAt: null,
  lastError: null,
  lastSummary: null,
  mapping: null,
  series: [],
  stale,
});

let update: ReturnType<typeof vi.fn<(mutator: (draft: Workspace) => void, options?: unknown) => void>>;

function view(status: SaveStatus, agentBusy: boolean) {
  return (
    <I18nProvider locale="en" dictionary={en}>
      <WorkspaceProvider value={{ workspace, update, status, rev: 0, agentBusy, setAgentBusy: () => {} }}>
        <FeedAutoSync />
      </WorkspaceProvider>
    </I18nProvider>
  );
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "Date"] });
  vi.setSystemTime(new Date("2026-11-12T15:00:00Z"));
  update = vi.fn<(mutator: (draft: Workspace) => void, options?: unknown) => void>();
  for (const fn of Object.values(m)) fn.mockReset();
  if (!canvas.ok) throw new Error("fixture");
  m.listFeedsAction.mockResolvedValue([feed("stale", true), feed("fresh", false)]);
  m.fetchFeedForSyncAction.mockResolvedValue({
    ok: true,
    feed: canvas.feed,
    databaseId: "db",
    seen: [],
    series: [],
    mapping: null,
  });
  m.recordFeedSyncAction.mockResolvedValue(null);
});
afterEach(() => vi.useRealTimers());

const flush = () => act(async () => {
  await vi.advanceTimersByTimeAsync(0);
});

describe("sync on open", () => {
  it("syncs only stale feeds, through update(), and tells the student what changed", async () => {
    render(view("saved", false));
    await flush();
    expect(m.fetchFeedForSyncAction).toHaveBeenCalledTimes(1);
    expect(m.fetchFeedForSyncAction).toHaveBeenCalledWith("stale", true);
    expect(update).toHaveBeenCalledTimes(1);
    // Its own undo step, re-run (not patched) if the document changed meanwhile.
    expect(update.mock.calls[0][1]).toEqual({ coalesceKey: null, rebase: "rerun" });
    expect(m.recordFeedSyncAction).toHaveBeenCalledWith("stale", expect.objectContaining({ considered: expect.any(Array) }));
    expect(m.toast).toHaveBeenCalledWith(expect.stringMatching(/^Calendar sync \(canvas\.university\.edu\): \d+ new/), expect.anything());
  });

  it("waits while the AI agent works or a save is pending, then syncs", async () => {
    const { rerender } = render(view("saving", true));
    await flush();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    expect(m.fetchFeedForSyncAction).not.toHaveBeenCalled();

    rerender(view("saved", false));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });
    expect(m.fetchFeedForSyncAction).toHaveBeenCalledWith("stale", true);
  });

  it("does nothing visible when another tab already holds the feed or it is fresh", async () => {
    m.fetchFeedForSyncAction.mockResolvedValue({ ok: false, error: "fresh" });
    render(view("saved", false));
    await flush();
    expect(update).not.toHaveBeenCalled();
    expect(m.toast).not.toHaveBeenCalled();
  });
});
