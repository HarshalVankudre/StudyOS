// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  attributeReferral: vi.fn(),
  reportError: vi.fn(),
  jar: new Map<string, string>(),
  deleted: [] as unknown[],
}));
vi.mock("@clerk/nextjs/server", () => ({ auth: mocks.auth }));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (mocks.jar.has(name) ? { name, value: mocks.jar.get(name) } : undefined),
    delete: (opts: { name: string }) => {
      mocks.deleted.push(opts);
      mocks.jar.delete(opts.name);
    },
  }),
}));
vi.mock("@/lib/referral/attribution", () => ({ attributeReferral: mocks.attributeReferral }));
vi.mock("@/lib/ops/report-error", () => ({ reportError: mocks.reportError }));

import { claimReferralAction } from "./referral-actions";

beforeEach(() => {
  mocks.jar.clear();
  mocks.deleted.length = 0;
  mocks.auth.mockResolvedValue({ userId: "friend" });
  mocks.attributeReferral.mockResolvedValue({ kind: "pending", referrerId: "inviter" });
});

describe("claimReferralAction (the first signed-in /app request after sign-up)", () => {
  it("attributes the signed-in student to the invite cookie, then clears it", async () => {
    mocks.jar.set("studyos_ref", "K7MPQ2XR.abc.sig");
    await claimReferralAction();
    expect(mocks.attributeReferral).toHaveBeenCalledWith("friend", "K7MPQ2XR.abc.sig");
    expect(mocks.jar.has("studyos_ref")).toBe(false);
    expect(mocks.deleted).toEqual([expect.objectContaining({ name: "studyos_ref", path: "/", httpOnly: true, sameSite: "lax" })]);
  });

  it("clears a cookie that was refused too (rejected or unreadable: it will never count)", async () => {
    mocks.jar.set("studyos_ref", "garbage");
    mocks.attributeReferral.mockResolvedValue({ kind: "skipped", why: "malformed" });
    await claimReferralAction();
    expect(mocks.jar.has("studyos_ref")).toBe(false);
  });

  it("keeps the cookie when the database fails, so the next visit tries again", async () => {
    mocks.jar.set("studyos_ref", "K7MPQ2XR.abc.sig");
    mocks.attributeReferral.mockRejectedValue(new Error("db down"));
    await expect(claimReferralAction()).resolves.toBeUndefined();
    expect(mocks.jar.has("studyos_ref")).toBe(true);
    expect(mocks.reportError).toHaveBeenCalledTimes(1);
  });

  it("keeps the cookie while invites are paused, so the invite counts once they are back", async () => {
    mocks.jar.set("studyos_ref", "K7MPQ2XR.abc.sig");
    mocks.attributeReferral.mockResolvedValue({ kind: "skipped", why: "paused" });
    await claimReferralAction();
    expect(mocks.jar.has("studyos_ref")).toBe(true);
    expect(mocks.deleted).toEqual([]);
  });

  it("in production, reads and clears the __Host- cookie (Secure, Path=/), never the bare name", async () => {
    vi.stubEnv("NODE_ENV", "production");
    try {
      mocks.jar.set("studyos_ref", "planted.by.a-subdomain");
      mocks.jar.set("__Host-studyos_ref", "K7MPQ2XR.abc.sig");
      await claimReferralAction();
      expect(mocks.attributeReferral).toHaveBeenCalledWith("friend", "K7MPQ2XR.abc.sig");
      expect(mocks.deleted).toEqual([expect.objectContaining({ name: "__Host-studyos_ref", path: "/", secure: true })]);
      expect(mocks.jar.has("studyos_ref")).toBe(true);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("does nothing without a cookie or a session", async () => {
    await claimReferralAction();
    mocks.auth.mockResolvedValue({ userId: null });
    mocks.jar.set("studyos_ref", "K7MPQ2XR.abc.sig");
    await claimReferralAction();
    expect(mocks.attributeReferral).not.toHaveBeenCalled();
    expect(mocks.jar.has("studyos_ref")).toBe(true);
  });
});
