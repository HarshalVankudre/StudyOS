import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  usageCount: vi.fn(),
  usageCreate: vi.fn(),
  subFindUnique: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    usageEvent: { count: mocks.usageCount, create: mocks.usageCreate },
    subscription: { findUnique: mocks.subFindUnique },
  },
}));

import { checkUsageLimit, USAGE_LIMITS } from "./usage-limits";

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
});
