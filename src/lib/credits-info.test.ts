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

describe("costs shown before an action are close to what the configured model is charged", () => {
  it("on Claude Haiku, a build is about 2, an edit 1 and a study-kit section 1 (QA saw 1 to 3 charged)", async () => {
    const { buildCreditCost, editCreditCost, studyKitSectionCredits } = await import("./credits-info");
    expect(buildCreditCost("claude-haiku-5-5").typical).toBe(2);
    expect(editCreditCost("claude-haiku-5-5")).toBe(1);
    expect(studyKitSectionCredits("claude-haiku-5-5")).toBe(1);
    const { questionsCreditCost } = await import("./credits-info");
    expect(questionsCreditCost("claude-haiku-5-5")).toBe(1);
    expect(questionsCreditCost("z-ai/glm-5.2")).toBeGreaterThan(1);
    // The default model keeps its measured figures.
    expect(studyKitSectionCredits("z-ai/glm-5.2")).toBe(9);
  });

  it("a study-kit section is never quoted above its promised cap", async () => {
    const { studyKitSectionCredits, STUDY_KIT_MAX_CREDITS_PER_SECTION } = await import("./credits-info");
    expect(studyKitSectionCredits("claude-opus-5-5")).toBeLessThanOrEqual(STUDY_KIT_MAX_CREDITS_PER_SECTION);
  });

  it("prices a study-kit run with the model's per-section figure", async () => {
    const { studyKitCost } = await import("./credits-info");
    expect(studyKitCost(3, 1)).toEqual({ estimate: 3, max: 60, minBalance: 20 });
    expect(studyKitCost(3, 9).estimate).toBe(27);
  });

  it("quotes the configured model everywhere on the server, the credit pack included", async () => {
    vi.resetModules();
    vi.stubEnv("STUDYOS_FREE_MODEL", "claude-haiku-5-5");
    vi.stubEnv("STUDYOS_PRO_MODEL", "claude-haiku-5-5");
    try {
      const info = await import("./credits-info");
      expect(info.CREDITS_PER_GENERATION).toBe(2);
      expect(info.CREDITS_PER_EDIT).toBe(1);
      expect(info.STUDY_KIT_CREDITS_PER_SECTION).toBe(1);
      // A 1,000-credit pack: about 500 builds or 1,000 edits, not 25 or 142.
      expect(info.estimatedGenerations(1000)).toBe(500);
      expect(info.estimatedEdits(1000)).toBe(1000);
    } finally {
      vi.unstubAllEnvs();
      vi.resetModules();
    }
  });
});
