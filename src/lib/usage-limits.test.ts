import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  usageCount: vi.fn(),
  usageCreate: vi.fn(),
  subFindUnique: vi.fn(),
}));

vi.mock("@/lib/db", () => {
  const usageEvent = { count: mocks.usageCount, create: mocks.usageCreate };
  return {
    prisma: {
      usageEvent,
      subscription: { findUnique: mocks.subFindUnique },
      // checkUsageLimit counts and records under an advisory lock in a transaction.
      $transaction: async (fn: (tx: unknown) => unknown) => fn({ $queryRaw: async () => [], usageEvent }),
    },
  };
});

import {
  checkUsageLimit,
  claimOutcomeSlot,
  isUsageLimitReached,
  recordUsageEvent,
  USAGE_LIMITS,
} from "./usage-limits";

beforeEach(() => {
  mocks.usageCount.mockReset();
  mocks.usageCreate.mockReset().mockResolvedValue({});
  mocks.subFindUnique.mockReset().mockResolvedValue(null);
});

describe("checkUsageLimit", () => {
  it("allows under the free limit and records the event", async () => {
    mocks.usageCount.mockResolvedValue(0);
    const res = await checkUsageLimit("user_1", "generate");
    expect(res.allowed).toBe(true);
    expect(res.remaining).toBe(USAGE_LIMITS.generate.free - 1);
    expect(mocks.usageCreate).toHaveBeenCalledWith({
      data: { userId: "user_1", kind: "generate" },
    });
  });

  it("refuses at the free limit and records nothing", async () => {
    mocks.usageCount.mockResolvedValue(USAGE_LIMITS.generate.free);
    const res = await checkUsageLimit("user_1", "generate");
    expect(res.allowed).toBe(false);
    expect(mocks.usageCreate).not.toHaveBeenCalled();
  });

  it("gives active subscribers the pro limit", async () => {
    mocks.subFindUnique.mockResolvedValue({ status: "active" });
    mocks.usageCount.mockResolvedValue(USAGE_LIMITS.generate.free); // over free, under pro
    const res = await checkUsageLimit("user_1", "generate");
    expect(res.allowed).toBe(true);
  });

  it("treats canceled subscriptions as free tier", async () => {
    mocks.subFindUnique.mockResolvedValue({ status: "canceled" });
    mocks.usageCount.mockResolvedValue(USAGE_LIMITS.sandbox_run.free);
    const res = await checkUsageLimit("user_1", "sandbox_run");
    expect(res.allowed).toBe(false);
  });

  it("counts only inside the window", async () => {
    mocks.usageCount.mockResolvedValue(0);
    const before = Date.now();
    await checkUsageLimit("user_1", "agent");
    const arg = mocks.usageCount.mock.calls[0][0];
    const since: Date = arg.where.createdAt.gte;
    expect(before - since.getTime()).toBeGreaterThanOrEqual(
      USAGE_LIMITS.agent.windowMs - 1000,
    );
    expect(before - since.getTime()).toBeLessThanOrEqual(
      USAGE_LIMITS.agent.windowMs + 1000,
    );
  });

  it("still allows the action when event recording fails (fail-open)", async () => {
    mocks.usageCount.mockResolvedValue(0);
    mocks.usageCreate.mockRejectedValue(new Error("db down"));
    const res = await checkUsageLimit("user_1", "generate");
    expect(res.allowed).toBe(true);
  });

  it("still allows the action when the plan lookup fails (fail-open)", async () => {
    mocks.subFindUnique.mockRejectedValue(new Error("db down"));
    await expect(checkUsageLimit("user_1", "generate")).resolves.toEqual({ allowed: true, remaining: 0 });
  });

  it("gives a subscriber whose payment is disputed the free limit", async () => {
    mocks.subFindUnique.mockResolvedValue({ status: "active", currentPeriodEnd: null, disputeId: "dp_1" });
    mocks.usageCount.mockResolvedValue(USAGE_LIMITS.generate.free);
    expect((await checkUsageLimit("user_1", "generate")).allowed).toBe(false);
  });

  it("gives an 'active' row long past its paid period the free limit", async () => {
    mocks.subFindUnique.mockResolvedValue({
      status: "active",
      currentPeriodEnd: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
      disputeId: null,
    });
    mocks.usageCount.mockResolvedValue(USAGE_LIMITS.generate.free);
    expect((await checkUsageLimit("user_1", "generate")).allowed).toBe(false);
  });
});

describe("claimOutcomeSlot", () => {
  it("fails open (no slot) when the plan lookup fails", async () => {
    mocks.subFindUnique.mockRejectedValue(new Error("db down"));
    await expect(claimOutcomeSlot("user_1", "generate_failed")).resolves.toEqual({ allowed: true, slot: null });
  });
});

describe("failed-generation quota", () => {
  it("checks without recording, and records only when a failure happens", async () => {
    mocks.usageCount.mockResolvedValue(USAGE_LIMITS.generate_failed.free - 1);
    expect(await isUsageLimitReached("user_1", "generate_failed")).toBe(false);
    expect(mocks.usageCreate).not.toHaveBeenCalled();
    await recordUsageEvent("user_1", "generate_failed");
    expect(mocks.usageCreate).toHaveBeenCalledWith({ data: { userId: "user_1", kind: "generate_failed" } });
    mocks.usageCount.mockResolvedValue(USAGE_LIMITS.generate_failed.free);
    expect(await isUsageLimitReached("user_1", "generate_failed")).toBe(true);
  });

  it("is small and per day", () => {
    expect(USAGE_LIMITS.generate_failed.free).toBeLessThanOrEqual(5);
    expect(USAGE_LIMITS.generate_failed.windowMs).toBe(24 * 60 * 60 * 1000);
  });

  it("recording never throws", async () => {
    mocks.usageCreate.mockRejectedValue(new Error("db down"));
    await expect(recordUsageEvent("user_1", "generate_failed")).resolves.toBeUndefined();
  });
});
