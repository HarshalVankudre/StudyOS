/**
 * Where the bytes of imported PDFs (NotebookFile) live: Google Cloud Storage
 * when ASSETS_BUCKET is configured (the same bucket as rendered assets,
 * under notebooks/<ownerId>/<fileId>.pdf), otherwise the row's own `data`
 * column in Postgres (local development and small deployments). Callers
 * never see the difference: they store with putPdfBytes, read with
 * readPdfBytes and delete with deletePdfObjects.
 *
 * Bytes are always served through GET /api/notebooks/files/:id (owner
 * checked, same origin), never by a signed bucket URL, so the PDF viewer's
 * fetch needs no Content-Security-Policy change.
 */
import "server-only";

import { Storage } from "@google-cloud/storage";

let storage: Storage | undefined;
function client(): Storage {
  // ADC on Cloud Run; elsewhere GOOGLE_APPLICATION_CREDENTIALS.
  storage ??= new Storage();
  return storage;
}

function bucketName(): string | null {
  return process.env.ASSETS_BUCKET?.trim() || null;
}

/** Where one file's bytes went: exactly one of the two is set. */
export interface StoredPdf {
  storageKey: string | null;
  data: Uint8Array<ArrayBuffer> | null;
}

/** A copy whose buffer is a plain ArrayBuffer (what Prisma's Bytes type wants). */
export function plainBytes(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  return bytes.buffer instanceof ArrayBuffer && bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength
    ? (bytes as Uint8Array<ArrayBuffer>)
    : new Uint8Array(bytes);
}

export function pdfObjectKey(ownerId: string, fileId: string): string {
  return `notebooks/${ownerId}/${fileId}.pdf`;
}

/**
 * Store a PDF. With a bucket the bytes are uploaded now (the row then holds
 * only the key); without one they are returned for the row's `data` column.
 */
export async function putPdfBytes(ownerId: string, fileId: string, bytes: Uint8Array): Promise<StoredPdf> {
  const bucket = bucketName();
  if (!bucket) return { storageKey: null, data: plainBytes(bytes) };
  const key = pdfObjectKey(ownerId, fileId);
  await client()
    .bucket(bucket)
    .file(key)
    .save(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength), {
      contentType: "application/pdf",
      resumable: false,
    });
  return { storageKey: key, data: null };
}

/** The file's bytes, or null when they are gone (or storage is not configured for a stored key). */
export async function readPdfBytes(row: { storageKey: string | null; data: Uint8Array | null }): Promise<Uint8Array | null> {
  if (row.data) return row.data;
  if (!row.storageKey) return null;
  const bucket = bucketName();
  if (!bucket) return null;
  try {
    const [contents] = await client().bucket(bucket).file(row.storageKey).download();
    return new Uint8Array(contents.buffer, contents.byteOffset, contents.byteLength);
  } catch (error) {
    if ((error as { code?: unknown }).code === 404) return null;
    throw error;
  }
}

/**
 * Best-effort deletion of stored objects. Returns the keys whose object is
 * gone (deleted now, or already missing) and how many failed. Without a
 * bucket nothing can be deleted, so every key counts as failed.
 */
export async function deletePdfObjects(keys: readonly string[]): Promise<{ deleted: string[]; failed: number }> {
  if (keys.length === 0) return { deleted: [], failed: 0 };
  const bucket = bucketName();
  if (!bucket) return { deleted: [], failed: keys.length };
  const results = await Promise.allSettled(
    keys.map((key) => client().bucket(bucket).file(key).delete({ ignoreNotFound: true })),
  );
  const deleted = keys.filter((_, i) => results[i].status === "fulfilled");
  return { deleted, failed: keys.length - deleted.length };
}
