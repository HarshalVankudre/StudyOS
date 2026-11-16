// src/lib/assets/service.test.ts
import { describe, expect, it } from "vitest";
import type { AssetRow, AssetRepo } from "./repo";
import type { AssetStore } from "./storage";
import { createAssetService } from "./service";
import { ArtifactRejectedError, AssetTooLargeError } from "./mime";

function fakes() {
  const rows = new Map<string, AssetRow>();
  const objects = new Map<string, Uint8Array>();
  const puts: { key: string; mime: string; size: number }[] = [];
  const reads: { key: string; maxBytes: number }[] = [];
  const repo: AssetRepo = {
    async insert(row) { rows.set(row.id, row); },
    async findById(id) { return rows.get(id) ?? null; },
  };
  const store: AssetStore = {
    async put(key, bytes, mime) {
      puts.push({ key, mime, size: bytes.byteLength });
      objects.set(key, bytes);
    },
    async signedReadUrl(key) { return `https://signed.example/${key}`; },
    async read(key, maxBytes) {
      reads.push({ key, maxBytes });
      const bytes = objects.get(key);
      if (!bytes) return null;
      if (bytes.byteLength > maxBytes) throw new AssetTooLargeError(maxBytes);
      return bytes;
    },
    async delete() {},
  };
  return { repo, store, rows, objects, puts, reads };
}

describe("asset service", () => {
  it("stores bytes, writes a row, returns a handle, and signs by owner", async () => {
    const { repo, store, puts } = fakes();
    const svc = createAssetService({ store, repo });

    const handle = await svc.createAsset({
      ownerId: "user_1",
      bytes: new Uint8Array([1, 2, 3]),
      mime: "image/png",
      filename: "page-1.png",
      sourceRunId: "task_9",
    });

    expect(handle.mime).toBe("image/png");
    expect(handle.filename).toBe("page-1.png");
    expect(puts).toHaveLength(1);
    expect(puts[0].key).toContain("assets/user_1/");
    expect(puts[0].key.endsWith(".png")).toBe(true);

    const url = await svc.signedUrlForAsset(handle.assetId, "user_1");
    expect(url).toContain("https://signed.example/assets/user_1/");
  });

  it("refuses to sign another owner's asset", async () => {
    const { repo, store } = fakes();
    const svc = createAssetService({ store, repo });
    const handle = await svc.createAsset({
      ownerId: "user_1",
      bytes: new Uint8Array([1]),
      mime: "image/png",
      filename: "a.png",
    });
    expect(await svc.signedUrlForAsset(handle.assetId, "user_2")).toBeNull();
    expect(await svc.signedUrlForAsset("missing", "user_1")).toBeNull();
  });

  it("reads an image's bytes and type for its owner only, through the store", async () => {
    const { repo, store, reads } = fakes();
    const svc = createAssetService({ store, repo });
    const handle = await svc.createAsset({ ownerId: "user_1", bytes: new Uint8Array([7, 8]), mime: "image/png", filename: "a.png" });
    const image = await svc.readImageForOwner(handle.assetId, "user_1", 100);
    expect(image).toEqual({ bytes: new Uint8Array([7, 8]), mime: "image/png" });
    expect(reads[0].maxBytes).toBe(100);
    expect(await svc.readImageForOwner(handle.assetId, "user_2")).toBeNull();
    expect(await svc.readImageForOwner("missing", "user_1")).toBeNull();
  });

  it("refuses to serve a non-image type, an oversized asset or a missing object", async () => {
    const { repo, store, rows, objects } = fakes();
    const svc = createAssetService({ store, repo });
    rows.set("html", { id: "html", ownerId: "u", mime: "text/html", sizeBytes: 3, storageKey: "k_html" });
    objects.set("k_html", new Uint8Array([1, 2, 3]));
    expect(await svc.readImageForOwner("html", "u")).toBeNull();
    // Too large by its row: never read.
    rows.set("big", { id: "big", ownerId: "u", mime: "image/png", sizeBytes: 11, storageKey: "k_big" });
    expect(await svc.readImageForOwner("big", "u", 10)).toBeNull();
    // Too large by its object (the row under-reports).
    rows.set("liar", { id: "liar", ownerId: "u", mime: "image/png", sizeBytes: 1, storageKey: "k_liar" });
    objects.set("k_liar", new Uint8Array(20));
    expect(await svc.readImageForOwner("liar", "u", 10)).toBeNull();
    rows.set("gone", { id: "gone", ownerId: "u", mime: "IMAGE/SVG+XML", sizeBytes: 1, storageKey: "k_gone" });
    expect(await svc.readImageForOwner("gone", "u")).toBeNull();
    objects.set("k_gone", new Uint8Array([1]));
    expect(await svc.readImageForOwner("gone", "u")).toEqual({ bytes: new Uint8Array([1]), mime: "image/svg+xml" });
  });

  it("rejects a disallowed mime before storing", async () => {
    const { repo, store, puts } = fakes();
    const svc = createAssetService({ store, repo });
    await expect(
      svc.createAsset({
        ownerId: "u",
        bytes: new Uint8Array([1]),
        // deliberately bad to prove the boundary holds at runtime
        mime: "application/pdf" as never,
        filename: "x.pdf",
      }),
    ).rejects.toBeInstanceOf(ArtifactRejectedError);
    expect(puts).toHaveLength(0);
  });
});
