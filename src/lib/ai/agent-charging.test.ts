import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  count: vi.fn(),
  create: vi.fn(),
  charge: vi.fn(),
  settleHold: vi.fn(),
  releaseHold: vi.fn(),
}));
vi.mock("@/lib/db", () => ({
  prisma: { usageEvent: { count: h.count, create: h.create } },
}));
vi.mock("@/lib/credits", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/credits")>()),
  chargeCredits: h.charge,
  settleCreditHold: h.settleHold,
  releaseCreditHold: h.releaseHold,
}));

import { AGENT_FREE_FAILURE_KIND, FREE_FAILURES_PER_DAY, settleAgentTurn } from "./agent-charging";

// ~$0.011 on Haiku → 4 credits.
const USAGE = { promptTokens: 41_433, completionTokens: 13_970, costUsd: 0.0111 };

beforeEach(() => {
  h.count.mockReset().mockResolvedValue(0);
  h.create.mockReset().mockResolvedValue({});
  h.charge.mockReset().mockImplementation(async (_u: string, amount: number) => amount);
  h.settleHold.mockReset().mockImplementation(async (_h: unknown, amount: number) => amount);
  h.releaseHold.mockReset().mockResolvedValue(true);
});

const HOLD = { id: "hold_1", userId: "u", amount: 2, reason: "agent" };

describe("with a reserved hold", () => {
  it("settles the hold to the real cost of a completed or cancelled turn", async () => {
    expect(await settleAgentTurn({ userId: "u", usage: USAGE, model: "claude-haiku-5-5", outcome: "completed", hold: HOLD })).toBe(4);
    expect(h.settleHold).toHaveBeenCalledWith(HOLD, 4, { reason: "agent" });
    await settleAgentTurn({ userId: "u", usage: USAGE, model: "claude-haiku-5-5", outcome: "cancelled", hold: HOLD });
    expect(h.settleHold).toHaveBeenLastCalledWith(HOLD, 4, { reason: "agent_cancelled" });
    expect(h.charge).not.toHaveBeenCalled();
  });

  it("releases the hold in full for a free failure", async () => {
    expect(await settleAgentTurn({ userId: "u", usage: USAGE, model: "claude-haiku-5-5", outcome: "failed", hold: HOLD })).toBe(0);
    expect(h.releaseHold).toHaveBeenCalledWith(HOLD);
    expect(h.settleHold).not.toHaveBeenCalled();
  });
});

describe("agent turn charging policy", () => {
  it("charges a completed turn its real per-model cost", async () => {
    expect(await settleAgentTurn({ userId: "u", usage: USAGE, model: "claude-haiku-5-5", outcome: "completed" })).toBe(4);
    expect(h.charge).toHaveBeenCalledWith("u", 4, "agent");
  });

  it("charges a cancelled turn for the tokens it used", async () => {
    await settleAgentTurn({ userId: "u", usage: USAGE, model: "claude-haiku-5-5", outcome: "cancelled" });
    expect(h.charge).toHaveBeenCalledWith("u", 4, "agent_cancelled");
  });

  it("does not charge a failed turn within the daily allowance, and records it", async () => {
    h.count.mockResolvedValue(FREE_FAILURES_PER_DAY - 1);
    expect(await settleAgentTurn({ userId: "u", usage: USAGE, model: "claude-haiku-5-5", outcome: "failed" })).toBe(0);
    expect(h.charge).not.toHaveBeenCalled();
    expect(h.create).toHaveBeenCalledWith({ data: { userId: "u", kind: AGENT_FREE_FAILURE_KIND } });
  });

  it("charges failures beyond the allowance, so failing on purpose is not free work", async () => {
    h.count.mockResolvedValue(FREE_FAILURES_PER_DAY);
    expect(await settleAgentTurn({ userId: "u", usage: USAGE, model: "claude-haiku-5-5", outcome: "failed" })).toBe(4);
    expect(h.charge).toHaveBeenCalledWith("u", 4, "agent_failed");
  });

  it("charges nothing and uses no allowance when no model ran", async () => {
    const none = { promptTokens: 0, completionTokens: 0 };
    expect(await settleAgentTurn({ userId: "u", usage: none, model: "x", outcome: "failed" })).toBe(0);
    expect(h.count).not.toHaveBeenCalled();
    expect(h.charge).not.toHaveBeenCalled();
  });
});
