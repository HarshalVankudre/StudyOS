// @vitest-environment node
import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { REFERRAL_COOKIE, REFERRAL_COOKIE_HOST, REFERRAL_COOKIE_MAX_AGE_S } from "./config";
import {
  hasValidReferralCookie,
  referralCookieFromHeader,
  referralCookieKey,
  referralCookieName,
  referralCookieOptions,
  signReferralCookie,
  verifyReferralCookie,
} from "./cookie";

const KEY = referralCookieKey({ CLERK_SECRET_KEY: "sk_test_one" })!;
const OTHER = referralCookieKey({ CLERK_SECRET_KEY: "sk_test_two" })!;
const T0 = new Date("2026-11-15T12:00:00Z");
const DAY = 24 * 60 * 60 * 1000;
const later = (ms: number) => new Date(T0.getTime() + ms);

describe("the signing key", () => {
  it("is derived from the Clerk secret, and absent without it", () => {
    expect(KEY).toBeInstanceOf(Buffer);
    expect(KEY.equals(OTHER)).toBe(false);
    // Never the secret itself.
    expect(KEY.toString("utf8")).not.toContain("sk_test_one");
    expect(referralCookieKey({})).toBeNull();
    expect(referralCookieKey({ CLERK_SECRET_KEY: "  " })).toBeNull();
  });

  it("is lib/ops/secret's derived key, equal to the one derived by hand before (invites in flight stay valid)", () => {
    const before = createHmac("sha256", "sk_test_one").update("studyos:referral-cookie:v1").digest();
    expect(KEY.equals(before)).toBe(true);
  });
});

describe("signing and verifying", () => {
  it("round-trips the code and the time it was issued", () => {
    const value = signReferralCookie("K7MPQ2XR", T0, KEY);
    expect(value).toMatch(/^K7MPQ2XR\.[0-9a-z]+\.[A-Za-z0-9_-]{43}$/);
    expect(verifyReferralCookie(value, later(DAY), KEY)).toEqual({ ok: true, code: "K7MPQ2XR", issuedAt: T0 });
  });

  it("refuses a value signed with another key, or changed in any part", () => {
    const value = signReferralCookie("K7MPQ2XR", T0, KEY);
    expect(verifyReferralCookie(value, T0, OTHER)).toEqual({ ok: false, reason: "bad_signature", code: "K7MPQ2XR" });
    const [, issued, sig] = value.split(".");
    // Another code under the same signature (someone pasting their own code in).
    expect(verifyReferralCookie(`ABCDEFGH.${issued}.${sig}`, T0, KEY)).toMatchObject({ ok: false, reason: "bad_signature" });
    // A newer timestamp, to stretch the lifetime.
    const forged = `K7MPQ2XR.${later(10 * DAY).getTime().toString(36)}.${sig}`;
    expect(verifyReferralCookie(forged, later(35 * DAY), KEY)).toMatchObject({ ok: false, reason: "bad_signature" });
    const flipped = sig[0] === "A" ? `B${sig.slice(1)}` : `A${sig.slice(1)}`;
    expect(verifyReferralCookie(`K7MPQ2XR.${issued}.${flipped}`, T0, KEY)).toMatchObject({ ok: false, reason: "bad_signature" });
  });

  it("expires with the cookie's lifetime, even when a browser kept it", () => {
    const value = signReferralCookie("K7MPQ2XR", T0, KEY);
    const max = REFERRAL_COOKIE_MAX_AGE_S * 1000;
    expect(REFERRAL_COOKIE_MAX_AGE_S).toBe(30 * 24 * 60 * 60);
    expect(verifyReferralCookie(value, later(max), KEY).ok).toBe(true);
    expect(verifyReferralCookie(value, later(max + 1), KEY)).toEqual({
      ok: false,
      reason: "expired",
      code: "K7MPQ2XR",
      issuedAt: T0,
    });
  });

  it("refuses anything not shaped like ours before computing a signature", () => {
    const value = signReferralCookie("K7MPQ2XR", T0, KEY);
    for (const bad of [
      undefined,
      null,
      "",
      "K7MPQ2XR",
      "K7MPQ2XR.abc",
      `${value}.extra`,
      value.replace("K7MPQ2XR", "k7mpq2xr"),
      value.replace("K7MPQ2XR", "K7MPQ2X0"), // 0 is not in the alphabet
      `K7MPQ2XR.${"z".repeat(13)}.${value.split(".")[2]}`,
      "x".repeat(200),
    ]) {
      expect(verifyReferralCookie(bad, T0, KEY), String(bad)).toEqual({ ok: false, reason: "malformed" });
    }
  });

  it("refuses a value issued in the future (beyond a little clock skew)", () => {
    const value = signReferralCookie("K7MPQ2XR", later(DAY), KEY);
    expect(verifyReferralCookie(value, T0, KEY)).toEqual({ ok: false, reason: "malformed" });
    expect(verifyReferralCookie(signReferralCookie("K7MPQ2XR", later(60_000), KEY), T0, KEY).ok).toBe(true);
  });
});

