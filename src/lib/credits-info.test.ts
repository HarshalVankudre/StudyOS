import { describe, expect, it } from "vitest";
import {
  addTokens,
  creditsToUsd,
  isLowBalance,
  LOW_CREDIT_THRESHOLD,
  MAX_BUILD_TOKENS,
  MAX_KIT_SECTION_TOKENS,
  tokensCredits,
  typicalTokens,
  usdToCredits,
} from "./credits-info";

describe("credits-info", () => {
  it("flags a low balance at or below the threshold", () => {
    expect(isLowBalance(0)).toBe(true);
    expect(isLowBalance(LOW_CREDIT_THRESHOLD)).toBe(true);
    expect(isLowBalance(LOW_CREDIT_THRESHOLD + 1)).toBe(false);
  });

  it("converts at the peg: 1000 credits buy $3.00 of model spend", () => {
    expect(usdToCredits(3)).toBe(1000);
    expect(usdToCredits(0.0001)).toBe(1); // anything that ran costs at least 1
    expect(usdToCredits(0)).toBe(0);
    expect(creditsToUsd(1000)).toBeCloseTo(3);
    expect(creditsToUsd(-5)).toBe(0);
  });

  it("prices token profiles per model (what decides whether a list price is a floor)", () => {
    expect(tokensCredits("z-ai/glm-5.2", typicalTokens("z-ai/glm-5.2", "build"))).toBe(40);
    expect(tokensCredits("z-ai/glm-5.2", typicalTokens("z-ai/glm-5.2", "edit"))).toBe(7);
    expect(tokensCredits("claude-haiku-5-5", typicalTokens("claude-haiku-5-5", "build"))).toBe(2);
    expect(tokensCredits("claude-haiku-5-5", typicalTokens("claude-haiku-5-5", "edit"))).toBe(1);
    expect(tokensCredits("claude-haiku-5-5", MAX_BUILD_TOKENS)).toBeLessThan(30);
    expect(tokensCredits("claude-haiku-5-5", MAX_KIT_SECTION_TOKENS)).toBeLessThan(10);
    expect(tokensCredits("claude-sonnet-5-5", typicalTokens("claude-sonnet-5-5", "edit"))).toBeGreaterThan(
      tokensCredits("z-ai/glm-5.2", typicalTokens("z-ai/glm-5.2", "edit")),
    );
  });

  it("adds token profiles", () => {
    const a = { input: 1, output: 2, cacheRead: 3, cacheWrite: 4 };
    expect(addTokens(a, a)).toEqual({ input: 2, output: 4, cacheRead: 6, cacheWrite: 8 });
  });
});
