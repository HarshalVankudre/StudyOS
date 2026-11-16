import { describe, expect, test } from "vitest";
import {
  formatGermanGrade,
  germanAverage,
  gradeToTenths,
  isPassingGrade,
  neededAverage,
  parseGermanGrade,
  type GermanModule,
} from "./german";

const m = (ects: number | null, grade: number | null, counts?: boolean): GermanModule =>
  counts === undefined ? { ects, grade } : { ects, grade, counts };

describe("reading a grade", () => {
  test.each([
    ["1,7", 1.7],
    ["1.7", 1.7],
    ["2", 2],
    ["2,0", 2],
    [" 1,3 ", 1.3],
    ["1,5", 1.5],
    ["4,0", 4],
    ["5,0", 5],
    ["4,3", 4.3],
    ["١٫٧", 1.7],
  ])("%s is %s", (text, grade) => {
    expect(parseGermanGrade(text)).toBe(grade);
  });

  test.each(["", "0,7", "0", "6", "5,1", "1,75", "1,", "gut", "1/2", "-1,0", "NaN", "1e0"])("%s is not a grade", (text) => {
    expect(parseGermanGrade(text)).toBeNull();
  });

  test("passing is 4,0 or better", () => {
    expect(isPassingGrade(4)).toBe(true);
    expect(isPassingGrade(1)).toBe(true);
    expect(isPassingGrade(4.3)).toBe(false);
    expect(isPassingGrade(5)).toBe(false);
    expect(gradeToTenths(1.3)).toBe(13);
    expect(gradeToTenths(1.35)).toBeNull();
  });

  test("is written the student's way", () => {
    expect(formatGermanGrade(1.8, "de")).toBe("1,8");
    expect(formatGermanGrade(2, "en")).toBe("2.0");
    expect(formatGermanGrade(1.89, "de", 2)).toBe("1,89");
  });
});

describe("the average", () => {
  test("is weighted by credits and cut, not rounded, after the first decimal", () => {
    // (2,3 x 9 + 1,7 x 6) / 15 = 2,06
    const a = germanAverage([m(9, 2.3), m(6, 1.7)]);
    expect(a.mean).toBeCloseTo(2.06);
    expect(a.shown).toBe(2);
    expect(a.unrounded).toBe(2.06);
    expect(a.weighting).toBe("ects");
    expect(a.earnedEcts).toBe(15);
  });

  test("1,85 is a 1,8 and 1,9 is a 1,9", () => {
    expect(germanAverage([m(5, 1.7), m(5, 2.0)]).shown).toBe(1.8);
    expect(germanAverage([m(5, 1.7), m(5, 2.0)]).unrounded).toBe(1.85);
    expect(germanAverage([m(5, 1.8), m(5, 2.0)]).shown).toBe(1.9);
  });

  test("floating point never pushes an exact tenth below itself", () => {
    // Plain float division gives 1,0999... for both, which a naive cut reads as 1,0.
    expect(germanAverage([m(6, 1.0), m(6, 1.2)]).shown).toBe(1.1);
    expect(germanAverage([m(4, 1.0), m(2, 1.3)]).shown).toBe(1.1);
    expect(germanAverage([m(7.5, 1.3), m(7.5, 1.3), m(7.5, 1.3)]).shown).toBe(1.3);
  });

  test("a single module is its own average", () => {
    const a = germanAverage([m(30, 1.3)]);
    expect(a.shown).toBe(1.3);
    expect(a.passed).toBe(1);
  });

  test("a failed module is not counted and earns no credits", () => {
    const a = germanAverage([m(9, 2.3), m(6, 5.0), m(6, null)]);
    expect(a.shown).toBe(2.3);
    expect(a.failed).toBe(1);
    expect(a.passed).toBe(1);
    expect(a.open).toBe(1);
    expect(a.earnedEcts).toBe(9);
    expect(a.openEcts).toBe(6);
  });

  test("all failed: no average yet", () => {
    const a = germanAverage([m(6, 5.0), m(6, 4.7)]);
    expect(a.mean).toBeNull();
    expect(a.shown).toBeNull();
    expect(a.failed).toBe(2);
    expect(a.earnedEcts).toBe(0);
  });

  test("a passed module without credits makes every module count the same, and says so", () => {
    const a = germanAverage([m(9, 1.0), m(null, 3.0)]);
    expect(a.weighting).toBe("equal");
    expect(a.passedWithoutEcts).toBe(1);
    expect(a.shown).toBe(2);
    // Zero credits are as good as none.
    expect(germanAverage([m(0, 1.0), m(9, 3.0)]).weighting).toBe("equal");
  });

  test("a module that does not count is left out", () => {
    const a = germanAverage([m(9, 1.0), m(6, 3.0, false)]);
    expect(a.shown).toBe(1);
    expect(a.excluded).toBe(1);
    expect(a.earnedEcts).toBe(9);
  });

  test("half credits count exactly", () => {
    const a = germanAverage([m(7.5, 1.7), m(2.5, 2.3)]);
    // (17 x 7,5 + 23 x 2,5) / 10 = 18,5 tenths
    expect(a.unrounded).toBe(1.85);
    expect(a.shown).toBe(1.8);
    expect(a.earnedEcts).toBe(10);
  });
});

