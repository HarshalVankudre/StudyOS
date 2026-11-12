import { describe, expect, it } from "vitest";
import {
  computeCourseGrade,
  courseRisk,
  parseLocaleNumber,
  parseScoreInput,
  summarizeCourses,
  type GradeItemInput,
} from "./calc";

let n = 0;
function item(weight: number | null, score: number | null = null, maxScore: number | null = null): GradeItemInput {
  n += 1;
  return { id: `i${n}`, name: `Item ${n}`, weight, score, maxScore };
}

describe("computeCourseGrade: the normal case", () => {
  it("weights adding to 100: current grade, decided share and what is needed", () => {
    const g = computeCourseGrade([item(20, 90), item(30, 80), item(50)], { target: 85 });
    // (20*90 + 30*80) / 50 = 84
    expect(g.current).toBeCloseTo(84);
    expect(g.decidedShare).toBeCloseTo(0.5);
    expect(g.remainingWeight).toBeCloseTo(50);
    expect(g.floor).toBeCloseTo(42);
    expect(g.ceiling).toBeCloseTo(92);
    expect(g.final).toBeNull();
    // (85*100 - 4200) / 50 = 86
    expect(g.outlook).toEqual({ kind: "needed", average: expect.closeTo(86, 6) });
    expect(g.notes).toEqual([]);
    expect(g.mode).toBe("weights");
    expect(g.remainingCount).toBe(1);
  });

  it("scores out of a maximum become percentages", () => {
    const g = computeCourseGrade([item(50, 42, 50), item(50, 9, 10)]);
    expect(g.items.map((i) => i.percent)).toEqual([84, 90]);
    expect(g.final).toBeCloseTo(87);
    expect(g.current).toBeCloseTo(87);
  });

  it("an empty maximum means the score is already a percentage", () => {
    const g = computeCourseGrade([item(100, 77, null)]);
    expect(g.current).toBe(77);
  });

  it("no target: no outlook, numbers still there", () => {
    const g = computeCourseGrade([item(40, 70), item(60)]);
    expect(g.outlook).toBeNull();
    expect(g.current).toBe(70);
  });
});

