// src/lib/assets/service.ts
import type { AssetRepo } from "./repo";
import type { AssetStore } from "./storage";
import {
  type AllowedMime,
  assertAllowedArtifact,
  AssetTooLargeError,
  extForMime,
  MAX_ASSET_BYTES,
} from "./mime";

export type AssetHandle = { assetId: string; mime: string; filename: string };

export type CreateAssetInput = {
  ownerId: string;
  workspaceId?: string;
  bytes: Uint8Array;
  mime: AllowedMime;
  filename: string;
  sourceRunId?: string;
};

export type CreateAssetFn = (input: CreateAssetInput) => Promise<AssetHandle>;

/**
 * Image types an asset may be served as through the server (readImageForOwner):
 * rendered by <img>, where even SVG runs no script. Anything else is refused.
 */
export const SERVABLE_IMAGE_MIME: ReadonlySet<string> = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/avif",
  "image/svg+xml",
]);

export type AssetImage = { bytes: Uint8Array; mime: string };

/** Short TTL for a read URL — long enough to render, short enough to not leak. */
const SIGNED_URL_TTL_MS = 5 * 60 * 1000;

export function createAssetService(deps: { store: AssetStore; repo: AssetRepo }) {
  const { store, repo } = deps;

  const createAsset: CreateAssetFn = async (input) => {
    // Untrusted-artifact boundary FIRST — never store an oversized/wrong type.
    assertAllowedArtifact(input.bytes, input.mime);

    const id = crypto.randomUUID();
    const key = `assets/${input.ownerId}/${id}.${extForMime(input.mime)}`;

    await store.put(key, input.bytes, input.mime);
    await repo.insert({
      id,
      ownerId: input.ownerId,
      workspaceId: input.workspaceId ?? null,
      mime: input.mime,
      sizeBytes: input.bytes.byteLength,
      storageKey: key,
      sourceRunId: input.sourceRunId ?? null,
    });

    return { assetId: id, mime: input.mime, filename: input.filename };
  };

  async function signedUrlForAsset(
    assetId: string,
    ownerId: string,
  ): Promise<string | null> {
    const row = await repo.findById(assetId);
    if (!row || row.ownerId !== ownerId) return null; // owner-scoped
    return store.signedReadUrl(row.storageKey, SIGNED_URL_TTL_MS);
  }

  /**
   * An image asset's bytes and type (from its row), read through the server
   * so no storage URL (which names the owner) reaches the browser. Null when
   * `ownerId` does not own it, it is not a servable image type, it is larger
   * than `maxBytes` (by its row or its object) or its object is gone.
   */
  async function readImageForOwner(
    assetId: string,
    ownerId: string,
    maxBytes: number = MAX_ASSET_BYTES,
  ): Promise<AssetImage | null> {
    const row = await repo.findById(assetId);
    if (!row || row.ownerId !== ownerId) return null; // owner-scoped
    const mime = row.mime.trim().toLowerCase();
    if (!SERVABLE_IMAGE_MIME.has(mime)) return null;
    if (row.sizeBytes > maxBytes) return null;
    try {
      const bytes = await store.read(row.storageKey, maxBytes);
      return bytes ? { bytes, mime } : null;
    } catch (error) {
      if (error instanceof AssetTooLargeError) return null;
      throw error;
    }
  }

  return { createAsset, signedUrlForAsset, readImageForOwner };
}
