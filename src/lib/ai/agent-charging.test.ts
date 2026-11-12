import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  count: vi.fn(),
  create: vi.fn(),
  charge: vi.fn(),
  settleHold: vi.fn(),
  releaseHold: vi.fn(),
}));
vi.mock("@/lib/db", () => {
  const usageEvent = { count: h.count, create: h.create };
  return {
    prisma: {
      usageEvent,
      subscription: { findUnique: async () => null },
      // The allowance is claimed under an advisory lock in a transaction.
      $transaction: async (fn: (tx: unknown) => unknown) => fn({ $queryRaw: async () => [], usageEvent }),
    },
  };
});
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
/** One message on the free plan: 3 credits, a long request up to the 30 ceiling. */
const Q = { list: 3, price: 3, max: 30 };

describe("with a reserved hold", () => {
  it("settles the hold to the charge of a completed or cancelled turn", async () => {
    expect(await settleAgentTurn({ userId: "u", usage: USAGE, model: "claude-haiku-5-5", outcome: "completed", quote: Q, hold: HOLD })).toBe(4);
    expect(h.settleHold).toHaveBeenCalledWith(HOLD, 4, { reason: "agent" });
    await settleAgentTurn({ userId: "u", usage: USAGE, model: "claude-haiku-5-5", outcome: "cancelled", quote: Q, hold: HOLD });
    expect(h.settleHold).toHaveBeenLastCalledWith(HOLD, 4, { reason: "agent_cancelled" });
    expect(h.charge).not.toHaveBeenCalled();
  });

  it("releases the hold in full for a free failure", async () => {
    expect(await settleAgentTurn({ userId: "u", usage: USAGE, model: "claude-haiku-5-5", outcome: "failed", quote: Q, hold: HOLD })).toBe(0);
    expect(h.releaseHold).toHaveBeenCalledWith(HOLD);
    expect(h.settleHold).not.toHaveBeenCalled();
  });
});

describe("agent turn charging policy", () => {
  it("charges a completed turn its real per-model cost when that is above the price", async () => {
    expect(await settleAgentTurn({ userId: "u", usage: USAGE, model: "claude-haiku-5-5", outcome: "completed", quote: Q })).toBe(4);
    expect(h.charge).toHaveBeenCalledWith("u", 4, "agent");
  });

  it("charges a cancelled turn that already spent more than the price its real cost", async () => {
    await settleAgentTurn({ userId: "u", usage: USAGE, model: "claude-haiku-5-5", outcome: "cancelled", quote: Q });
    expect(h.charge).toHaveBeenCalledWith("u", 4, "agent_cancelled");
  });

  it("does not charge a failed turn within the daily allowance, and records it", async () => {
    h.count.mockResolvedValue(FREE_FAILURES_PER_DAY - 1);
    expect(await settleAgentTurn({ userId: "u", usage: USAGE, model: "claude-haiku-5-5", outcome: "failed", quote: Q })).toBe(0);
    expect(h.charge).not.toHaveBeenCalled();
    expect(h.create).toHaveBeenCalledWith({ data: { userId: "u", kind: AGENT_FREE_FAILURE_KIND } });
  });

  it("charges failures beyond the allowance, so failing on purpose is not free work", async () => {
    h.count.mockResolvedValue(FREE_FAILURES_PER_DAY);
    expect(await settleAgentTurn({ userId: "u", usage: USAGE, model: "claude-haiku-5-5", outcome: "failed", quote: Q })).toBe(4);
    expect(h.charge).toHaveBeenCalledWith("u", 4, "agent_failed");
  });

  it("charges nothing and uses no allowance when no model ran", async () => {
    const none = { promptTokens: 0, completionTokens: 0 };
    expect(await settleAgentTurn({ userId: "u", usage: none, model: "x", outcome: "failed", quote: Q })).toBe(0);
    expect(h.count).not.toHaveBeenCalled();
    expect(h.charge).not.toHaveBeenCalled();
  });
});

