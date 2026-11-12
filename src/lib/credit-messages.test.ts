import { describe, expect, it } from "vitest";
import { LOCALES } from "@/lib/i18n/config";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { en } from "@/lib/i18n/dictionaries/en";
import { agentTooExpensiveMessage, belowBuildMinimumMessage, outOfCreditsMessage } from "./credit-messages";

describe("refusals when credits run short", () => {
  it("with payments on, offer Pro and packs and say what still works", () => {
    expect(outOfCreditsMessage(en, "agent", true)).toBe(en.credits.outAgent);
    expect(outOfCreditsMessage(en, "generate", true)).toBe(en.credits.outGenerate);
    for (const text of [en.credits.outAgent, en.credits.outGenerate, belowBuildMinimumMessage(en, 30, true)]) {
      expect(text).toMatch(/Pro/);
      expect(text).toMatch(/credit pack/);
      expect(text).toMatch(/keep(s)? working/);
    }
    expect(belowBuildMinimumMessage(en, 30, true)).toContain("costs 30 credits");
  });

  it("with payments off, say what is true and never send anyone to buy", () => {
    for (const { code } of LOCALES) {
      const T = getDictionary(code);
      for (const text of [
        outOfCreditsMessage(T, "agent", false),
        outOfCreditsMessage(T, "generate", false),
        belowBuildMinimumMessage(T, 30, false),
        agentTooExpensiveMessage(T, { cost: "3 credits", balance: 2 }, false),
      ]) {
        expect(text, code).not.toMatch(/\{[a-zA-Z]+\}/);
        expect(text, code).not.toBe(T.credits.outAgent);
      }
      expect(belowBuildMinimumMessage(T, 30, false), code).toContain("30");
    }
    expect(outOfCreditsMessage(en, "agent", false)).toMatch(/aren’t on sale yet/);
    expect(agentTooExpensiveMessage(en, { cost: "3 credits", balance: 2 }, false)).not.toMatch(/Add credits|Pro/);
  });

  it("no refusal in any language promises a monthly top-up on Free", () => {
    for (const { code } of LOCALES) {
      const T = getDictionary(code);
      for (const text of [T.spend.outOfCredits, T.spend.belowMinimum, T.credits.outAgent, T.credits.outGenerate]) {
        expect(text, code).not.toMatch(/\{monthly\}/);
      }
    }
    expect(en.spend.outOfCredits + en.spend.belowMinimum).not.toMatch(/once a month|monthly/i);
  });
});
