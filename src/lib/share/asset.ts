/**
 * Images of a shared page (/s/<token>/asset/<assetId>). Assets are
 * owner-only (/api/asset/<id> serves the signed-in owner alone); a share
 * link opens exactly the images its public view shows (an image block, or an
 * uploaded image its Markdown embeds; public-view.ts publicAssetIds) and
 * nothing else the sharer owns. A revoked link, a trashed workspace or a
 * deleted page serves none.
 *
 * The bytes go through the server (never a redirect to a signed storage URL:
 * its object path names the sharer's account id), with the type the Asset
 * row records, image types only, at most MAX_ASSET_BYTES.
 */
import "server-only";

import { MAX_ASSET_BYTES } from "@/lib/assets/mime";
import type { AssetImage } from "@/lib/assets/service";
import { loadPublicShare } from "./public-share";
import { isAssetIdShape, isShareTokenShape } from "./token";

export interface SharedImageSource {
  /** The image's bytes and type if `ownerId` owns it and it is a servable image, else null. */
  readImageForOwner(assetId: string, ownerId: string, maxBytes?: number): Promise<AssetImage | null>;
}

/** The image to send, or null for a 404. */
export async function sharedAssetImage(
  token: string,
  assetId: string,
  assets: SharedImageSource,
  maxBytes: number = MAX_ASSET_BYTES,
): Promise<AssetImage | null> {
  if (!isShareTokenShape(token) || !isAssetIdShape(assetId)) return null;
  const shared = await loadPublicShare(token);
  if (!shared || !shared.assetIds.has(assetId)) return null;
  // Still owner-scoped: an id the page names but the sharer does not own serves nothing.
  return assets.readImageForOwner(assetId, shared.share.userId, maxBytes);
}
