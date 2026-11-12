import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ prisma: {} }));
import {
  DEFAULT_MODEL_PRICE,
  MODEL_PRICES,
  callCostUsd,
  priceForModel,
} from "./model-pricing";
import { recordUsage, withUsageMeter, addUsage, forwardUsage } from "./usage-meter";
import { usageToCredits, usageToUsd, usdToCredits } from "@/lib/credits";

const M = 1_000_000;

describe("per-model pricing", () => {
  it("keeps the existing rate for the OpenRouter GLM model", () => {
    expect(priceForModel("z-ai/glm-5.2")).toMatchObject({ inputPerMTok: 1.4, outputPerMTok: 4.4 });
    expect(callCostUsd("z-ai/glm-5.2", { input: M, output: M, cacheRead: 0, cacheWrite: 0 })).toBeCloseTo(5.8);
  });

  it("prices Claude Haiku 5.5 at $0.10 / $0.50 per million up to 100K-token prompts", () => {
    const cost = callCostUsd("claude-haiku-5-5", { input: 50_000, output: 10_000, cacheRead: 0, cacheWrite: 0 });
    expect(cost).toBeCloseTo((50_000 * 0.1 + 10_000 * 0.5) / M, 10);
  });

  it("bills cache reads at 0.1x and cache writes at 1.25x input", () => {
    const tokens = { input: 1_000, output: 500, cacheRead: 20_000, cacheWrite: 4_000 };
    const expected = (1_000 * 0.1 + 500 * 0.5 + 20_000 * 0.01 + 4_000 * 0.125) / M;
    expect(callCostUsd("claude-haiku-5-5", tokens)).toBeCloseTo(expected, 12);
    // Reading from the cache is far cheaper than sending the same prompt fresh.
    expect(
      callCostUsd("claude-haiku-5-5", { input: 0, output: 0, cacheRead: 20_000, cacheWrite: 0 }),
    ).toBeLessThan(callCostUsd("claude-haiku-5-5", { input: 20_000, output: 0, cacheRead: 0, cacheWrite: 0 }) / 5);
  });

  it("switches the whole call to the long-context tier above 100K prompt tokens", () => {
    const tokens = { input: 10_000, output: 1_000, cacheRead: 95_000, cacheWrite: 0 };
    const long = MODEL_PRICES["claude-haiku-5-5"].longContext!;
    const expected = (10_000 * long.inputPerMTok + 1_000 * long.outputPerMTok + 95_000 * long.cacheReadPerMTok) / M;
    expect(callCostUsd("claude-haiku-5-5", tokens)).toBeCloseTo(expected, 12);
  });

  it("falls back to a safe (expensive) default for an unknown model, and matches dated ids", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(priceForModel("acme/unknown-1")).toBe(DEFAULT_MODEL_PRICE);
    expect(DEFAULT_MODEL_PRICE.inputPerMTok).toBeGreaterThanOrEqual(
      Math.max(...Object.values(MODEL_PRICES).map((p) => p.inputPerMTok)),
    );
    expect(priceForModel("claude-haiku-5-5-20261001")).toBe(MODEL_PRICES["claude-haiku-5-5"]);
    expect(priceForModel("anthropic/claude-haiku-5-5")).toBe(MODEL_PRICES["claude-haiku-5-5"]);
    warn.mockRestore();
  });
});

describe("usage meter prices each call by its model", () => {
  it("records Anthropic cache fields and the per-model cost", async () => {
    const { usage } = await withUsageMeter(async () => {
      recordUsage(
        { input_tokens: 1_000, output_tokens: 500, cache_read_input_tokens: 20_000, cache_creation_input_tokens: 4_000 },
        "claude-haiku-5-5",
      );
    });
    expect(usage).toMatchObject({
      promptTokens: 25_000,
      completionTokens: 500,
      cacheReadTokens: 20_000,
      cacheWriteTokens: 4_000,
    });
    expect(usage.costUsd).toBeCloseTo((1_000 * 0.1 + 500 * 0.5 + 20_000 * 0.01 + 4_000 * 0.125) / M, 12);
  });

  it("splits OpenRouter cached tokens out of prompt_tokens", async () => {
    const { usage } = await withUsageMeter(async () => {
      recordUsage(
        { prompt_tokens: 10_000, completion_tokens: 1_000, prompt_tokens_details: { cached_tokens: 6_000 } },
        "z-ai/glm-5.2",
      );
    });
    expect(usage).toMatchObject({ promptTokens: 10_000, cacheReadTokens: 6_000 });
    expect(usage.costUsd).toBeCloseTo((4_000 * 1.4 + 6_000 * 1.4 + 1_000 * 4.4) / M, 12);
  });

  it("forwards a nested meter's priced cost unchanged", async () => {
    const inner = await withUsageMeter(async () => {
      recordUsage({ input_tokens: 100_000, output_tokens: 10_000 }, "claude-haiku-5-5");
    });
    const outer = await withUsageMeter(async () => forwardUsage(inner.usage));
    expect(outer.usage.costUsd).toBeCloseTo(inner.usage.costUsd!, 12);
  });

  it("sums priced parts, and an empty part does not unprice the sum", () => {
    const sum = addUsage(
      { promptTokens: 0, completionTokens: 0 },
      { promptTokens: 10, completionTokens: 5, costUsd: 0.002 },
      { promptTokens: 20, completionTokens: 5, costUsd: 0.004 },
    );
    expect(sum.costUsd).toBeCloseTo(0.006, 12);
  });
});

describe("credits track the real cost", () => {
  it("charges a Haiku turn a fraction of what the old single GLM rate charged", () => {
    // The measured pre-change live turn: 41,433 prompt and 13,970 output tokens on Haiku.
    const tokens = { promptTokens: 41_433, completionTokens: 13_970 };
    const haiku = usageToCredits(tokens, "claude-haiku-5-5");
    const legacy = usageToCredits(tokens);
    expect(legacy).toBe(40);
    expect(haiku).toBe(4);
  });

  it("uses the recorded per-call cost when present (cache discounts included)", () => {
    expect(usageToUsd({ promptTokens: 1_000_000, completionTokens: 0, costUsd: 0.01 }, "z-ai/glm-5.2")).toBe(0.01);
    expect(usageToCredits({ promptTokens: 1_000_000, completionTokens: 0, costUsd: 0.01 })).toBe(4);
  });

  it("prices unmetered cache tokens by model", () => {
    const usd = usageToUsd(
      { promptTokens: 30_000, completionTokens: 0, cacheReadTokens: 20_000, cacheWriteTokens: 0 },
      "claude-haiku-5-5",
    );
    expect(usd).toBeCloseTo((10_000 * 0.1 + 20_000 * 0.01) / M, 12);
  });

  it("rounds dollars up to whole credits, never below 1 when anything ran", () => {
    expect(usdToCredits(0)).toBe(0);
    expect(usdToCredits(0.0000001)).toBe(1);
    expect(usdToCredits(0.003)).toBe(1);
    expect(usdToCredits(0.0031)).toBe(2);
  });
});
