import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { createFakeDb } from "@/test/billing-fakes";

const h = vi.hoisted(() => ({
  db: null as unknown as ReturnType<typeof createFakeDb>,
}));

vi.mock("@/lib/db", async () => {
  const { createFakeDb } = await import("@/test/billing-fakes");
  h.db = createFakeDb();
  return { prisma: h.db.db };
});

import {
  addMonthsUtc,
  chargeCredits,
  CREDIT_HOLD_TTL_MS,
  debitCredits,
  dueAllowanceMonths,
  FREE_MONTHLY_CREDITS,
  FREE_SIGNUP_CREDITS,
  getCreditBalance,
  grantCredits,
  hasCredits,
  releaseCreditHold,
  releaseExpiredHolds,
  reserveCredits,
  settleCreditHold,
  usageToCredits,
  withUserCreditLock,
} from "./credits";

const USER = "user_1";

async function seed(balance: number, status?: string) {
  await getCreditBalance(USER); // creates the account with the signup grant
  h.db.state.accounts.get(USER)!.balance = balance;
  if (status) {
    await h.db.db.subscription.upsert({
      where: { userId: USER },
      create: { userId: USER, status },
      update: { status },
    });
  }
}

beforeEach(() => {
  h.db.reset();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("monthly free refresh", () => {
  it("seeds new accounts with the signup grant", async () => {
    expect(await getCreditBalance(USER)).toBe(FREE_SIGNUP_CREDITS);
  });

  it("tops up a depleted free account once per month", async () => {
    await seed(10);
    expect(await getCreditBalance(USER)).toBe(10 + FREE_MONTHLY_CREDITS);
    expect(await getCreditBalance(USER)).toBe(10 + FREE_MONTHLY_CREDITS);
    expect(h.db.ledgerFor(USER).filter((l) => l.reason === "free_monthly")).toHaveLength(1);
  });

  it("does not refresh when the balance is healthy", async () => {
    await seed(FREE_MONTHLY_CREDITS);
    expect(await getCreditBalance(USER)).toBe(FREE_MONTHLY_CREDITS);
  });

  it("does not refresh active Pro subscribers (paid allowances cover them)", async () => {
    await seed(5, "active");
    expect(await getCreditBalance(USER)).toBe(5);
  });
});

describe("chargeCredits / debitCredits (atomic)", () => {
  it("charges what it can and floors at zero", async () => {
    await seed(30);
    expect(await chargeCredits(USER, 50, "agent")).toBe(30);
    expect(h.db.balance(USER)).toBe(0);
    expect(await chargeCredits(USER, 5, "agent")).toBe(0);
    expect(h.db.balance(USER)).toBe(0);
  });

  it("locks the account row for the read-decide-write", async () => {
    await seed(30);
    const spy = vi.spyOn(h.db.db, "$queryRaw");
    await chargeCredits(USER, 10, "agent");
    const sql = spy.mock.calls[0][0] as TemplateStringsArray;
    expect(sql.join("?")).toMatch(/FOR UPDATE/);
  });

  // Concurrency against real Postgres row locks: see credits.db.test.ts.

  it("a keyed debit is idempotent and records even a zero debit", async () => {
    await seed(0);
    expect(await debitCredits(USER, 40, "credit_reversal", "k1")).toBe(0);
    await grantCredits(USER, 100, "test");
    expect(await debitCredits(USER, 40, "credit_reversal", "k1")).toBe(0);
    expect(h.db.balance(USER)).toBe(100);
  });

  it("never creates an account", async () => {
    expect(await debitCredits("nobody", 10, "credit_reversal", "k")).toBe(0);
    expect(h.db.state.accounts.has("nobody")).toBe(false);
  });

  it("rolls back the ledger row when the balance update fails", async () => {
    await seed(50);
    const before = h.db.state.ledger.length;
    const spy = vi.spyOn(h.db.db.creditAccount, "update").mockImplementationOnce(() => {
      throw new Error("db down");
    });
    await expect(chargeCredits(USER, 10, "agent")).rejects.toThrow("db down");
    expect(h.db.state.ledger.length).toBe(before);
    expect(h.db.balance(USER)).toBe(50);
    spy.mockRestore();
  });
});

describe("annual allowance schedule", () => {
  const d = (s: string) => new Date(s);

  it("adds months in UTC, clamping to the month's last day without drifting", () => {
    const jan31 = d("2026-01-31T12:00:00Z");
    expect(addMonthsUtc(jan31, 1).toISOString()).toBe("2026-02-28T12:00:00.000Z");
    expect(addMonthsUtc(jan31, 2).toISOString()).toBe("2026-03-31T12:00:00.000Z");
    expect(addMonthsUtc(d("2027-12-15T00:00:00Z"), 2).toISOString()).toBe("2028-02-15T00:00:00.000Z");
    expect(addMonthsUtc(d("2027-01-31T00:00:00Z"), 13).toISOString()).toBe("2028-02-29T00:00:00.000Z");
  });

  it("yields months 1..11 across an annual period, none for a monthly one", () => {
    const start = d("2026-03-10T00:00:00Z");
    expect(dueAllowanceMonths(start, d("2027-03-10T00:00:00Z"), d("2030-01-01Z"))).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11,
    ]);
    expect(dueAllowanceMonths(start, d("2026-04-10T00:00:00Z"), d("2030-01-01Z"))).toEqual([]);
  });

  it("only yields anniversaries that have passed", () => {
    const start = d("2026-03-10T00:00:00Z");
    const end = d("2027-03-10T00:00:00Z");
    expect(dueAllowanceMonths(start, end, d("2026-04-09T23:59:59Z"))).toEqual([]);
    expect(dueAllowanceMonths(start, end, d("2026-04-10T00:00:00Z"))).toEqual([1]);
    expect(dueAllowanceMonths(start, end, d("2026-07-01T00:00:00Z"))).toEqual([1, 2, 3]);
  });
});

