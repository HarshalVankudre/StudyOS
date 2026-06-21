// src/lib/assets/service.ts
import type { AssetRepo } from "./repo";
import type { AssetStore } from "./storage";
import {
  type AllowedMime,
  assertAllowedArtifact,
  extForMime,
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

  return { createAsset, signedUrlForAsset };
}