describe("computeCourseGrade: awkward cases stay honest", () => {
  it("no scores yet: no current grade; you need the target on everything", () => {
    const g = computeCourseGrade([item(40), item(60)], { target: 75 });
    expect(g.current).toBeNull();
    expect(g.decidedShare).toBe(0);
    expect(g.floor).toBe(0);
    expect(g.ceiling).toBe(100);
    expect(g.outlook).toEqual({ kind: "needed", average: 75 });
  });

  it("weights summing to less than 100 are treated as the whole course and flagged", () => {
    const g = computeCourseGrade([item(30, 80), item(50)], { target: 70 });
    expect(g.totalWeight).toBe(80);
    expect(g.notes).toContainEqual({ code: "weights_sum", sum: 80 });
    // (70*80 - 30*80) / 50 = 64
    expect(g.outlook).toEqual({ kind: "needed", average: expect.closeTo(64, 6) });
  });

  it("weights summing to more than 100 are scaled and flagged", () => {
    const g = computeCourseGrade([item(60, 100), item(60, 50)]);
    expect(g.notes).toContainEqual({ code: "weights_sum", sum: 120 });
    expect(g.final).toBeCloseTo(75);
  });

  it("items without a weight share the leftover weight", () => {
    const g = computeCourseGrade([item(60, 80), item(null, 100), item(null)], { target: 80 });
    expect(g.notes).toContainEqual({ code: "unweighted_split", count: 2, each: 20 });
    expect(g.items.map((i) => i.weight)).toEqual([60, 20, 20]);
    expect(g.totalWeight).toBe(100);
    expect(g.notes.some((x) => x.code === "weights_sum")).toBe(false);
    // (60*80 + 20*100) / 80 = 85
    expect(g.current).toBeCloseTo(85);
  });

  it("items without a weight are left out when nothing is left over", () => {
    const g = computeCourseGrade([item(50, 80), item(50, 60), item(null, 0)]);
    expect(g.notes).toContainEqual({ code: "unweighted_ignored", count: 1 });
    expect(g.items[2].counted).toBe(false);
    expect(g.final).toBeCloseTo(70);
  });

  it("a weight of 0 is deliberate: not counted, not flagged as missing", () => {
    const g = computeCourseGrade([item(100, 70), item(0, 10)]);
    expect(g.notes).toEqual([]);
    expect(g.final).toBe(70);
  });

  it("no weights but points: a points-based course", () => {
    const g = computeCourseGrade([item(null, 45, 50), item(null, 30, 50), item(null, null, 100)], { target: 80 });
    expect(g.mode).toBe("points");
    expect(g.notes).toContainEqual({ code: "points_based" });
    expect(g.totalWeight).toBe(200);
    // 75 / 100 points so far
    expect(g.current).toBeCloseTo(75);
    // need (0.8*200 - 75) / 100 = 85 %
    expect(g.outlook).toEqual({ kind: "needed", average: expect.closeTo(85, 6) });
  });

  it("no weights and no points: every item counts the same", () => {
    const g = computeCourseGrade([item(null, 60), item(null, 80), item(null)]);
    expect(g.mode).toBe("equal");
    expect(g.notes).toContainEqual({ code: "equal_weights" });
    expect(g.current).toBe(70);
    expect(g.decidedShare).toBeCloseTo(2 / 3);
  });

  it("extra credit above 100 is kept and flagged", () => {
    const g = computeCourseGrade([item(50, 110), item(50, 90)]);
    expect(g.final).toBe(100);
    expect(g.notes).toContainEqual({ code: "extra_credit" });
  });

  it("extra credit can make the needed average fall below what is left", () => {
    const g = computeCourseGrade([item(50, 120), item(50)], { target: 50 });
    expect(g.outlook).toEqual({ kind: "secured" });
  });

  it("a score out of 0 is unreadable: kept as not graded, flagged", () => {
    const g = computeCourseGrade([item(50, 8, 0), item(50, 90)]);
    expect(g.notes).toContainEqual({ code: "invalid_max", count: 1 });
    expect(g.items[0].percent).toBeNull();
    expect(g.totalWeight).toBe(100);
    expect(g.current).toBe(90);
  });

  it("all weights 0 reads as no weights (a placeholder), not as nothing counts", () => {
    const g = computeCourseGrade([item(0, 80), item(0)], { target: 50 });
    expect(g.mode).toBe("equal");
    expect(g.current).toBe(80);
    expect(g.notes).toContainEqual({ code: "equal_weights" });
  });

  it("an empty course has no notes and no numbers", () => {
    const g = computeCourseGrade([], { target: 50 });
    expect(g.current).toBeNull();
    expect(g.notes).toEqual([]);
  });
});

describe("computeCourseGrade: outlooks", () => {
  it("secured: even 0 on the rest reaches the target", () => {
    const g = computeCourseGrade([item(80, 95), item(20)], { target: 70 });
    expect(g.outlook).toEqual({ kind: "secured" });
  });

  it("secured exactly at the boundary", () => {
    const g = computeCourseGrade([item(70, 100), item(30)], { target: 70 });
    expect(g.outlook).toEqual({ kind: "secured" });
  });

  it("unreachable: even 100 on the rest falls short", () => {
    const g = computeCourseGrade([item(70, 50), item(30)], { target: 90 });
    // (90*100 - 3500) / 30 = 183.3
    expect(g.outlook).toEqual({
      kind: "unreachable",
      average: expect.closeTo(183.33, 1),
      best: expect.closeTo(65, 6),
    });
  });

  it("needing exactly 100 is still reachable", () => {
    const g = computeCourseGrade([item(50, 80), item(50)], { target: 90 });
    expect(g.outlook).toEqual({ kind: "needed", average: expect.closeTo(100, 6) });
  });

  it("all graded: met or missed with the final grade", () => {
    expect(computeCourseGrade([item(100, 81)], { target: 80 }).outlook).toEqual({ kind: "met", final: 81 });
    expect(computeCourseGrade([item(100, 79)], { target: 80 }).outlook).toEqual({ kind: "missed", final: 79 });
  });
});

describe("computeCourseGrade: what if", () => {
  it("hypothetical scores fill ungraded items without touching real ones", () => {
    const a = item(50, 80);
    const b = item(50);
    const real = computeCourseGrade([a, b], { target: 85 });
    const whatIf = computeCourseGrade([a, b], { target: 85, whatIf: { [b.id]: 95, [a.id]: 10 } });
    expect(real.final).toBeNull();
    expect(whatIf.final).toBeCloseTo(87.5);
    expect(whatIf.items[0]).toMatchObject({ percent: 80, hypothetical: false });
    expect(whatIf.items[1]).toMatchObject({ percent: 95, hypothetical: true });
    expect(whatIf.outlook).toEqual({ kind: "met", final: expect.closeTo(87.5, 6) });
  });

  it("a partial what-if recomputes what the rest needs", () => {
    const [a, b, c] = [item(40, 70), item(30), item(30)];
    const g = computeCourseGrade([a, b, c], { target: 80, whatIf: { [b.id]: 90 } });
    // (80*100 - 2800 - 2700) / 30 = 83.3
    expect(g.outlook).toEqual({ kind: "needed", average: expect.closeTo(83.33, 1) });
  });
});

