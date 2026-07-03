import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  accountFindUnique: vi.fn(),
  accountCreate: vi.fn(),
  accountUpdate: vi.fn(),
  ledgerCreate: vi.fn(),
  subFindUnique: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    creditAccount: {
      findUnique: mocks.accountFindUnique,
      create: mocks.accountCreate,
      update: mocks.accountUpdate,
    },
    creditLedger: { create: mocks.ledgerCreate },
    subscription: { findUnique: mocks.subFindUnique },
    $transaction: mocks.transaction,
  },
}));

import {
  FREE_MONTHLY_CREDITS,
  getCreditBalance,
  usageToCredits,
} from "./credits";

beforeEach(() => {
  for (const m of Object.values(mocks)) m.mockReset();
  mocks.transaction.mockResolvedValue([]);
  mocks.subFindUnique.mockResolvedValue(null);
});

describe("monthly free refresh", () => {
  it("tops up a depleted free account once per month", async () => {
    // Account exists with a low balance; after the grant it re-reads higher.
    mocks.accountFindUnique
      .mockResolvedValueOnce({ balance: 10 }) // getCreditBalance → ensureAccount
      .mockResolvedValueOnce({ balance: 10 }) // grantCredits → ensureAccount
      .mockResolvedValueOnce({ balance: 10 + FREE_MONTHLY_CREDITS }); // re-read
    const balance = await getCreditBalance("user_1");
    expect(balance).toBe(10 + FREE_MONTHLY_CREDITS);
    // The grant ran through a transaction with the month-scoped key.
    expect(mocks.transaction).toHaveBeenCalledTimes(1);
  });

  it("does not refresh when the balance is healthy", async () => {
    mocks.accountFindUnique.mockResolvedValue({
      balance: FREE_MONTHLY_CREDITS,
    });
    const balance = await getCreditBalance("user_1");
    expect(balance).toBe(FREE_MONTHLY_CREDITS);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("does not refresh active Pro subscribers (invoice grant covers them)", async () => {
    mocks.accountFindUnique.mockResolvedValue({ balance: 5 });
    mocks.subFindUnique.mockResolvedValue({ status: "active" });
    const balance = await getCreditBalance("user_1");
    expect(balance).toBe(5);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("is idempotent within a month (duplicate key ignored)", async () => {
    mocks.accountFindUnique
      .mockResolvedValueOnce({ balance: 10 })
      .mockResolvedValueOnce({ balance: 10 }); // grant was a no-op duplicate
    mocks.transaction.mockRejectedValue(
      Object.assign(new Error("dup"), { code: "P2002" }),
    );
    const balance = await getCreditBalance("user_1");
    expect(balance).toBe(10);
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
