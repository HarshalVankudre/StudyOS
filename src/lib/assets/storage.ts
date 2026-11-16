// src/lib/assets/storage.ts
import "server-only";
import { Storage } from "@google-cloud/storage";
import { AssetTooLargeError } from "./mime";

/** Storage port. Swappable (GCS today; Postgres-bytea is a drop-in). */
export interface AssetStore {
  put(key: string, bytes: Uint8Array, mime: string): Promise<void>;
  signedReadUrl(key: string, ttlMs: number): Promise<string>;
  /**
   * The object's bytes, read through the server (null when it does not
   * exist). Never downloads more than one byte past `maxBytes`; a larger
   * object throws AssetTooLargeError.
   */
  read(key: string, maxBytes: number): Promise<Uint8Array | null>;
  /** Best-effort removal (account deletion). Missing objects are not errors. */
  delete(key: string): Promise<void>;
}

let storage: Storage | undefined;
function client(): Storage {
  // ADC on Cloud Run; on Vercel set GOOGLE_APPLICATION_CREDENTIALS / a SA key.
  storage ??= new Storage();
  return storage;
}

function bucketName(): string {
  // Trimmed like the build's CSP and the startup check (lib/ops/env.ts),
  // so a value with a trailing newline names the same bucket everywhere.
  const name = process.env.ASSETS_BUCKET?.trim();
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
    async read(key, maxBytes) {
      try {
        // A ranged read (inclusive end): at most maxBytes + 1 bytes come down.
        const [bytes] = await client()
          .bucket(bucketName())
          .file(key)
          .download({ start: 0, end: maxBytes });
        if (bytes.byteLength > maxBytes) throw new AssetTooLargeError(maxBytes);
        return new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      } catch (error) {
        if ((error as { code?: unknown } | null)?.code === 404) return null;
        throw error;
      }
    },
    async delete(key) {
      await client()
        .bucket(bucketName())
        .file(key)
        .delete({ ignoreNotFound: true });
    },
  };
}