describe("usageToCredits", () => {
  it("charges at least one credit for any real usage", () => {
    expect(usageToCredits({ promptTokens: 10, completionTokens: 1 })).toBe(1);
  });
  it("charges nothing when nothing ran", () => {
    expect(usageToCredits({ promptTokens: 0, completionTokens: 0 })).toBe(0);
  });
});

// ---- Review findings (wave 1 billing) ---------------------------------------

/** An account at `balance` reached through the ledger (so ledger == balance). */
async function funded(balance: number) {
  await getCreditBalance(USER);
  if (balance < FREE_SIGNUP_CREDITS) await chargeCredits(USER, FREE_SIGNUP_CREDITS - balance, "test");
  if (balance > FREE_SIGNUP_CREDITS) await grantCredits(USER, balance - FREE_SIGNUP_CREDITS, "test");
  expect(h.db.balance(USER)).toBe(balance);
}

const tombstone = () =>
  withUserCreditLock(USER, (tx) =>
    tx.deletedAccount.upsert({ where: { userId: USER }, create: { userId: USER }, update: {} }),
  );

describe("finding 7: a deleted account stays deleted", () => {
  it("an AI request after the tombstone recreates neither the account nor its signup credits", async () => {
    await tombstone();
    expect(await getCreditBalance(USER)).toBe(0);
    expect(await hasCredits(USER)).toBe(false);
    expect(await chargeCredits(USER, 5, "agent")).toBe(0);
    expect(await reserveCredits(USER, { estimate: 5, reason: "agent" })).toBeNull();
    expect(h.db.state.accounts.has(USER)).toBe(false);
    expect(h.db.state.ledger).toHaveLength(0);
  });

  it("grants are refused once the tombstone exists", async () => {
    await getCreditBalance(USER);
    await tombstone();
    expect(await grantCredits(USER, 1000, "credit_purchase", "credit_purchase:cs_1")).toBe("deleted_account");
    expect(h.db.balance(USER)).toBe(FREE_SIGNUP_CREDITS);
  });

  it("a grant racing the tombstone lands before it or not at all", async () => {
    const [granted] = await Promise.all([
      grantCredits(USER, 1000, "credit_purchase", "credit_purchase:cs_2"),
      tombstone(),
    ]);
    const rows = h.db.ledgerFor(USER).filter((l) => l.reason === "credit_purchase");
    expect(rows).toHaveLength(granted === "granted" ? 1 : 0);
  });
});

