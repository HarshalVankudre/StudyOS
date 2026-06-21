import { describe, expect, it } from "vitest";
import { mediaImgSrc } from "./PageView";

describe("media block image source", () => {
  it("points at the authenticated asset route, never a raw URL", () => {
    expect(mediaImgSrc("a1")).toBe("/api/asset/a1");
  });
});
