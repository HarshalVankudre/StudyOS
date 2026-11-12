import { describe, expect, it, vi } from "vitest";
import {
  CREDITS_PER_EDIT,
  CREDITS_PER_GENERATION,
  estimatedEdits,
  estimatedGenerations,
  isLowBalance,
  LOW_CREDIT_THRESHOLD,
} from "./credits-info";

describe("credits-info", () => {
  it("flags balances at or below the threshold as low", () => {
    expect(isLowBalance(0)).toBe(true);
    expect(isLowBalance(LOW_CREDIT_THRESHOLD)).toBe(true);
    expect(isLowBalance(LOW_CREDIT_THRESHOLD + 1)).toBe(false);
    expect(isLowBalance(1000)).toBe(false);
  });

  it("estimates whole builds/edits from a balance, floored", () => {
    expect(estimatedGenerations(1000)).toBe(Math.floor(1000 / CREDITS_PER_GENERATION));
    expect(estimatedEdits(1000)).toBe(Math.floor(1000 / CREDITS_PER_EDIT));
    expect(estimatedGenerations(CREDITS_PER_GENERATION - 1)).toBe(0);
  });

  it("never returns a negative estimate", () => {
    expect(estimatedGenerations(-50)).toBe(0);
    expect(estimatedEdits(-50)).toBe(0);
  });
});

describe("round 2, finding 13: typical costs and the build hold follow the model's rates", () => {
  it("on the default model, a build is about 40 and an edit about 7 (what the pages always said)", async () => {
    const { buildCreditCost, editCreditCost } = await import("./credits-info");
    expect(buildCreditCost("z-ai/glm-5.2").typical).toBe(40);
    expect(editCreditCost("z-ai/glm-5.2")).toBe(7);
  });

  it("a pricier model costs more and a cheaper one less, and the hold covers a build at its limits", async () => {
    const { buildCreditCost, editCreditCost } = await import("./credits-info");
    const glm = buildCreditCost("z-ai/glm-5.2");
    const sonnet = buildCreditCost("claude-sonnet-5-5");
    const haiku = buildCreditCost("claude-haiku-5-5");
    expect(sonnet.typical).toBeGreaterThan(glm.typical);
    expect(haiku.typical).toBeLessThan(glm.typical);
    expect(editCreditCost("claude-sonnet-5-5")).toBeGreaterThan(editCreditCost("z-ai/glm-5.2"));
    for (const cost of [glm, sonnet, haiku]) expect(cost.max).toBeGreaterThan(cost.typical);
  });

  it("the quoted figures are those of the configured models (the dearer of the two plans')", async () => {
    vi.resetModules();
    vi.stubEnv("STUDYOS_FREE_MODEL", "claude-haiku-5-5");
    vi.stubEnv("STUDYOS_PRO_MODEL", "claude-sonnet-5-5");
    try {
      const info = await import("./credits-info");
      expect(info.CREDITS_PER_GENERATION).toBe(info.buildCreditCost("claude-sonnet-5-5").typical);
      expect(info.MIN_GENERATION_BALANCE).toBe(info.CREDITS_PER_GENERATION);
      expect(info.CREDITS_PER_EDIT).toBe(info.editCreditCost("claude-sonnet-5-5"));
    } finally {
      vi.unstubAllEnvs();
      vi.resetModules();
    }
  });
});
