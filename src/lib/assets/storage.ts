// src/lib/assets/storage.ts
import "server-only";
import { Storage } from "@google-cloud/storage";

/** Storage port. Swappable (GCS today; Postgres-bytea is a drop-in). */
export interface AssetStore {
  put(key: string, bytes: Uint8Array, mime: string): Promise<void>;
  signedReadUrl(key: string, ttlMs: number): Promise<string>;
}

let storage: Storage | undefined;
function client(): Storage {
  // ADC on Cloud Run; on Vercel set GOOGLE_APPLICATION_CREDENTIALS / a SA key.
  storage ??= new Storage();
  return storage;
}

function bucketName(): string {
  const name = process.env.ASSETS_BUCKET;
  if (!name) throw new Error("ASSETS_BUCKET is not configured");
  return name;
}

export function gcsAssetStore(): AssetStore {
  return {
    async put(key, bytes, mime) {
      await client()
        .bucket(bucketName())
        .file(key)
        .save(Buffer.from(bytes), { contentType: mime, resumable: false });
    },
    async signedReadUrl(key, ttlMs) {
      const [url] = await client()
        .bucket(bucketName())
        .file(key)
        .getSignedUrl({ version: "v4", action: "read", expires: Date.now() + ttlMs });
      return url;
    },
  };
}