describe("finding 10: hold and settle", () => {
  it("reserves before the work and settles to the real cost, once", async () => {
    await funded(200);
    const hold = await reserveCredits(USER, { estimate: 40, reason: "generate" });
    expect(hold).toMatchObject({ amount: 40 });
    expect(await getCreditBalance(USER)).toBe(160);
    expect(await settleCreditHold(hold!, 25)).toBe(25);
    expect(await settleCreditHold(hold!, 25)).toBe(25);
    expect(h.db.balance(USER)).toBe(175);
    expect(h.db.ledgerSum(USER)).toBe(175);
  });

  it("credits on hold still count as the user's for the free monthly refresh", async () => {
    await funded(160);
    await reserveCredits(USER, { estimate: 40, reason: "generate" });
    expect(await getCreditBalance(USER)).toBe(120);
    expect(h.db.ledgerFor(USER).some((l) => l.reason === "free_monthly")).toBe(false);
  });

  it("a cost above the hold takes the rest from the balance, never below zero", async () => {
    await funded(50);
    const hold = await reserveCredits(USER, { estimate: 40, reason: "generate" });
    expect(await settleCreditHold(hold!, 70)).toBe(50);
    expect(h.db.balance(USER)).toBe(0);
    expect(h.db.ledgerSum(USER)).toBe(0);
  });

  it("releasing returns the hold once; a release after a settle changes nothing", async () => {
    await funded(100);
    const a = await reserveCredits(USER, { estimate: 40, reason: "generate" });
    await releaseCreditHold(a!);
    await releaseCreditHold(a!);
    expect(h.db.balance(USER)).toBe(100);
    const b = await reserveCredits(USER, { estimate: 40, reason: "generate" });
    await settleCreditHold(b!, 10);
    await releaseCreditHold(b!);
    expect(h.db.balance(USER)).toBe(90);
    expect(h.db.ledgerSum(USER)).toBe(90);
  });

  it("parallel requests at a balance of 1: exactly one gets to run", async () => {
    await funded(1);
    const holds = await Promise.all(
      Array.from({ length: 10 }, () => reserveCredits(USER, { estimate: 40, reason: "generate" })),
    );
    expect(holds.filter(Boolean)).toHaveLength(1);
    expect(h.db.balance(USER)).toBe(0);
  });

  it("refuses when less than the minimum is available, and holds no more than the estimate", async () => {
    await funded(30);
    expect(await reserveCredits(USER, { estimate: 40, min: 40, reason: "generate" })).toBeNull();
    expect(h.db.balance(USER)).toBe(30);
    const hold = await reserveCredits(USER, { estimate: 20, min: 10, reason: "generate" });
    expect(hold?.amount).toBe(20);
  });

  it("an abandoned hold is given back once it expires (on the next read, or by the sweep)", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-12T10:00:00Z"));
    await funded(200);
    await reserveCredits(USER, { estimate: 40, reason: "generate" });
    expect(await getCreditBalance(USER)).toBe(160);
    vi.setSystemTime(new Date(Date.now() + CREDIT_HOLD_TTL_MS + 1000));
    expect(await getCreditBalance(USER)).toBe(200);
    await reserveCredits(USER, { estimate: 40, reason: "generate" });
    vi.setSystemTime(new Date(Date.now() + CREDIT_HOLD_TTL_MS + 1000));
    expect(await releaseExpiredHolds()).toBe(1);
    expect(h.db.balance(USER)).toBe(200);
    expect(h.db.ledgerSum(USER)).toBe(200);
  });

  it("work that finishes after its hold expired is still charged what it used", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-12T10:00:00Z"));
    await funded(100);
    const hold = await reserveCredits(USER, { estimate: 40, reason: "generate" });
    vi.setSystemTime(new Date(Date.now() + CREDIT_HOLD_TTL_MS + 1000));
    await releaseExpiredHolds();
    expect(await settleCreditHold(hold!, 30)).toBe(30);
    expect(h.db.balance(USER)).toBe(70);
    expect(h.db.ledgerSum(USER)).toBe(70);
  });
});

describe("finding 4: the allowance schedule", () => {
  const d = (s: string) => new Date(s);
  it("never yields more than eleven further months, whatever the period end", () => {
    const start = d("2028-02-29T12:00:00Z");
    expect(dueAllowanceMonths(start, d("2029-03-01T12:00:00Z"), d("2030-01-01Z"))).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11,
    ]);
  });
  it("stops at the stop instant (subscription ended, refunded or disputed)", () => {
    const start = d("2026-01-01T00:00:00Z");
    expect(
      dueAllowanceMonths(start, d("2027-01-01Z"), d("2030-01-01Z"), d("2026-03-15Z")),
    ).toEqual([1, 2]);
  });
});
