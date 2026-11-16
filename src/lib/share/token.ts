/**
 * Share-link tokens. The token in /s/<token> is the only credential a
 * visitor has, so it is 24 random bytes (192 bits) from the OS CSPRNG,
 * base64url without padding: 32 characters of [A-Za-z0-9_-].
 */
import { randomBytes } from "node:crypto";

export const SHARE_TOKEN_BYTES = 24;
export const SHARE_TOKEN_LENGTH = 32;

const TOKEN_SHAPE = /^[A-Za-z0-9_-]{32}$/;

export function newShareToken(): string {
  return randomBytes(SHARE_TOKEN_BYTES).toString("base64url");
}

/** True for a string that could be a token; anything else is refused before any lookup. */
export function isShareTokenShape(value: unknown): value is string {
  return typeof value === "string" && TOKEN_SHAPE.test(value);
}

const ASSET_ID_SHAPE = /^[A-Za-z0-9_-]{1,128}$/;

/** True for a string that could be an asset id (the same shape the asset route accepts). */
export function isAssetIdShape(value: unknown): value is string {
  return typeof value === "string" && ASSET_ID_SHAPE.test(value);
}
