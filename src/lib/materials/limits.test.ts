import { describe, expect, it } from "vitest";
import { studyKitQuote } from "@/lib/price-list";
import {
  kitTargets,
  planRun,
  sectionQuotas,
  MAX_SECTION_PAGES,
  MAX_SECTIONS_PER_RUN,
  PAGE_MARKER_CHARS,
  SECTION_TARGET_CHARS,
} from "./limits";

describe("planRun", () => {
  it("packs whole pages into sections of about the target size", () => {
    // 4,900 text + 16 marker characters per page: two pages fit in 10,000.
    const plan = planRun([4900, 4900, 4900, 4900, 4900], undefined, { target: 10_000 });
    expect(plan.sections.map((s) => [s.from, s.to])).toEqual([
      [1, 2],
      [3, 4],
      [5, 5],
    ]);
    expect(plan).toMatchObject({ from: 1, to: 5, cutShort: false, chars: 24_500 });
    // Exactly half the target per page no longer fits twice: the markers count.
    expect(planRun([5000, 5000], undefined, { target: 10_000 }).sections).toHaveLength(2);
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

  it("counts page markers, so thousands of tiny pages cannot inflate a section's prompt", () => {
    // The hostile .docx: 266,667 one-character pages (sec2/materials/probe-plan.ts).
    const tiny = Array.from({ length: 266_667 }, () => 1);
    const t0 = performance.now();
    const plan = planRun(tiny);
    expect(performance.now() - t0).toBeLessThan(2000);
    for (const section of plan.sections) {
      expect(section.to - section.from + 1).toBeLessThanOrEqual(MAX_SECTION_PAGES);
      expect(section.promptChars).toBeLessThanOrEqual(SECTION_TARGET_CHARS + 2 * PAGE_MARKER_CHARS);
    }
    expect(plan.sections).toHaveLength(MAX_SECTIONS_PER_RUN);
    expect(plan.cutShort).toBe(true);
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

  it("a run costs the part price for each section it reads (lib/price-list.ts)", () => {
    const run = planRun(Array.from({ length: 30 }, () => 2900));
    expect(studyKitQuote(run.sections.length, "claude-haiku-5-5")).toEqual({ list: 80, price: 80, max: 80 });
    expect(studyKitQuote(0, "claude-haiku-5-5")).toEqual({ list: 0, price: 0, max: 0 });
  });
});
