// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { en } from "@/lib/i18n/dictionaries/en";
import * as landingOg from "@/app/opengraph-image";
import * as landingX from "@/app/twitter-image";
import * as pricingOg from "@/app/pricing/opengraph-image";
import * as pricingX from "@/app/pricing/twitter-image";

/** Width and height from a PNG's IHDR chunk. */
function pngSize(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

describe("share images", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("declare 1200×630 PNGs with alt text, the same on Open Graph and X", () => {
    for (const [og, x] of [
      [landingOg, landingX],
      [pricingOg, pricingX],
    ] as const) {
      expect(og.size).toEqual({ width: 1200, height: 630 });
      expect(og.contentType).toBe("image/png");
      expect(og.alt.length).toBeGreaterThan(20);
      expect({ alt: x.alt, size: x.size, contentType: x.contentType }).toEqual({
        alt: og.alt,
        size: og.size,
        contentType: og.contentType,
      });
    }
    expect(landingOg.alt).toContain(en.landing.hero.titleLine1);
  });

  it("render even when the serif cannot be fetched (offline build)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new Error("offline"))));
    for (const Image of [landingOg.default, pricingOg.default]) {
      const res = await Image();
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe("image/png");
      const bytes = new Uint8Array(await res.arrayBuffer());
      expect(Array.from(bytes.slice(1, 4), (b) => String.fromCharCode(b)).join("")).toBe("PNG");
      expect(pngSize(bytes)).toEqual({ width: 1200, height: 630 });
    }
  }, 30_000);
});
