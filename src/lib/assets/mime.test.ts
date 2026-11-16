import { describe, expect, it } from "vitest";
import {
  ArtifactRejectedError,
  MAX_ASSET_BYTES,
  assertAllowedArtifact,
  extForMime,
  isUploadImageMime,
  mimeForOutputPath,
} from "./mime";

describe("artifact mime + size boundary", () => {
  it("maps allowed mimes to extensions and back from output paths", () => {
    expect(extForMime("image/png")).toBe("png");
    expect(extForMime("image/svg+xml")).toBe("svg");
    expect(mimeForOutputPath("out/page-1.png")).toBe("image/png");
    expect(mimeForOutputPath("out/diagram.SVG")).toBe("image/svg+xml");
    expect(mimeForOutputPath("out/report.pdf")).toBeNull();
  });

  it("stores uploaded photos, but sandbox outputs still resolve only to PNG and SVG", () => {
    expect(extForMime("image/jpeg")).toBe("jpg");
    expect(() => assertAllowedArtifact(new Uint8Array(10), "image/webp")).not.toThrow();
    expect(mimeForOutputPath("out/photo.jpg")).toBeNull();
    expect(mimeForOutputPath("out/anim.gif")).toBeNull();
    expect(isUploadImageMime("image/jpeg")).toBe(true);
    expect(isUploadImageMime("image/svg+xml")).toBe(false);
  });

  it("accepts a small png", () => {
    expect(() => assertAllowedArtifact(new Uint8Array(10), "image/png")).not.toThrow();
  });

  it("rejects a disallowed mime", () => {
    expect(() => assertAllowedArtifact(new Uint8Array(10), "application/pdf")).toThrow(
      ArtifactRejectedError,
    );
  });

  it("rejects an oversized artifact", () => {
    expect(() =>
      assertAllowedArtifact(new Uint8Array(MAX_ASSET_BYTES + 1), "image/png"),
    ).toThrow(ArtifactRejectedError);
  });
});
