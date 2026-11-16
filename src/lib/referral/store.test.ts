// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { createFakeDb } from "@/test/billing-fakes";

const h = vi.hoisted(() => ({ db: null as unknown as ReturnType<typeof createFakeDb> }));
vi.mock("@/lib/db", async () => {
  const { createFakeDb } = await import("@/test/billing-fakes");
  h.db = createFakeDb();
  return { prisma: h.db.db };
});

import { REFERRAL_MAX_PER_DAY, REFERRAL_MAX_REWARDS } from "@/lib/price-list";
import {
  isReferralCodeShape,
  normalizeReferralCode,
  REFERRAL_CODE_ALPHABET,
  REFERRAL_CODE_LENGTH,
  referralPath,
} from "./config";
import { findReferralCode, getOrCreateReferralCode, newReferralCode, referralSummary } from "./store";

beforeEach(() => h.db.reset());

describe("codes", () => {
  it("are 8 characters of an alphabet with nothing to misread", () => {
    expect(REFERRAL_CODE_LENGTH).toBe(8);
    for (const ambiguous of ["0", "O", "1", "I", "L"]) expect(REFERRAL_CODE_ALPHABET).not.toContain(ambiguous);
    const seen = new Set<string>();
    for (let i = 0; i < 500; i++) {
      const code = newReferralCode();
      expect(code).toMatch(/^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{8}$/);
      expect(isReferralCodeShape(code)).toBe(true);
      seen.add(code);
    }
    // Random, not a counter: 500 draws from 31^8 never repeat in practice.
    expect(seen.size).toBe(500);
    // Every character of the alphabet turns up.
    expect(new Set([...seen].join("")).size).toBe(REFERRAL_CODE_ALPHABET.length);
  });

  it("accept 8 to 10 characters, typed in any case; anything else is not a code", () => {
    expect(normalizeReferralCode(" k7mpq2xr ")).toBe("K7MPQ2XR");
    expect(normalizeReferralCode("K7MPQ2XRAB")).toBe("K7MPQ2XRAB");
    for (const bad of ["K7MPQ2X", "K7MPQ2XRABC", "K7MPQ2X0", "K7MP-2XR", "../../app", "", null, 42, "x".repeat(40)]) {
      expect(normalizeReferralCode(bad), String(bad)).toBeNull();
    }
    expect(referralPath("K7MPQ2XR")).toBe("/r/K7MPQ2XR");
  });

  it("are made once per student, on first use", async () => {
    const first = await getOrCreateReferralCode("user_a");
    expect(await getOrCreateReferralCode("user_a")).toBe(first);
    expect(await findReferralCode(first)).toEqual(expect.objectContaining({ userId: "user_a", code: first }));
    expect(await findReferralCode("ZZZZZZZZ")).toBeNull();
  });

  it("a parallel first open finds one code; a code someone else holds is drawn again", async () => {
    const codes = await Promise.all(Array.from({ length: 5 }, () => getOrCreateReferralCode("user_a")));
    expect(new Set(codes).size).toBe(1);

    const draws = ["AAAAAAAA", "AAAAAAAA", "BBBBBBBB"];
    await getOrCreateReferralCode("user_b", () => draws.shift()!);
    expect(await getOrCreateReferralCode("user_c", () => draws.shift()!)).toBe("BBBBBBBB");
  });
});

describe("what the invite card shows", () => {
  const ledger = (userId: string, reason: string, delta: number, createdAt = new Date()) =>
    h.db.db.creditLedger.create({ data: { userId, reason, delta, createdAt } });
  const referral = (refereeId: string, status: string) =>
    h.db.db.referral.create({ data: { referrerId: "user_a", refereeId, code: "AAAAAAAA", status } });

  it("counts friends who joined and were rewarded, and the credits invites earned", async () => {
    await referral("f1", "pending");
    await referral("f2", "rewarded");
    await referral("f3", "rewarded");
    await referral("f4", "rejected");
    await ledger("user_a", "referral_referrer", 100);
    await ledger("user_a", "referral_referrer", 100);
    await ledger("user_a", "referral_referee", 100); // invited by someone else
    await ledger("user_a", "free_signup", 300);
    const summary = await referralSummary("user_a");
    expect(summary).toMatchObject({ joined: 3, rewarded: 2, creditsEarned: 300, capReached: false, dailyCapReached: false });
    expect(isReferralCodeShape(summary.code)).toBe(true);
  });

  it("says when the total cap, or today's cap, is reached", async () => {
    const now = new Date("2026-11-15T12:00:00Z");
    const daysAgo = (d: number) => new Date(now.getTime() - d * 24 * 60 * 60 * 1000);
    for (let i = 0; i < REFERRAL_MAX_PER_DAY; i++) await ledger("user_a", "referral_referrer", 100, daysAgo(0.1));
    expect(await referralSummary("user_a", now)).toMatchObject({ capReached: false, dailyCapReached: true });
    // A day later, today's cap is free again.
    expect(await referralSummary("user_a", daysAgo(-1))).toMatchObject({ dailyCapReached: false });
    for (let i = REFERRAL_MAX_PER_DAY; i < REFERRAL_MAX_REWARDS; i++) {
      await ledger("user_a", "referral_referrer", 100, daysAgo(2 + i));
    }
    expect(await referralSummary("user_a", now)).toMatchObject({ capReached: true, dailyCapReached: false });
  });
});
