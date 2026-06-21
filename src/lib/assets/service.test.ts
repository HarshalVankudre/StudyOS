// src/lib/assets/service.test.ts
import { describe, expect, it } from "vitest";
import type { AssetRow, AssetRepo } from "./repo";
import type { AssetStore } from "./storage";
import { createAssetService } from "./service";
import { ArtifactRejectedError } from "./mime";

function fakes() {
  const rows = new Map<string, AssetRow>();
  const puts: { key: string; mime: string; size: number }[] = [];
  const repo: AssetRepo = {
    async insert(row) { rows.set(row.id, row); },
    async findById(id) { return rows.get(id) ?? null; },
  };
  const store: AssetStore = {
    async put(key, bytes, mime) { puts.push({ key, mime, size: bytes.byteLength }); },
    async signedReadUrl(key) { return `https://signed.example/${key}`; },
  };
  return { repo, store, rows, puts };
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
