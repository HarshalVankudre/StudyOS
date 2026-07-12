import { describe, expect, it } from "vitest";
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
