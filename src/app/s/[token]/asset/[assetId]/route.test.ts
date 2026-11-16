// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ image: vi.fn(), report: vi.fn() }));

vi.mock("@/lib/share/asset", () => ({ sharedAssetImage: m.image }));
vi.mock("@/lib/ops/report-error", () => ({ reportError: m.report }));
vi.mock("@/lib/assets/storage", () => ({ gcsAssetStore: () => ({}) }));
vi.mock("@/lib/assets/repo", () => ({ prismaAssetRepo: () => ({}) }));

import { SHARE_ASSET_REQUESTS_PER_WINDOW } from "@/lib/share/throttle";
import { GET } from "./route";

const TOKEN = "AbCdEfGhIjKlMnOpQrStUvWxYz012345";
const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
let ip = 0;
let address = "";
const call = (assetId: string, from = address) =>
  GET(new Request(`https://app.example.com/s/${TOKEN}/asset/${assetId}`, { headers: { "x-forwarded-for": from } }), {
    params: Promise.resolve({ token: TOKEN, assetId }),
  });

beforeEach(() => {
  vi.stubEnv("ASSETS_BUCKET", "studyos-assets");
  // Each test from its own address (the throttle lives for the whole file).
  address = `198.51.100.${++ip}`;
  m.image.mockReset().mockResolvedValue({ bytes: PNG, mime: "image/png" });
  m.report.mockReset();
});
afterEach(() => vi.unstubAllEnvs());

describe("GET /s/<token>/asset/<assetId>", () => {
  it("sends the image's bytes itself, never a storage URL, as an inert image that is never cached", async () => {
    const res = await call("asset_block");
    expect(res.status).toBe(200);
    expect(res.headers.get("location")).toBeNull();
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(PNG);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("content-length")).toBe(String(PNG.byteLength));
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("content-security-policy")).toBe("sandbox; default-src 'none'");
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(res.headers.get("content-disposition")).toBe("inline");
    expect(res.headers.get("x-robots-tag")).toBe("noindex");
    expect(m.image).toHaveBeenCalledWith(TOKEN, "asset_block", expect.anything());
  });

  it("is a 404 for any asset the shared page does not show (or a type that is not an image)", async () => {
    m.image.mockResolvedValue(null);
    const res = await call("asset_private");
    expect(res.status).toBe(404);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("is a 404, reported, when storage fails", async () => {
    m.image.mockRejectedValue(new Error("storage down"));
    expect((await call("asset_block")).status).toBe(404);
    expect(m.report).toHaveBeenCalledTimes(1);
  });

  it("serves nothing without an assets bucket", async () => {
    vi.stubEnv("ASSETS_BUCKET", "");
    expect((await call("asset_block")).status).toBe(404);
    expect(m.image).not.toHaveBeenCalled();
  });

  it(`answers 429 past ${SHARE_ASSET_REQUESTS_PER_WINDOW} requests from one address, an IPv6 client by its /64`, async () => {
    for (let i = 0; i < SHARE_ASSET_REQUESTS_PER_WINDOW; i += 1) {
      // Every address of one /64 counts together.
      const res = await call("asset_block", `2001:db8:77:1::${(i % 500).toString(16)}`);
      expect(res.status).toBe(200);
    }
    const refused = await call("asset_block", "2001:db8:77:1:ffff::1");
    expect(refused.status).toBe(429);
    expect(refused.headers.get("retry-after")).toBeTruthy();
    expect((await call("asset_block", "2001:db8:77:2::1")).status).toBe(200);
  });
});
