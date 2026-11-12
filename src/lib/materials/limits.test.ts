import { describe, expect, it } from "vitest";
import { studyKitCost } from "@/lib/credits-info";
import { kitTargets, planRun, sectionQuotas, MAX_SECTIONS_PER_RUN, SECTION_TARGET_CHARS } from "./limits";

describe("planRun", () => {
  it("packs whole pages into sections of about the target size", () => {
    const plan = planRun([5000, 5000, 5000, 5000, 5000], undefined, { target: 10_000 });
    expect(plan.sections.map((s) => [s.from, s.to])).toEqual([
      [1, 2],
      [3, 4],
      [5, 5],
    ]);
    expect(plan).toMatchObject({ from: 1, to: 5, cutShort: false, chars: 25_000 });
  });

  it("never splits a page and gives an oversized page its own section", () => {
    const plan = planRun([1000, 30_000, 1000], undefined, { target: 10_000 });
    expect(plan.sections.map((s) => [s.from, s.to])).toEqual([
      [1, 1],
      [2, 2],
      [3, 3],
    ]);
  });

  it("carries empty pages (picture slides) along without making empty sections", () => {
    const plan = planRun([0, 0, 4000, 0, 4000], undefined, { target: 6000 });
    expect(plan.sections.map((s) => [s.from, s.to])).toEqual([
      [1, 4],
      [5, 5],
    ]);
    expect(planRun([0, 0, 0]).sections).toEqual([]);
  });

  it("stops after the section cap and says where the next run should start", () => {
    const pages = Array.from({ length: 40 }, () => SECTION_TARGET_CHARS);
    const plan = planRun(pages);
    expect(plan.sections).toHaveLength(MAX_SECTIONS_PER_RUN);
    expect(plan).toMatchObject({ from: 1, to: MAX_SECTIONS_PER_RUN, cutShort: true });
    const next = planRun(pages, { from: plan.to + 1 });
    expect(next.sections[0].from).toBe(MAX_SECTIONS_PER_RUN + 1);
  });

  it("respects and clamps the chosen page range", () => {
    const pages = [100, 200, 300, 400];
    expect(planRun(pages, { from: 2, to: 3 })).toMatchObject({ from: 2, to: 3, chars: 500 });
    expect(planRun(pages, { from: -5, to: 99 })).toMatchObject({ from: 1, to: 4 });
    expect(planRun(pages, { from: 3, to: 1 })).toMatchObject({ from: 3, to: 3 });
  });
});

describe("sectionQuotas", () => {
  it("splits a total in proportion to section length, summing exactly", () => {
    const quotas = sectionQuotas([{ chars: 1000 }, { chars: 3000 }, { chars: 1000 }], 10);
    expect(quotas).toEqual([2, 6, 2]);
    const odd = sectionQuotas([{ chars: 1 }, { chars: 1 }, { chars: 1 }], 10);
    expect(odd.reduce((a, b) => a + b, 0)).toBe(10);
  });
});

describe("kitTargets and cost", () => {
  it("scales the amount down for short material and to zero for kinds not asked for", () => {
    const outputs = { notes: true, flashcards: true, quiz: false };
    expect(kitTargets("many", outputs, 200_000)).toEqual({ cards: 45, questions: 0 });
    expect(kitTargets("many", outputs, 3500).cards).toBe(10);
    expect(kitTargets("few", { notes: false, flashcards: false, quiz: true }, 100).questions).toBe(3);
  });

  it("states a typical cost and a hard cap per section", () => {
    expect(studyKitCost(3)).toEqual({ estimate: 27, max: 60, minBalance: 27 });
    expect(studyKitCost(0)).toEqual({ estimate: 0, max: 0, minBalance: 0 });
  });

  it("needs at least one section's full cap to start, so a few credits never buy a section", () => {
    expect(studyKitCost(1)).toMatchObject({ estimate: 9, max: 20, minBalance: 20 });
    expect(studyKitCost(2).minBalance).toBe(20);
  });
});
