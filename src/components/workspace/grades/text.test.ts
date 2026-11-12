import { describe, expect, it } from "vitest";
import { en } from "@/lib/i18n/dictionaries/en";
import { fmt } from "@/lib/i18n/interpolate";
import { computeCourseGrade, resolveScale, type GradeItemInput } from "@/lib/grades";
import type { GradeScalePreset } from "@/lib/workspace/types";
import { outlookText, targetText } from "./text";

const G = en.grades;
const aside = (percent: string, grade: string) => fmt(G.targetAside, { percent, grade });

describe("targetText: a grade with its threshold, a percentage as a percentage", () => {
  // [scale, target, expected]: a band's own minimum names the band; anything
  // else names the percentage, with the band it falls in only as information.
  const cases: [GradeScalePreset, number, string][] = [
    ["percent", 80, "80%"],
    ["uk_degree", 70, "First (70%)"],
    ["uk_degree", 80, aside("80%", "First")],
    ["uk_degree", 65, aside("65%", "2:1")],
    ["uk_degree", 60, "2:1 (60%)"],
    ["us_letter", 93, "A (93%)"],
    ["us_letter", 85, aside("85%", "B")],
    ["us_letter", 87, "B+ (87%)"],
    ["us_gpa", 90, "3.70 (90%)"],
    ["us_gpa", 95, aside("95%", "4.00")],
    ["de_grade", 80, "2.0 (80%)"],
    ["de_grade", 82, aside("82%", "2.0")],
  ];
  it.each(cases)("%s target %s", (preset, target, expected) => {
    const scale = resolveScale(preset);
    expect(targetText(target, scale, "en", G, fmt)).toBe(expected);
  });

  it("the arithmetic uses the stored target on every scale", () => {
    const items: GradeItemInput[] = [
      { id: "a", name: "A", weight: 50, score: 60, maxScore: null },
      { id: "b", name: "B", weight: 50, score: null, maxScore: null },
    ];
    for (const preset of ["percent", "us_letter", "us_gpa", "uk_degree", "de_grade"] as const) {
      const scale = resolveScale(preset);
      // 70 needs 80 on the rest; 80 needs 100. Never the band's number in place of the target.
      const at70 = outlookText(computeCourseGrade(items, { target: 70 }), 70, scale, "en", G, fmt);
      const at80 = outlookText(computeCourseGrade(items, { target: 80 }), 80, scale, "en", G, fmt);
      expect(at70, preset).toContain("80%");
      expect(at80, preset).toContain("100%");
      expect(at80, preset).toContain(targetText(80, scale, "en", G, fmt));
    }
    // The UK sentence QA saw: an 80 % target is not "First (80%)".
    const uk = outlookText(computeCourseGrade(items, { target: 80 }), 80, resolveScale("uk_degree"), "en", G, fmt);
    expect(uk).not.toContain("First (80%)");
    expect(uk).toContain(aside("80%", "First"));
  });
});
