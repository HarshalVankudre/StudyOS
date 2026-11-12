import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  ACTION_PRICES,
  buildQuote,
  buildTypicalUsd,
  chargeForCompleted,
  chargeForPartial,
  createPriceList,
  CREDIT_PACK_PRICE_USD,
  CREDIT_PACK_SIZE,
  creditExamples,
  DEFAULT_PRICE_LIST,
  FREE_FAILURES_PER_DAY,
  isFixedPrice,
  messageQuote,
  planQuotes,
  PRO_FALLBACK_ANNUAL_USD,
  PRO_FALLBACK_MONTHLY_USD,
  PRO_MONTHLY_CREDITS,
  publicQuotes,
  studyKitPartQuote,
  studyKitQuote,
  TRIAL_CREDITS,
  TURN_CREDIT_CAP,
  USAGE_LIMITS,
} from "./price-list";

const HAIKU = "claude-haiku-5-5"; // the configured model (.env.local, QA)
const GLM = "z-ai/glm-5.2"; // the code default: dearer than some list prices

describe("the owner's decisions", () => {
  it("Free is a 300-credit trial, Pro 1,000 credits a paid month, at $7.99 / $39.99", () => {
    expect(TRIAL_CREDITS).toBe(300);
    expect(PRO_MONTHLY_CREDITS).toBe(1000);
    expect(PRO_FALLBACK_MONTHLY_USD).toBe(7.99);
    expect(PRO_FALLBACK_ANNUAL_USD).toBe(39.99);
    expect({ CREDIT_PACK_SIZE, CREDIT_PACK_PRICE_USD }).toEqual({ CREDIT_PACK_SIZE: 1000, CREDIT_PACK_PRICE_USD: 10 });
  });

  it("publishes the action prices: build 30, message 3, study-kit part 10, render 2", () => {
    expect(ACTION_PRICES).toEqual({ build: 30, message: 3, studyKitPart: 10, render: 2 });
  });

  it("keeps Pro's higher limits and per-message ceiling", () => {
    expect(TURN_CREDIT_CAP).toEqual({ free: 30, pro: 100 });
    for (const kind of ["generate", "agent", "study_kit", "sandbox_run"] as const) {
      expect(USAGE_LIMITS[kind].pro).toBeGreaterThan(USAGE_LIMITS[kind].free);
    }
  });
});

describe("quotes on the configured model (real cost within the list price)", () => {
  it("every action is charged exactly its list price", () => {
    expect(buildQuote(HAIKU)).toEqual({ list: 30, price: 30, max: 30 });
    expect(studyKitPartQuote(HAIKU)).toEqual({ list: 10, price: 10, max: 10 });
    expect(isFixedPrice(buildQuote(HAIKU))).toBe(true);
    expect(isFixedPrice(studyKitPartQuote(HAIKU))).toBe(true);
    // A message is priced at 3; a long request can reach the ceiling.
    expect(messageQuote(HAIKU, "free")).toEqual({ list: 3, price: 3, max: 30 });
    expect(messageQuote(HAIKU, "pro")).toEqual({ list: 3, price: 3, max: 100 });
  });

  it("a study kit is parts times the part price", () => {
    expect(studyKitQuote(4, HAIKU)).toEqual({ list: 40, price: 40, max: 40 });
    expect(studyKitQuote(0, HAIKU)).toEqual({ list: 0, price: 0, max: 0 });
  });
});

describe("quotes on a model expensive enough to exceed a list price", () => {
  it("a build is shown and charged its real cost, with the most it can cost", () => {
    const q = buildQuote(GLM);
    expect(q.list).toBe(30);
    expect(q.price).toBeGreaterThan(30);
    expect(q.max).toBeGreaterThan(q.price);
    expect(isFixedPrice(q)).toBe(false);
  });

  it("an assistant message's price follows the model, never above the ceiling", () => {
    expect(messageQuote(GLM, "free").price).toBeGreaterThan(3);
    expect(messageQuote("claude-opus-5-5", "free").price).toBeLessThanOrEqual(TURN_CREDIT_CAP.free);
  });

  it("a study-kit part keeps its list price as a floor and shows how high it can go", () => {
    const part = studyKitPartQuote(GLM);
    expect(part.price).toBe(10); // a typical part costs less than 10 on GLM
    expect(part.max).toBeGreaterThan(10); // a part at its limits costs more
  });

  it("the public page shows the dearer of the two plans' models", () => {
    const q = publicQuotes({ free: HAIKU, pro: GLM });
    expect(q.build).toEqual(buildQuote(GLM));
    expect(q.message.max).toBe(TURN_CREDIT_CAP.pro);
  });
});

