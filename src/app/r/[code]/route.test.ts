// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  findReferralCode: vi.fn(),
  reportError: vi.fn(),
}));
vi.mock("@clerk/nextjs/server", () => ({ auth: mocks.auth }));
vi.mock("@/lib/referral/store", () => ({ findReferralCode: mocks.findReferralCode }));
vi.mock("@/lib/ops/report-error", () => ({ reportError: mocks.reportError }));

import { GET } from "./route";
import { REFERRAL_COOKIE_HOST } from "@/lib/referral/config";
import { referralCookieKey, verifyReferralCookie } from "@/lib/referral/cookie";
import { REFERRAL_VISITS_PER_WINDOW } from "@/lib/referral/visit";

let address = 0;
/** Each test visits from its own address, so the per-address throttle never carries over. */
let ip = "";
const visit = (code: string, from = ip) =>
  GET(new Request(`http://localhost:3000/r/${code}`, { headers: { "x-forwarded-for": from } }), {
    params: Promise.resolve({ code }),
  });
const setCookie = (res: Response) => res.headers.get("set-cookie") ?? "";

beforeEach(() => {
  ip = `203.0.113.${++address}`;
  vi.stubEnv("CLERK_SECRET_KEY", "sk_test_route");
  vi.stubEnv("NODE_ENV", "production");
  mocks.auth.mockResolvedValue({ userId: null });
  mocks.findReferralCode.mockImplementation(async (code: string) =>
    code === "K7MPQ2XR" ? { userId: "inviter", code } : null,
  );
});
afterEach(() => vi.unstubAllEnvs());

describe("GET /r/<code>", () => {
  it("a valid code: remembers the invite in a signed, __Host-, httpOnly, Lax, Secure cookie for 30 days, then sign-up", async () => {
    const res = await visit("K7MPQ2XR");
    expect(res.status).toBe(307);
    // Relative, so it resolves against the public address behind a proxy.
    expect(res.headers.get("location")).toBe("/sign-up");
    expect(res.headers.get("cache-control")).toBe("no-store");
    const cookie = setCookie(res);
    expect(cookie).toMatch(new RegExp(`^${REFERRAL_COOKIE_HOST}=`));
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=lax/i);
    expect(cookie).toMatch(/Secure/i);
    expect(cookie).toMatch(/Path=\//);
    // The __Host- prefix forbids a Domain attribute.
    expect(cookie).not.toMatch(/Domain=/i);
    expect(cookie).toMatch(/Max-Age=2592000/);
    const value = decodeURIComponent(cookie.split(";")[0].slice(REFERRAL_COOKIE_HOST.length + 1));
    const key = referralCookieKey({ CLERK_SECRET_KEY: "sk_test_route" })!;
    expect(verifyReferralCookie(value, new Date(), key)).toMatchObject({ ok: true, code: "K7MPQ2XR" });
  });

  it("accepts the code typed in lower case", async () => {
    const res = await visit("k7mpq2xr");
    expect(res.headers.get("location")).toBe("/sign-up");
    expect(mocks.findReferralCode).toHaveBeenCalledWith("K7MPQ2XR");
  });

  it("an unknown code, or anything that is not a code: to the landing page, silently, with no cookie", async () => {
    for (const code of ["ZZZZZZZZ", "not-a-code", "K7MPQ2X0", "a".repeat(40)]) {
      const res = await visit(code);
      expect(res.headers.get("location"), code).toBe("/");
      expect(setCookie(res), code).toBe("");
    }
    // Shapes that cannot be codes never reach the database.
    expect(mocks.findReferralCode).toHaveBeenCalledTimes(1);
  });

  it("already signed in: to the app, nothing recorded, no cookie", async () => {
    mocks.auth.mockResolvedValue({ userId: "someone" });
    const res = await visit("K7MPQ2XR");
    expect(res.headers.get("location")).toBe("/app");
    expect(setCookie(res)).toBe("");
    expect(mocks.findReferralCode).not.toHaveBeenCalled();
  });

  it("without the server secret, or when the database fails: sign-up still works, without the invite", async () => {
    vi.stubEnv("CLERK_SECRET_KEY", "");
    let res = await visit("K7MPQ2XR");
    expect(res.headers.get("location")).toBe("/sign-up");
    expect(setCookie(res)).toBe("");

    vi.stubEnv("CLERK_SECRET_KEY", "sk_test_route");
    mocks.findReferralCode.mockRejectedValue(new Error("db down"));
    res = await visit("K7MPQ2XR");
    expect(res.headers.get("location")).toBe("/sign-up");
    expect(setCookie(res)).toBe("");
    expect(mocks.reportError).toHaveBeenCalledTimes(1);
  });

  it("while invites are paused (STUDYOS_REFERRALS=off): to the landing page, with no cookie and no lookup", async () => {
    vi.stubEnv("STUDYOS_REFERRALS", "off");
    const res = await visit("K7MPQ2XR");
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("/");
    expect(setCookie(res)).toBe("");
    expect(mocks.findReferralCode).not.toHaveBeenCalled();
  });

  it("is throttled per address", async () => {
    for (let i = 0; i < REFERRAL_VISITS_PER_WINDOW; i++) expect((await visit("ZZZZZZZZ")).status).toBe(307);
    const limited = await visit("K7MPQ2XR");
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBe("600");
    expect(setCookie(limited)).toBe("");
    // Another address is not affected.
    expect((await visit("K7MPQ2XR", "198.51.100.7")).status).toBe(307);
  });
});
