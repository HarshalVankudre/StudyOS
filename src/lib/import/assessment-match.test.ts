import { describe, expect, it } from "vitest";
import { assessmentKey, matchAssessments, type MatchStrength } from "./assessment-match";

describe("assessmentKey", () => {
  it("separates kind, item number and content words", () => {
    const key = assessmentKey("Problem Set 4 (graded)");
    expect([...key.kinds]).toEqual(["homework"]);
    expect(key.numbers).toEqual([4]);
    expect(key.tokens).toEqual(["#homework"]);
  });

  it("reads abbreviations, roman numerals and course codes", () => {
    expect(assessmentKey("PS4").numbers).toEqual([4]);
    expect(assessmentKey("Midterm II").numbers).toEqual([2]);
    // "ECON 201" is the course, not item 201.
    expect(assessmentKey("Final exam — ECON 201").numbers).toEqual([]);
  });

  it("treats 'final' as a qualifier on a deliverable", () => {
    expect([...assessmentKey("Final project").kinds]).toEqual(["project"]);
    expect([...assessmentKey("Final exam").kinds].sort()).toEqual(["exam", "final"]);
  });

  it("finds kind words inside CJK and Arabic runs", () => {
    expect([...assessmentKey("期末考试").kinds].sort()).toEqual(["exam", "final"]);
    expect([...assessmentKey("中間試験").kinds].sort()).toEqual(["exam", "midterm"]);
    expect(assessmentKey("レポート1").kinds.has("paper")).toBe(true);
    expect(assessmentKey("الاختبار النصفي").kinds.has("midterm")).toBe(true);
  });
});

describe("matchAssessments", () => {
  const cases: Array<[syllabus: string, row: string, expected: MatchStrength, dates?: [string, string]]> = [
    // The QA case: the model wrote its own title for the same item.
    ["Problem Set 4", "Problem Set 4 (graded)", "same"],
    // Even the old, broken extracted title must not look like a new item.
    ["Problem Set 4: due Tuesday, (already graded)", "Problem Set 4 (graded)", "same"],
    ["Problem Set 4", "PS 4 – Elasticity", "same"],
    ["Problem Set 4", "Problem Set #4", "same"],
    ["Midterm", "Midterm Exam", "same"],
    ["Final exam", "Final", "same"],
    ["Mid-term exam", "Midterm", "same"],
    ["Group project proposal", "Project proposal", "same"],
    ["final report", "Group Project Final Report", "same"],
    ["Midterm 1", "Midterm Exam 1", "same"],
    // Renamed into the student's language: same kind on the same day.
    ["Midterm exam", "Examen parcial", "same"],
    ["Final exam", "Klausur Mikroökonomik", "same", ["2027-02-10", "2027-02-10"]],
    ["Lab report 2", "Informe de laboratorio 2", "same"],
    ["Übungsblatt 4", "Übungsblatt 4 – Analysis", "same"],
    ["中間試験", "中間試験（生理学）", "same"],
    // The identifying words can sit in brackets (seen live).
    ["final report", "Group project (final report)", "same"],
    ["Lab report 2", "Lab 2", "same"],
    // Clearly different items.
    ["Problem Set 4", "Problem Set 5", "different"],
    ["Midterm 1", "Midterm 2", "different"],
    ["Final exam", "Final project", "different"],
    ["Participation", "Problem Set 4", "different"],
    ["Quiz 7", "Lab 7", "different"],
    // Plausibly the same: neither enrich nor add.
    ["Problem sets", "Problem Set 4", "maybe"],
    ["Weekly quizzes", "Quiz 7", "maybe"],
    ["Midterm", "Midterm 2", "maybe"],
    ["Test 2", "Midterm 2", "maybe"],
    ["Quiz", "Quiz", "maybe", ["2026-11-01", "2026-12-20"]],
    ["Final exam", "Klausur Mikroökonomik", "maybe"],
    ["Group project", "Final report", "maybe"],
  ];

  it.each(cases)("%s vs %s -> %s", (a, b, expected, dates) => {
    expect(matchAssessments(a, b, dates ? { dateA: dates[0], dateB: dates[1] } : {}).strength).toBe(expected);
  });

  it("is symmetric", () => {
    for (const [a, b, expected, dates] of cases) {
      const context = dates ? { dateA: dates[1], dateB: dates[0] } : {};
      expect(matchAssessments(b, a, context).strength, `${b} vs ${a}`).toBe(expected);
    }
  });
});
