import { describe, expect, it } from "vitest";
import { blockSchema } from "@/lib/workspace/schema";

describe("media block", () => {
  const valid = {
    id: "b1",
    type: "media",
    assetId: "a1",
    mediaKind: "image",
    mime: "image/png",
    caption: "Quadratic formula",
    alt: "x equals minus b ...",
  };

  it("accepts a valid media block", () => {
    expect(blockSchema.safeParse(valid).success).toBe(true);
  });

  it("strips unknown keys (no signed URLs smuggled into the model)", () => {
    const parsed = blockSchema.parse({ ...valid, signedUrl: "https://evil" });
    expect("signedUrl" in parsed).toBe(false);
  });

  it("rejects a non-image mediaKind and a missing assetId", () => {
    expect(blockSchema.safeParse({ ...valid, mediaKind: "pdf" }).success).toBe(false);
    const { assetId: _drop, ...noAsset } = valid;
    expect(blockSchema.safeParse(noAsset).success).toBe(false);
  });
});