describe("what a run is charged", () => {
  const fixed = { list: 30, price: 30, max: 30 };
  const dear = { list: 30, price: 44, max: 90 };

  it("completed: the list price whatever the model used, when it stayed within it", () => {
    expect(chargeForCompleted(fixed, 1)).toBe(30);
    expect(chargeForCompleted(fixed, 29)).toBe(30);
    // Real cost above the max of a fixed quote is absorbed, not passed on.
    expect(chargeForCompleted(fixed, 80)).toBe(30);
  });

  it("completed on a dear model: the real cost, never above the max shown", () => {
    expect(chargeForCompleted(dear, 41)).toBe(41);
    expect(chargeForCompleted(dear, 10)).toBe(30);
    expect(chargeForCompleted(dear, 500)).toBe(90);
  });

  it("nothing when no model ran (the local mock)", () => {
    expect(chargeForCompleted(fixed, 0)).toBe(0);
    expect(chargeForPartial(fixed, 0, 0.5)).toBe(0);
  });

  it("stopped part-way: the share of the list price completed, never more than it", () => {
    expect(chargeForPartial(fixed, 1, 0.5)).toBe(15);
    expect(chargeForPartial(fixed, 1, 0.01)).toBe(1);
    expect(chargeForPartial(fixed, 2, 3)).toBe(30);
    expect(chargeForPartial({ list: 100, price: 100, max: 100 }, 5, 3 / 10)).toBe(30); // 3 of 10 kit parts
  });

  it("stopped on a dear model after spending more than the list price: the real cost, capped", () => {
    expect(chargeForPartial(dear, 35, 0.4)).toBe(35);
    expect(chargeForPartial(dear, 200, 0.4)).toBe(90);
  });

  it("a typical build's spend is the base of a stopped build's share", () => {
    expect(buildTypicalUsd(HAIKU)).toBeGreaterThan(0);
    expect(buildTypicalUsd(GLM)).toBeGreaterThan(buildTypicalUsd(HAIKU));
  });
});

describe("examples computed from the prices", () => {
  it("what a month of Pro covers on the configured model", () => {
    const e = creditExamples(PRO_MONTHLY_CREDITS, planQuotes(HAIKU, "pro"));
    expect(e).toMatchObject({ builds: 33, parts: 100, messages: 333 });
    const spent = e.mix.builds * 30 + e.mix.parts * 10 + e.mix.messages * 3;
    expect(spent).toBeLessThanOrEqual(PRO_MONTHLY_CREDITS);
    expect(PRO_MONTHLY_CREDITS - spent).toBeLessThan(3);
  });

  it("the trial covers at least one build", () => {
    const e = creditExamples(TRIAL_CREDITS, planQuotes(HAIKU, "free"));
    expect(e.mix.builds).toBeGreaterThanOrEqual(1);
    expect(e.mix.builds * 30 + e.mix.parts * 10 + e.mix.messages * 3).toBeLessThanOrEqual(TRIAL_CREDITS);
  });
});

describe("a price list built from other numbers follows them", () => {
  it("every export comes from the config", () => {
    const other = createPriceList({
      ...DEFAULT_PRICE_LIST,
      trialCredits: 123,
      actions: { build: 41, message: 7, studyKitPart: 13, render: 5 },
    });
    expect(other.TRIAL_CREDITS).toBe(123);
    expect(other.buildQuote(HAIKU).list).toBe(41);
    expect(other.messageQuote(HAIKU, "free").list).toBe(7);
    expect(other.studyKitQuote(2, HAIKU).list).toBe(26);
    expect(other.RENDER_CREDITS).toBe(5);
  });
});

describe("README", () => {
  const readme = readFileSync(path.join(process.cwd(), "README.md"), "utf8");
  const section = readme.slice(readme.indexOf("## Pricing"), readme.indexOf("## Development"));
  const n = (v: number) => v.toLocaleString("en-US");

  it("states the module's plans and prices", () => {
    expect(section).toContain(`gets ${n(TRIAL_CREDITS)} credits once`);
    expect(section).toContain(`$${PRO_FALLBACK_MONTHLY_USD} a month or $${PRO_FALLBACK_ANNUAL_USD} a year`);
    expect(section).toContain(`${n(PRO_MONTHLY_CREDITS)}\n  credits for every paid month`);
    expect(section).toContain(`(${TURN_CREDIT_CAP.free} credits on Free, ${TURN_CREDIT_CAP.pro} on Pro)`);
    expect(section).toContain(`${n(CREDIT_PACK_SIZE)} credits for $${CREDIT_PACK_PRICE_USD}`);
    expect(section).toContain(`up to ${FREE_FAILURES_PER_DAY} a day`);
    expect(section).toContain(`cost more than ${ACTION_PRICES.message}`);
  });

  it("its price table is the module's price list, row for row", () => {
    const rows = [...section.matchAll(/^\| ([^|]+?) \| (\d+) \|$/gm)].map((m) => Number(m[2]));
    expect(rows).toEqual([ACTION_PRICES.build, ACTION_PRICES.message, ACTION_PRICES.studyKitPart, ACTION_PRICES.render]);
  });

  it("says nothing about a free monthly top-up or the old price", () => {
    expect(section).not.toMatch(/once a month|under 150|\$5 a month/);
  });
});
