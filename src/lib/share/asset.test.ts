// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ load: vi.fn() }));
vi.mock("./public-share", () => ({ loadPublicShare: m.load }));

import { MAX_ASSET_BYTES } from "@/lib/assets/mime";
import { sharedAssetImage } from "./asset";
import { TOKEN, WS_ID } from "./share-fixture";

const IMAGE = { bytes: new Uint8Array([137, 80, 78, 71]), mime: "image/png" };
const assets = { readImageForOwner: vi.fn() };

beforeEach(() => {
  m.load.mockReset().mockResolvedValue({
    share: { id: "share_1", token: TOKEN, userId: "user_owner", workspaceId: WS_ID, pageId: "pg_shared" },
    view: { title: "Cell biology", blocks: [] },
    assetIds: new Set(["asset_block", "asset_inline"]),
  });
  assets.readImageForOwner.mockReset().mockResolvedValue(IMAGE);
});

describe("images of a shared page", () => {
  it("serves an image the view shows, as the sharer's asset, within the size cap", async () => {
    expect(await sharedAssetImage(TOKEN, "asset_block", assets)).toBe(IMAGE);
    expect(await sharedAssetImage(TOKEN, "asset_inline", assets)).toBe(IMAGE);
    expect(assets.readImageForOwner).toHaveBeenCalledWith("asset_block", "user_owner", MAX_ASSET_BYTES);
  });

  it("serves no other asset of the sharer, even with a valid link", async () => {
    expect(await sharedAssetImage(TOKEN, "asset_private", assets)).toBeNull();
    expect(assets.readImageForOwner).not.toHaveBeenCalled();
  });

  it("serves nothing once the link is off, the workspace trashed or the page gone", async () => {
    m.load.mockResolvedValue(null);
    expect(await sharedAssetImage(TOKEN, "asset_block", assets)).toBeNull();
    expect(assets.readImageForOwner).not.toHaveBeenCalled();
  });

  it("refuses malformed tokens and ids before any lookup", async () => {
    expect(await sharedAssetImage("short", "asset_block", assets)).toBeNull();
    expect(await sharedAssetImage(TOKEN, "../secret", assets)).toBeNull();
    expect(m.load).not.toHaveBeenCalled();
  });

  it("serves nothing when the sharer does not own the asset, or it is not an image", async () => {
    assets.readImageForOwner.mockResolvedValue(null);
    expect(await sharedAssetImage(TOKEN, "asset_block", assets)).toBeNull();
  });
});