describe("the cookie", () => {
  it("in production: __Host- prefixed, httpOnly, Lax, Secure, the whole app (Path=/, no Domain), for 30 days", () => {
    expect(referralCookieOptions({ NODE_ENV: "production" })).toEqual({
      name: "__Host-studyos_ref",
      httpOnly: true,
      sameSite: "lax",
      secure: true,
      path: "/",
      maxAge: REFERRAL_COOKIE_MAX_AGE_S,
    });
    expect(REFERRAL_COOKIE_HOST).toBe("__Host-studyos_ref");
    expect(referralCookieOptions({ NODE_ENV: "production" })).not.toHaveProperty("domain");
  });

  it("in development, on plain http: the bare name, not Secure (a browser would refuse a __Host- cookie there)", () => {
    expect(referralCookieOptions({ NODE_ENV: "development" })).toMatchObject({ name: REFERRAL_COOKIE, secure: false });
    expect(REFERRAL_COOKIE).toBe("studyos_ref");
    expect(referralCookieName({ NODE_ENV: "test" })).toBe("studyos_ref");
  });

  it("is read from a raw Cookie header by its name here", () => {
    const value = signReferralCookie("K7MPQ2XR", T0, KEY);
    const prod = { NODE_ENV: "production" };
    expect(referralCookieFromHeader(`a=1; __Host-studyos_ref=${value}; b=2`, prod)).toBe(value);
    // The bare name does not count in production (anyone could have set it), nor the reverse.
    expect(referralCookieFromHeader(`studyos_ref=${value}`, prod)).toBeNull();
    expect(referralCookieFromHeader(`__Host-studyos_ref=${value}`, { NODE_ENV: "development" })).toBeNull();
    expect(referralCookieFromHeader(`studyos_ref=${value}`, { NODE_ENV: "development" })).toBe(value);
    for (const header of [null, undefined, "", "studyos_ref=", "studyos_ref=%E0%A4%A"]) {
      expect(referralCookieFromHeader(header, { NODE_ENV: "development" }), String(header)).toBeNull();
    }
  });

  it("counts as an invite on the sign-up page only when valid, and never while invites are paused", () => {
    vi.stubEnv("CLERK_SECRET_KEY", "sk_test_one");
    try {
      expect(hasValidReferralCookie(signReferralCookie("K7MPQ2XR", T0, KEY), later(DAY))).toBe(true);
      expect(hasValidReferralCookie(signReferralCookie("K7MPQ2XR", T0, OTHER), later(DAY))).toBe(false);
      expect(hasValidReferralCookie(signReferralCookie("K7MPQ2XR", T0, KEY), later(31 * DAY))).toBe(false);
      expect(hasValidReferralCookie(undefined)).toBe(false);
      vi.stubEnv("STUDYOS_REFERRALS", "OFF");
      expect(hasValidReferralCookie(signReferralCookie("K7MPQ2XR", T0, KEY), later(DAY))).toBe(false);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
