import { beforeEach, describe, expect, it, vi } from "vitest";
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
  debitCredits,
  dueAllowanceMonths,
  FREE_MONTHLY_CREDITS,
  FREE_SIGNUP_CREDITS,
  getCreditBalance,
  grantCredits,
  usageToCredits,
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
