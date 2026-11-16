// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { createFakeDb } from "@/test/billing-fakes";

const h = vi.hoisted(() => ({ db: null as unknown as ReturnType<typeof createFakeDb> }));
vi.mock("@/lib/db", async () => {
  const { createFakeDb } = await import("@/test/billing-fakes");
  h.db = createFakeDb();
  return { prisma: h.db.db };
});

import { attributeReferral } from "./attribution";
import { referralCookieKey, signReferralCookie } from "./cookie";

const KEY = referralCookieKey({ CLERK_SECRET_KEY: "sk_test_attr" })!;
const CODE = "K7MPQ2XR";
const T0 = new Date("2026-11-15T12:00:00Z");
const MIN = 60 * 1000;
const DAY = 24 * 60 * MIN;
const at = (ms: number) => new Date(T0.getTime() + ms);

/** The friend opened the link at T0; their account was made `madeAfter` later. */
async function friendAccount(userId: string, madeAfter: number) {
  await h.db.db.creditAccount.create({ data: { userId, balance: 300, createdAt: at(madeAfter) } });
}
const cookie = (issuedAt = T0, key = KEY, code = CODE) => signReferralCookie(code, issuedAt, key);
const rows = () => h.db.db.referral.findMany({});

beforeEach(async () => {
  h.db.reset();
  await h.db.db.referralCode.create({ data: { userId: "inviter", code: CODE } });
  await h.db.db.creditAccount.create({ data: { userId: "inviter", balance: 300, createdAt: at(-30 * DAY) } });
});

describe("a new account that came through an invite link", () => {
  it("is recorded as pending, naming the inviter", async () => {
    await friendAccount("friend", 5 * MIN);
    const outcome = await attributeReferral("friend", cookie(), { now: at(6 * MIN), key: KEY });
    expect(outcome).toEqual({ kind: "pending", referrerId: "inviter" });
    expect(await rows()).toEqual([
      expect.objectContaining({ referrerId: "inviter", refereeId: "friend", code: CODE, status: "pending", rejectReason: null }),
    ]);
  });

  it("whose CreditAccount is not made yet (this request is its first sight) is new too", async () => {
    expect(await attributeReferral("friend", cookie(), { now: at(MIN), key: KEY })).toMatchObject({ kind: "pending" });
  });

  it("is attributed once, however many requests race", async () => {
    await friendAccount("friend", MIN);
    const outcomes = await Promise.all(
      Array.from({ length: 6 }, () => attributeReferral("friend", cookie(), { now: at(2 * MIN), key: KEY })),
    );
    expect(outcomes.filter((o) => o.kind === "pending")).toHaveLength(1);
    expect(outcomes.filter((o) => o.kind === "skipped")).toHaveLength(5);
    expect(await rows()).toHaveLength(1);
  });
});

describe("rejected (recorded, never rewarded)", () => {
  const rejected = async (reason: string) =>
    expect(await rows()).toEqual([expect.objectContaining({ status: "rejected", rejectReason: reason })]);

  it("the inviter opening their own link", async () => {
    expect(await attributeReferral("inviter", cookie(), { now: at(MIN), key: KEY })).toMatchObject({
      kind: "rejected",
      reason: "self_referral",
    });
    await rejected("self_referral");
  });

  it("an inviter whose account is deleted", async () => {
    await h.db.db.deletedAccount.create({ data: { userId: "inviter" } });
    await friendAccount("friend", MIN);
    expect(await attributeReferral("friend", cookie(), { now: at(2 * MIN), key: KEY })).toMatchObject({
      reason: "referrer_deleted",
    });
    await rejected("referrer_deleted");
  });

  it("an account that existed before the link was opened (an existing student signing in)", async () => {
    await friendAccount("friend", -10 * DAY);
    expect(await attributeReferral("friend", cookie(), { now: at(MIN), key: KEY })).toMatchObject({
      reason: "account_not_new",
    });
    await rejected("account_not_new");
  });

  it("allows two minutes of clock skew between the cookie (an app server) and the account (the database)", async () => {
    await friendAccount("friend", -90 * 1000);
    expect(await attributeReferral("friend", cookie(), { now: at(MIN), key: KEY })).toMatchObject({ kind: "pending" });
    await h.db.db.referral.deleteMany({});
    await friendAccount("other", -3 * MIN);
    expect(await attributeReferral("other", cookie(), { now: at(MIN), key: KEY })).toMatchObject({
      reason: "account_not_new",
    });
  });

  it("an account more than a day old by the time it is attributed", async () => {
    await friendAccount("friend", MIN);
    expect(await attributeReferral("friend", cookie(), { now: at(DAY + 2 * MIN), key: KEY })).toMatchObject({
      reason: "account_not_new",
    });
  });

  it("a cookie older than 30 days", async () => {
    await friendAccount("friend", 31 * DAY);
    expect(await attributeReferral("friend", cookie(), { now: at(31 * DAY + MIN), key: KEY })).toMatchObject({
      reason: "cookie_expired",
    });
    await rejected("cookie_expired");
  });

  it("a cookie with a bad signature", async () => {
    await friendAccount("friend", MIN);
    const other = referralCookieKey({ CLERK_SECRET_KEY: "sk_test_forged" })!;
    expect(await attributeReferral("friend", cookie(T0, other), { now: at(2 * MIN), key: KEY })).toMatchObject({
      reason: "bad_signature",
    });
    await rejected("bad_signature");
  });
});

describe("nothing recorded", () => {
  it("for a cookie we could not have written, or an unknown code", async () => {
    await friendAccount("friend", MIN);
    for (const value of ["", "garbage", "K7MPQ2XR.zz.short"]) {
      expect(await attributeReferral("friend", value, { now: at(2 * MIN), key: KEY })).toEqual({
        kind: "skipped",
        why: "malformed",
      });
    }
    expect(await attributeReferral("friend", cookie(T0, KEY, "ZZZZZZZZ"), { now: at(2 * MIN), key: KEY })).toEqual({
      kind: "skipped",
      why: "unknown_code",
    });
    expect(await rows()).toEqual([]);
  });

  it("for a friend already attributed (to anyone), or deleted", async () => {
    await h.db.db.referral.create({ data: { referrerId: "someone", refereeId: "friend", code: "AAAAAAAA" } });
    expect(await attributeReferral("friend", cookie(), { now: at(MIN), key: KEY })).toEqual({
      kind: "skipped",
      why: "already_attributed",
    });
    await h.db.db.deletedAccount.create({ data: { userId: "gone" } });
    expect(await attributeReferral("gone", cookie(), { now: at(MIN), key: KEY })).toMatchObject({ why: "deleted_account" });
    expect(await rows()).toHaveLength(1);
  });

  it("without the server secret (no cookie can be trusted)", async () => {
    expect(await attributeReferral("friend", cookie(), { now: at(MIN), key: null })).toEqual({
      kind: "skipped",
      why: "no_key",
    });
  });

  it("while the program is paused (STUDYOS_REFERRALS=off)", async () => {
    vi.stubEnv("STUDYOS_REFERRALS", "off");
    try {
      await friendAccount("friend", MIN);
      expect(await attributeReferral("friend", cookie(), { now: at(2 * MIN), key: KEY })).toEqual({
        kind: "skipped",
        why: "paused",
      });
      expect(await rows()).toEqual([]);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
