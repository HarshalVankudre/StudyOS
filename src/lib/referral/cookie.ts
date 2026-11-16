/**
 * The invite cookie (server-only): `<code>.<issued-at, base 36 ms>.<HMAC>`.
 *
 * The HMAC (SHA-256, base64url) is keyed by lib/ops/secret.ts
 * derivedServerKey("referral-cookie:v1"): derived from CLERK_SECRET_KEY, the
 * one server secret every deployment of the app must have (lib/ops/env.ts),
 * under its own label so it can never stand in for anything Clerk signs.
 * Without that secret no cookie is issued or accepted. Rotating the Clerk key
 * invalidates invites in flight, which is harmless.
 *
 * The cookie itself is httpOnly, SameSite=Lax and first-party on the app's
 * origin; it lives REFERRAL_COOKIE_MAX_AGE_S, and a value older than that is
 * refused even if a browser kept it. In production it is named with the
 * `__Host-` prefix (Secure, Path=/, no Domain: a sibling subdomain can
 * neither plant nor overwrite it); in development, on plain http, it keeps
 * the bare name, which the browser would otherwise refuse to store.
 */
import "server-only";

import { createHmac } from "node:crypto";
import { derivedServerKey, secretsMatch } from "@/lib/ops/secret";
import {
  isReferralCodeShape,
  REFERRAL_COOKIE,
  REFERRAL_COOKIE_HOST,
  REFERRAL_COOKIE_MAX_AGE_S,
  referralsEnabled,
} from "./config";

type Env = Record<string, string | undefined>;

/** derivedServerKey's label: the same key the code before it derived by hand. */
const KEY_LABEL = "referral-cookie:v1";
/** A cookie stamped further in the future than this is not ours. */
const CLOCK_SKEW_MS = 5 * 60 * 1000;
const SIGNATURE_SHAPE = /^[A-Za-z0-9_-]{43}$/;
const ISSUED_SHAPE = /^[0-9a-z]{1,12}$/;

/** The signing key, or null when the server secret is missing. */
export function referralCookieKey(env: Env = process.env): Buffer | null {
  return derivedServerKey(KEY_LABEL, env);
}

function signature(key: Buffer, payload: string): string {
  return createHmac("sha256", key).update(payload).digest("base64url");
}

/** The cookie value for `code`, issued at `issuedAt`. */
export function signReferralCookie(code: string, issuedAt: Date, key: Buffer): string {
  const payload = `${code}.${issuedAt.getTime().toString(36)}`;
  return `${payload}.${signature(key, payload)}`;
}

export type ReferralCookie =
  | { ok: true; code: string; issuedAt: Date }
  /** Signed by us but older than the cookie's lifetime. */
  | { ok: false; reason: "expired"; code: string; issuedAt: Date }
  /** Shaped like ours, but the signature does not match (forged, or the key changed). */
  | { ok: false; reason: "bad_signature"; code: string }
  /** Not a cookie we could have written. */
  | { ok: false; reason: "malformed" };

/** Check a cookie value: shape, signature (constant time), then age. */
export function verifyReferralCookie(value: string | undefined | null, now: Date, key: Buffer): ReferralCookie {
  if (typeof value !== "string" || value.length > 128) return { ok: false, reason: "malformed" };
  const parts = value.split(".");
  if (parts.length !== 3) return { ok: false, reason: "malformed" };
  const [code, issued, sig] = parts;
  if (!isReferralCodeShape(code) || !ISSUED_SHAPE.test(issued) || !SIGNATURE_SHAPE.test(sig)) {
    return { ok: false, reason: "malformed" };
  }
  if (!secretsMatch(sig, signature(key, `${code}.${issued}`))) return { ok: false, reason: "bad_signature", code };
  const issuedAt = new Date(parseInt(issued, 36));
  const age = now.getTime() - issuedAt.getTime();
  if (!Number.isFinite(age) || age < -CLOCK_SKEW_MS) return { ok: false, reason: "malformed" };
  if (age > REFERRAL_COOKIE_MAX_AGE_S * 1000) return { ok: false, reason: "expired", code, issuedAt };
  return { ok: true, code, issuedAt };
}

const isProduction = (env: Env) => env.NODE_ENV === "production";

/** The cookie's name here: `__Host-studyos_ref` in production, `studyos_ref` in development. */
export function referralCookieName(env: Env = process.env): string {
  return isProduction(env) ? REFERRAL_COOKIE_HOST : REFERRAL_COOKIE;
}

/** Set-cookie options of the invite cookie (also used to clear it). */
export function referralCookieOptions(env: Env = process.env) {
  return {
    name: referralCookieName(env),
    httpOnly: true,
    sameSite: "lax" as const,
    // Required by the __Host- prefix, so always on where the prefix is.
    secure: isProduction(env),
    path: "/",
    maxAge: REFERRAL_COOKIE_MAX_AGE_S,
  };
}

/**
 * The invite cookie's value in a raw `Cookie` request header (a route
 * handler that reads the Request directly), or null.
 */
export function referralCookieFromHeader(header: string | null | undefined, env: Env = process.env): string | null {
  if (!header) return null;
  const name = referralCookieName(env);
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0 || part.slice(0, eq).trim() !== name) continue;
    const raw = part.slice(eq + 1).trim();
    try {
      return decodeURIComponent(raw) || null;
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * The invite a signed-out visitor carries, for the sign-up page's "You were
 * invited" line: only a valid, unexpired cookie counts (no database read),
 * and none while the program is paused.
 */
export function hasValidReferralCookie(value: string | undefined, now = new Date()): boolean {
  if (!referralsEnabled()) return false;
  const key = referralCookieKey();
  if (!key || !value) return false;
  return verifyReferralCookie(value, now, key).ok;
}
