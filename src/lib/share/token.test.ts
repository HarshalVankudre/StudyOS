// @vitest-environment node
import { describe, expect, it } from "vitest";
import { isAssetIdShape, isShareTokenShape, newShareToken, SHARE_TOKEN_BYTES, SHARE_TOKEN_LENGTH } from "./token";

describe("share tokens", () => {
  it("carry at least 128 random bits, base64url without padding", () => {
    expect(SHARE_TOKEN_BYTES * 8).toBeGreaterThanOrEqual(128);
    const token = newShareToken();
    expect(token).toHaveLength(SHARE_TOKEN_LENGTH);
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(Buffer.from(token, "base64url")).toHaveLength(SHARE_TOKEN_BYTES);
  });

  it("are never the same twice", () => {
    const tokens = new Set(Array.from({ length: 1000 }, newShareToken));
    expect(tokens.size).toBe(1000);
  });

  it("are recognised by shape before any lookup", () => {
    expect(isShareTokenShape(newShareToken())).toBe(true);
    for (const bad of ["", "short", `${newShareToken()}x`, "AbCdEfGhIjKlMnOpQrStUvWxYz01234=", "../../etc/passwd/aaaaaaaaaaaaaaaaa", null, 42]) {
      expect(isShareTokenShape(bad), String(bad)).toBe(false);
    }
  });

  it("asset ids have the asset route's shape", () => {
    expect(isAssetIdShape("0b8f4d1e-1111-4222-8333-944455556666")).toBe(true);
    expect(isAssetIdShape("a/b")).toBe(false);
    expect(isAssetIdShape("x".repeat(129))).toBe(false);
  });
});
