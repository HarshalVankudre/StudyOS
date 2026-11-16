// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ live: vi.fn(), doc: vi.fn(), zone: vi.fn() }));
vi.mock("./store", () => ({ findLiveShare: m.live, loadSharedDocument: m.doc, ownerTimeZone: m.zone }));

import type { Workspace } from "@/lib/workspace/types";
import { clearPublicShareCache, loadPublicShare, PUBLIC_VIEW_TTL_MS } from "./public-share";
import { sharedWorkspace, TOKEN, WS_ID } from "./share-fixture";

const SHARE = { id: "share_1", token: TOKEN, userId: "user_owner", workspaceId: WS_ID, pageId: "pg_shared" };
const docAt = (version: number, ws: Workspace = sharedWorkspace()) => ({
  workspace: ws,
  page: ws.pages.find((p) => p.id === "pg_shared")!,
  version,
});

beforeEach(() => {
  clearPublicShareCache();
  m.live.mockReset().mockResolvedValue({ share: SHARE, version: 3 });
  m.doc.mockReset().mockImplementation(async () => docAt(3));
  m.zone.mockReset().mockResolvedValue("UTC");
});

describe("loading a shared page's public view", () => {
  it("computes the view and the assets it shows", async () => {
    const shared = await loadPublicShare(TOKEN);
    expect(shared?.share).toEqual(SHARE);
    expect(shared?.view.title).toBe("Cell biology");
    expect([...(shared?.assetIds ?? [])].sort()).toEqual(["asset_block", "asset_inline"]);
  });

  it("reuses the computed view while the workspace version is unchanged, checking the link every time", async () => {
    await loadPublicShare(TOKEN);
    await loadPublicShare(TOKEN);
    await loadPublicShare(TOKEN);
    expect(m.live).toHaveBeenCalledTimes(3);
    expect(m.doc).toHaveBeenCalledTimes(1);
    expect(m.zone).toHaveBeenCalledTimes(1);
  });

  it("shows an edit at once: a new version is a new view", async () => {
    await loadPublicShare(TOKEN);
    const edited = sharedWorkspace();
    edited.pages[0].title = "Cell biology, revised";
    m.live.mockResolvedValue({ share: SHARE, version: 4 });
    m.doc.mockResolvedValue(docAt(4, edited));
    expect((await loadPublicShare(TOKEN))?.view.title).toBe("Cell biology, revised");
  });

  it("stops serving at once when the link stops working, cached or not", async () => {
    await loadPublicShare(TOKEN);
    m.live.mockResolvedValue(null);
    expect(await loadPublicShare(TOKEN)).toBeNull();
  });

  it("is null when the page is gone, without re-reading the document for that version", async () => {
    m.doc.mockResolvedValue(null);
    expect(await loadPublicShare(TOKEN)).toBeNull();
    expect(await loadPublicShare(TOKEN)).toBeNull();
    expect(m.doc).toHaveBeenCalledTimes(1);
  });

  it("builds once for visitors arriving together", async () => {
    const results = await Promise.all([loadPublicShare(TOKEN), loadPublicShare(TOKEN), loadPublicShare(TOKEN)]);
    expect(results.every((r) => r?.view.title === "Cell biology")).toBe(true);
    expect(m.doc).toHaveBeenCalledTimes(1);
  });

  it("builds again once the time to live is over", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-11-13T12:00:00Z"));
      await loadPublicShare(TOKEN);
      vi.setSystemTime(new Date(Date.now() + PUBLIC_VIEW_TTL_MS + 1));
      await loadPublicShare(TOKEN);
      expect(m.doc).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("evaluates date filters on the sharer's day, in their time zone", async () => {
    const ws = sharedWorkspace();
    const db = ws.databases[0];
    db.properties.push({ id: "prop_due", name: "Due", type: "date" });
    db.rows[0].cells.prop_due = "2026-11-14";
    db.rows[1].cells.prop_due = "2026-11-13";
    db.views[0] = {
      id: "vw_open",
      name: "Due today",
      type: "table",
      visiblePropertyIds: ["prop_title"],
      filters: [{ propertyId: "prop_due", operator: "is", value: "today" }],
    };
    m.doc.mockResolvedValue(docAt(3, ws));
    // 12:00 UTC on the 13th is already the 14th in Kiritimati (UTC+14).
    m.zone.mockResolvedValue("Pacific/Kiritimati");
    const now = new Date("2026-11-13T12:00:00Z");
    const table = (await loadPublicShare(TOKEN, now))?.view.blocks.find((b) => b.type === "table");
    expect(m.zone).toHaveBeenCalledWith("user_owner");
    expect(table).toMatchObject({ rows: [["Read chapter 3"]] });
  });
});