describe("what the open modules need", () => {
  const bachelor = [m(9, 2.3), m(6, 1.7), m(6, 5.0), m(6, 2.0), m(6, null), m(9, null)];

  test("the average needed across the open credits, one tenth worse would miss", () => {
    // Passed: (23 x 9 + 17 x 6 + 20 x 6) / 21 = 2,04; open: 15 LP.
    expect(neededAverage(bachelor, 2.0)).toEqual({ kind: "needed", grade: 2.1 });
    const at = (grade: number) =>
      germanAverage([...bachelor.filter((x) => x.grade !== null), m(6, grade), m(9, grade)]).shown;
    expect(at(2.1)).toBe(2.0);
    expect(at(2.2)).toBe(2.1);
  });

  test("exactly on target counts as reached", () => {
    // 1,7 and 2,0 at 5 LP give 1,85, reported as 1,8.
    expect(neededAverage([m(5, 1.7), m(5, 2.0)], 1.8)).toEqual({ kind: "complete", reached: true, shown: 1.8 });
    expect(neededAverage([m(5, 1.8), m(5, 2.0)], 1.8)).toEqual({ kind: "complete", reached: false, shown: 1.9 });
    // One open module: 1,7 (5 LP) so far; a 2,0 in the open 5 LP gives 1,85 (a 1,8), a 2,1 gives 1,9.
    expect(neededAverage([m(5, 1.7), m(5, null)], 1.8)).toEqual({ kind: "needed", grade: 2.0 });
    expect(germanAverage([m(5, 1.7), m(5, 2.0)]).shown).toBe(1.8);
    expect(germanAverage([m(5, 1.7), m(5, 2.1)]).shown).toBe(1.9);
  });

  test("secured even with 4,0 in everything left", () => {
    expect(neededAverage([m(170, 1.0), m(10, null)], 1.2)).toEqual({ kind: "secured" });
    // Nothing graded yet and the target is a pass: passing everything is enough.
    expect(neededAverage([m(6, null)], 4.0)).toEqual({ kind: "secured" });
  });

  test("out of reach even with 1,0 in everything left, with the best still possible", () => {
    expect(neededAverage([m(150, 3.0), m(30, null)], 1.5)).toEqual({ kind: "unreachable", best: 2.6 });
  });

  test("nothing open: the average is final", () => {
    expect(neededAverage([m(6, 1.3)], 1.5)).toEqual({ kind: "complete", reached: true, shown: 1.3 });
    expect(neededAverage([m(6, 5.0)], 3.0)).toEqual({ kind: "complete", reached: false, shown: null });
    expect(neededAverage([], 2.0)).toEqual({ kind: "empty" });
  });

  test("credits missing on an open or passed module: cannot say", () => {
    expect(neededAverage([m(6, 2.0), m(null, null)], 2.0)).toEqual({ kind: "missingEcts", count: 1 });
    expect(neededAverage([m(null, 2.0), m(6, null), m(0, null)], 2.0)).toEqual({ kind: "missingEcts", count: 2 });
  });

  test("failed modules are not open: a retake is entered as an open module", () => {
    expect(neededAverage([m(6, 2.0), m(6, 5.0)], 2.0)).toEqual({ kind: "complete", reached: true, shown: 2.0 });
  });

  test("a target must be a passing grade in tenths", () => {
    expect(neededAverage(bachelor, 4.3)).toBeNull();
    expect(neededAverage(bachelor, 1.75)).toBeNull();
    expect(neededAverage(bachelor, 0.5)).toBeNull();
  });
});
