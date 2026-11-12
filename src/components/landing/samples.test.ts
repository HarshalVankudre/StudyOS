import { describe, expect, it } from "vitest";
import { en } from "@/lib/i18n/dictionaries/en";
import { renderDay, sampleExams, sampleGrade, sampleTodayItems, weekdayIn } from "./samples";

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
