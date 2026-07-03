import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  accountFindUnique: vi.fn(),
  accountCreate: vi.fn(),
  accountUpdate: vi.fn(),
  ledgerCreate: vi.fn(),
  ledgerFindUnique: vi.fn(),
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
    creditLedger: {
      create: mocks.ledgerCreate,
      findUnique: mocks.ledgerFindUnique,
    },
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
  mocks.ledgerFindUnique.mockResolvedValue(null); // no prior refresh this month
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

  it("skips the grant entirely when this month's refresh already exists", async () => {
    mocks.accountFindUnique.mockResolvedValue({ balance: 10 });
    mocks.ledgerFindUnique.mockResolvedValue({ id: "led_1" }); // already refreshed
    const balance = await getCreditBalance("user_1");
    expect(balance).toBe(10);
    // No doomed transaction on the hot path.
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.subFindUnique).not.toHaveBeenCalled();
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
