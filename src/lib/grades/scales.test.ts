import { describe, expect, it } from "vitest";
import {
  GRADE_SCALE_PRESETS,
  bandFor,
  formatGrade,
  formatPercent,
  formatPoints,
  normalizeBands,
  pointsFor,
  presetBands,
  resolveScale,
  targetChoices,
} from "./scales";

describe("presets", () => {
  it("percent: no bands, shows the percentage in the student's locale", () => {
    const s = resolveScale(undefined);
    expect(s.preset).toBe("percent");
    expect(s.bands).toEqual([]);
    expect(bandFor(80, s)).toBeNull();
    expect(formatGrade(87.46, s, "en")).toBe("87.5%");
    expect(formatGrade(87.46, s, "de")).toBe("87,5 %");
    expect(formatGrade(87.46, s, "fr")).toMatch(/^87,5\s%$/);
  });

  it("US letter grades", () => {
    const s = resolveScale("us_letter");
    expect(s.display).toBe("label");
    expect(formatGrade(93, s, "en")).toBe("A");
    expect(formatGrade(92.99, s, "en")).toBe("A-");
    expect(formatGrade(88, s, "en")).toBe("B+");
    expect(formatGrade(59.9, s, "en")).toBe("F");
    expect(formatGrade(130, s, "en")).toBe("A");
    expect(formatGrade(-5, s, "en")).toBe("F");
  });

  it("US GPA points", () => {
    const s = resolveScale("us_gpa");
    expect(s.display).toBe("points");
    expect(formatGrade(91, s, "en")).toBe("3.70");
    expect(pointsFor(84, s)).toBe(3.0);
    expect(formatPoints(3.456, s, "en")).toBe("3.46");
  });

  it("UK degree classifications, with localized class names", () => {
    const s = resolveScale("uk_degree");
    expect(formatGrade(72, s, "en")).toBe("First");
    expect(formatGrade(65, s, "en")).toBe("2:1");
    expect(formatGrade(55, s, "en")).toBe("2:2");
    expect(formatGrade(45, s, "en")).toBe("Third");
    expect(formatGrade(39, s, "en")).toBe("Fail");
    const de = resolveScale("uk_degree", undefined, {
      first: "Erstklassig",
      upperSecond: "2:1",
      lowerSecond: "2:2",
      third: "Dritte",
      fail: "Nicht bestanden",
    });
    expect(formatGrade(39, de, "de")).toBe("Nicht bestanden");
  });

  it("German 1,0 to 5,0 (lower is better, averages are cut not rounded)", () => {
    const s = resolveScale("de_grade");
    expect(s.lowerPointsBetter).toBe(true);
    expect(formatGrade(96, s, "de")).toBe("1,0");
    expect(formatGrade(91, s, "de")).toBe("1,3");
    expect(formatGrade(50, s, "de")).toBe("4,0");
    expect(formatGrade(49.9, s, "de")).toBe("5,0");
    expect(pointsFor(77, s)).toBe(2.3);
    expect(formatPoints(1.79, s, "de")).toBe("1,7");
    expect(formatPoints(2.0, s, "en")).toBe("2.0");
  });

  it("every preset is listed and returns fresh copies", () => {
    expect(GRADE_SCALE_PRESETS).toEqual(["percent", "us_letter", "us_gpa", "uk_degree", "de_grade"]);
    const a = presetBands("us_letter");
    a[0].min = 1;
    expect(presetBands("us_letter")[0].min).toBe(93);
  });
});

describe("editable thresholds", () => {
  it("a block's own bands replace the preset's, sorted best first", () => {
    const s = resolveScale("us_letter", [
      { min: 0, label: "F", points: 0 },
      { min: 85, label: "A", points: 4 },
      { min: 70, label: "B", points: 3 },
    ]);
    expect(s.bands.map((b) => b.label)).toEqual(["A", "B", "F"]);
    expect(formatGrade(86, s, "en")).toBe("A");
    expect(formatGrade(84, s, "en")).toBe("B");
  });

  it("normalizeBands drops non-finite and duplicate thresholds", () => {
    const bands = normalizeBands([
      { min: 50, label: " Pass " },
      { min: Number.NaN, label: "x" },
      { min: 50, label: "dup" },
      { min: 0, label: "Fail" },
    ]);
    expect(bands).toEqual([
      { min: 50, label: "Pass" },
      { min: 0, label: "Fail" },
    ]);
  });

  it("unusable custom bands fall back to the preset", () => {
    expect(resolveScale("de_grade", [{ min: Number.NaN, label: "?" }]).bands).toHaveLength(11);
  });

  it("percent ignores stray bands", () => {
    expect(resolveScale("percent", [{ min: 50, label: "Pass" }]).bands).toEqual([]);
  });

  it("targets offer every band but the lowest", () => {
    const choices = targetChoices(resolveScale("uk_degree"));
    expect(choices.map((b) => b.label)).toEqual(["First", "2:1", "2:2", "Third"]);
  });
});

describe("formatPercent", () => {
  it("rounds to one decimal by default", () => {
    expect(formatPercent(66.666, "en")).toBe("66.7%");
    expect(formatPercent(100, "en")).toBe("100%");
  });
});