describe("round 2, finding 8: a turn never costs more than the plan's per-message cap", () => {
  // ~$0.2 on any model: 67 credits, more than the free cap of 30.
  const BIG = { promptTokens: 100_000, completionTokens: 50_000, costUsd: 0.2 };
  const CEILING = { ...HOLD, amount: 30 };

  it("clamps the model charge to the cap (estimates and rounding up cannot push a turn past it)", async () => {
    expect(
      await settleAgentTurn({ userId: "u", usage: BIG, model: "m", outcome: "completed", quote: Q, hold: CEILING, capCredits: 30 }),
    ).toBe(30);
    expect(h.settleHold).toHaveBeenCalledWith(CEILING, 30, { reason: "agent" });
  });

  it("counts the turn's sandbox renders toward the cap", async () => {
    const { createSandboxTool } = await import("./tools/sandbox-tool");
    const { FakeSandboxRunner } = await import("@/lib/ai/sandbox/runner.fake");
    const tool = createSandboxTool({
      runner: new FakeSandboxRunner({ exitCode: 0, logTail: "", artifacts: [{ path: "out/a.png", bytes: new Uint8Array([1]) }] }),
      createAsset: async (i) => ({ assetId: "a1", mime: i.mime, filename: i.filename }),
      enabled: true,
      quota: { reserve: async () => ({ ok: true as const, charge: { settle: async () => {}, release: async () => {} } }) },
    });
    const input = { inputs: [], setup: [], run: ["render"], outputs: ["out/a.png"], timeoutSec: 60 };
    await tool.handler(input, { taskId: "task_9", ownerId: "u" });
    await tool.handler(input, { taskId: "task_9", ownerId: "u" });
    // Two renders were charged 2 each: the model may take at most 26 of the 30.
    expect(
      await settleAgentTurn({ userId: "u", usage: BIG, model: "m", outcome: "completed", quote: Q, hold: CEILING, capCredits: 30, taskId: "task_9" }),
    ).toBe(26);
    expect(h.settleHold).toHaveBeenLastCalledWith(CEILING, 26, { reason: "agent" });
  });

  it("a turn whose real cost is above the price, under the cap, is charged its real cost", async () => {
    expect(
      await settleAgentTurn({ userId: "u", usage: USAGE, model: "claude-haiku-5-5", outcome: "completed", quote: Q, hold: CEILING, capCredits: 30, taskId: "task_x" }),
    ).toBe(4);
  });

  describe("a render that finishes after its turn was settled", () => {
    async function lateRender(taskId: string) {
      const { createSandboxTool } = await import("./tools/sandbox-tool");
      const { FakeSandboxRunner } = await import("@/lib/ai/sandbox/runner.fake");
      const events: string[] = [];
      const tool = createSandboxTool({
        runner: new FakeSandboxRunner({ exitCode: 0, logTail: "", artifacts: [{ path: "out/a.png", bytes: new Uint8Array([1]) }] }),
        createAsset: async (i) => ({ assetId: "a1", mime: i.mime, filename: i.filename }),
        enabled: true,
        quota: {
          reserve: async () => ({
            ok: true as const,
            charge: {
              settle: async () => void events.push("settle"),
              release: async () => void events.push("release"),
            },
          }),
        },
      });
      const input = { inputs: [], setup: [], run: ["render"], outputs: ["out/a.png"], timeoutSec: 60 };
      await tool.handler(input, { taskId, ownerId: "u" });
      return events;
    }

    it("is not charged when the cancelled turn already took the whole cap", async () => {
      expect(
        await settleAgentTurn({ userId: "u", usage: BIG, model: "m", outcome: "cancelled", quote: Q, hold: CEILING, capCredits: 30, taskId: "task_late" }),
      ).toBe(30);
      // Its reserved credits go back instead: the turn stays at 30.
      expect(await lateRender("task_late")).toEqual(["release"]);
    });

    it("is charged when it still fits under the cap, and only as many as fit", async () => {
      // 4 credits of model work leaves 26: room for 13 renders of 2.
      await settleAgentTurn({ userId: "u", usage: USAGE, model: "claude-haiku-5-5", outcome: "cancelled", quote: Q, hold: CEILING, capCredits: 30, taskId: "task_room" });
      const outcomes: string[] = [];
      for (let i = 0; i < 14; i++) outcomes.push((await lateRender("task_room"))[0]);
      expect(outcomes.filter((o) => o === "settle")).toHaveLength(13);
      expect(outcomes.at(-1)).toBe("release");
    });

    it("is charged normally when the turn had no cap", async () => {
      await settleAgentTurn({ userId: "u", usage: USAGE, model: "claude-haiku-5-5", outcome: "cancelled", quote: Q, taskId: "task_nocap" });
      expect((await lateRender("task_nocap"))[0]).toBe("settle");
    });
  });
});

describe("the published message price (lib/price-list.ts)", () => {
  // ~$0.0015 on Haiku: 1 credit of model spend, an ordinary short message.
  const SMALL = { promptTokens: 6_000, completionTokens: 1_500, costUsd: 0.0015 };
  const CEILING = { ...HOLD, amount: 30 };

  it("an ordinary message is charged the list price, not its smaller real cost", async () => {
    expect(
      await settleAgentTurn({ userId: "u", usage: SMALL, model: "claude-haiku-5-5", outcome: "completed", quote: Q, hold: CEILING, capCredits: 30 }),
    ).toBe(3);
    expect(h.settleHold).toHaveBeenCalledWith(CEILING, 3, { reason: "agent" });
  });

  it("a message on an expensive model is charged its real cost, never above the ceiling shown", async () => {
    const dear = { list: 3, price: 7, max: 30 };
    const usage = { promptTokens: 5_000, completionTokens: 3_000, costUsd: 0.0202 }; // 7 credits
    expect(await settleAgentTurn({ userId: "u", usage, model: "z-ai/glm-5.2", outcome: "completed", quote: dear, capCredits: 30 })).toBe(7);
  });

  it("a stopped message pays the share of the price it used, never more than the price", async () => {
    // Half of what the request was expected to spend: half the price, rounded up.
    expect(
      await settleAgentTurn({ userId: "u", usage: SMALL, model: "claude-haiku-5-5", outcome: "cancelled", quote: Q, typicalUsd: 0.003, capCredits: 30 }),
    ).toBe(2);
    // More than expected, still within the price: the price.
    expect(
      await settleAgentTurn({ userId: "u", usage: SMALL, model: "claude-haiku-5-5", outcome: "cancelled", quote: Q, typicalUsd: 0.0005, capCredits: 30 }),
    ).toBe(3);
    expect(h.charge).toHaveBeenLastCalledWith("u", 3, "agent_cancelled");
  });

  it("a failure past the daily allowance is charged like a stopped message", async () => {
    h.count.mockResolvedValue(FREE_FAILURES_PER_DAY);
    expect(
      await settleAgentTurn({ userId: "u", usage: SMALL, model: "claude-haiku-5-5", outcome: "failed", quote: Q, typicalUsd: 0.003 }),
    ).toBe(2);
    expect(h.charge).toHaveBeenCalledWith("u", 2, "agent_failed");
  });

  it("a free failure releases the whole hold", async () => {
    expect(
      await settleAgentTurn({ userId: "u", usage: SMALL, model: "claude-haiku-5-5", outcome: "failed", quote: Q, hold: CEILING }),
    ).toBe(0);
    expect(h.releaseHold).toHaveBeenCalledWith(CEILING);
    expect(h.settleHold).not.toHaveBeenCalled();
  });
});
