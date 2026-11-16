import { describe, expect, it } from "vitest";
import { planItemSchema } from "@/lib/agents/daily-study/types";
import { de } from "@/lib/i18n/dictionaries/de";
import { en } from "@/lib/i18n/dictionaries/en";
import { germanAverage, neededAverage } from "@/lib/grades/german";
import { renderDay, sampleExams, sampleGermanModules, sampleGrade, sampleTodayItems, weekdayIn } from "./samples";

const S = en.landing.samples;

describe("landing samples", () => {
  it("dates every sample relative to the day the page is rendered", () => {
    for (const today of ["2026-11-12", "2031-02-27"]) {
      const items = sampleTodayItems(S, today);
      const lab = items.find((i) => i.id === "lab")!;
      expect(lab.dueDate! > today).toBe(true);
      expect(lab.carry!.from < today).toBe(true);
      for (const exam of sampleExams(S, today)) expect(exam.date > today).toBe(true);
    }
  });

  it("shows an exam registration closing soon on the German page only", () => {
    const german = sampleTodayItems(de.landing.samples, "2026-11-12");
    expect(german[0]).toMatchObject({
      id: "registration",
      title: de.landing.samples.items.registration,
      kind: "deadline",
      mode: "finish",
      minutes: 10,
      reason: { code: "formality_soon", days: 2 },
      dueDate: "2026-11-14",
    });
    expect(planItemSchema.array().safeParse(german).success).toBe(true);
    expect(sampleTodayItems(S, "2026-11-12").some((i) => i.id === "registration")).toBe(false);
    expect(german.length).toBe(sampleTodayItems(S, "2026-11-12").length + 1);
  });

  it("answers 'what do I need for a 2,0' with the German grade maths", () => {
    const { modules, target } = sampleGermanModules(de.landing.samples);
    const average = germanAverage(modules);
    // (1,7 x 9 + 2,3 x 6) / 15 = 1,94: shown cut off, not rounded.
    expect(average.shown).toBe(1.9);
    expect(average.unrounded).toBe(1.94);
    expect(average.earnedEcts).toBe(15);
    expect(average.openEcts).toBe(6);
    // (29,1 + 6g) / 21 must stay below 2,1: g below 2,5, so 2,4 or better.
    expect(neededAverage(modules, target)).toEqual({ kind: "needed", grade: 2.4 });
  });

  it("renderDay is today's date", () => {
    expect(renderDay(new Date("2027-03-05T10:00:00Z"))).toBe("2027-03-05");
  });

  it("answers 'what do I need on the final' with the real grade math", () => {
    const { grade, target } = sampleGrade(S);
    expect(grade.outlook?.kind).toBe("needed");
    expect(grade.remainingWeight).toBe(40);
    const average = grade.outlook?.kind === "needed" ? grade.outlook.average : NaN;
    // 0.2*92 + 0.15*88 + 0.25*81 = 51.85; (87 - 51.85) / 0.4 = 87.875
    expect(average).toBeCloseTo(87.875, 3);
    expect(target).toBe(87);
  });

  it("names weekdays in the visitor's language", () => {
    expect(weekdayIn("2026-11-12", 1, "en")).toBe("Friday");
    expect(weekdayIn("2026-11-12", 1, "de")).toBe("Freitag");
  });
});