describe("courseRisk", () => {
  it("ranks courses for the planner", () => {
    expect(courseRisk(computeCourseGrade([item(100)]))).toBe("unknown");
    expect(courseRisk(computeCourseGrade([item(80, 95), item(20)], { target: 70 }))).toBe("safe");
    expect(courseRisk(computeCourseGrade([item(70, 50), item(30)], { target: 90 }))).toBe("critical");
    expect(courseRisk(computeCourseGrade([item(50, 80), item(50)], { target: 82 }))).toBe("on_track");
    expect(courseRisk(computeCourseGrade([item(50, 70), item(50)], { target: 82 }))).toBe("at_risk");
    expect(courseRisk(computeCourseGrade([item(100)], { target: 92 }))).toBe("at_risk");
    expect(courseRisk(computeCourseGrade([item(100, 60)], { target: 70 }))).toBe("critical");
  });
});

describe("summarizeCourses", () => {
  it("weights by credits when every graded course has them", () => {
    const s = summarizeCourses([
      { key: "a", percent: 90, points: 3.7, credits: 4 },
      { key: "b", percent: 70, points: 1.7, credits: 2 },
      { key: "c", percent: null, points: null, credits: 3 },
    ]);
    expect(s.weighting).toBe("credits");
    expect(s.average).toBeCloseTo((90 * 4 + 70 * 2) / 6);
    expect(s.points).toBeCloseTo((3.7 * 4 + 1.7 * 2) / 6);
    expect(s.credits).toBe(6);
    expect(s.counted).toBe(2);
    expect(s.ungraded).toBe(1);
    expect(s.missingCredits).toEqual([]);
  });

  it("falls back to equal weight and names courses missing credits", () => {
    const s = summarizeCourses([
      { key: "a", percent: 90, points: null, credits: 4 },
      { key: "b", percent: 70, points: null, credits: null },
    ]);
    expect(s.weighting).toBe("equal");
    expect(s.average).toBe(80);
    expect(s.points).toBeNull();
    expect(s.missingCredits).toEqual(["b"]);
  });

  it("no credits anywhere: equal weight without complaint", () => {
    const s = summarizeCourses([
      { key: "a", percent: 60, points: null, credits: null },
      { key: "b", percent: 80, points: null, credits: null },
    ]);
    expect(s.weighting).toBe("equal");
    expect(s.missingCredits).toEqual([]);
  });

  it("nothing graded: no average", () => {
    const s = summarizeCourses([{ key: "a", percent: null, points: null, credits: 3 }]);
    expect(s.average).toBeNull();
    expect(s.points).toBeNull();
    expect(s.counted).toBe(0);
  });
});

describe("parseScoreInput", () => {
  it.each([
    ["87", { kind: "score", score: 87 }],
    ["87.5", { kind: "score", score: 87.5 }],
    ["87,5", { kind: "score", score: 87.5 }],
    [" 87 % ", { kind: "score", score: 87 }],
    ["42/50", { kind: "score", score: 42, maxScore: 50 }],
    ["42 / 50,5", { kind: "score", score: 42, maxScore: 50.5 }],
    ["١٨/٢٠", { kind: "score", score: 18, maxScore: 20 }],
    ["105", { kind: "score", score: 105 }],
    ["", { kind: "clear" }],
    ["  ", { kind: "clear" }],
  ])("reads %j", (text, expected) => {
    expect(parseScoreInput(text)).toEqual(expected);
  });

  it.each(["abc", "1/2/3", "4/0", "-3", "1,000.5", "--1"])("rejects %j", (text) => {
    expect(parseScoreInput(text)).toBeNull();
  });

  it("parseLocaleNumber handles both decimal marks", () => {
    expect(parseLocaleNumber("2,5")).toBe(2.5);
    expect(parseLocaleNumber(".5")).toBe(0.5);
    expect(parseLocaleNumber("x")).toBeNull();
  });
});
