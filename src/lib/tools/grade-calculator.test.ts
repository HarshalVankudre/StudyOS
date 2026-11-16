import { describe, expect, test } from "vitest";
import { GRADE_SCALE_PRESETS } from "@/lib/grades/scales";
import {
  calculate,
  calculateModules,
  decodeState,
  defaultModeFor,
  emptyRows,
  encodeState,
  exampleModules,
  exampleState,
  initialState,
  MAX_FRAGMENT_LENGTH,
  MAX_NAME_LENGTH,
  MAX_NUMBER_LENGTH,
  MAX_ROWS,
  MAX_SCORE_LENGTH,
  moduleTarget,
  START_ROWS,
  type CalcRow,
  type CalcState,
} from "./grade-calculator";

const rows = (...list: [weight: string, score: string, name?: string][]): CalcRow[] =>
  list.map(([weight, score, name = ""], id) => ({ id, name, weight, score }));

/** A course-mode state. */
const state = (list: CalcRow[], target = "", scale: CalcState["scale"] = "percent"): CalcState => ({
  ...initialState("course"),
  scale,
  target,
  rows: list,
});

/** An ECTS-mode state (rows: credits ~ grade ~ name). */
const modules = (list: CalcRow[], target = ""): CalcState => ({
  ...initialState("ects"),
  modules: { target, rows: list },
});

const NAMES = { problemSets: "Problem sets", labs: "Lab reports", midterm: "Midterm", final: "Final exam" };
const MODULES = {
  math: "Mathematik I",
  programming: "Programmierung",
  theory: "Theoretische Informatik",
  databases: "Datenbanken",
  statistics: "Statistik",
  softwareEngineering: "Softwaretechnik",
};

describe("the mode", () => {
  test("German visitors start with the grade average, everyone else with one course", () => {
    expect(defaultModeFor("de")).toBe("ects");
    for (const locale of ["en", "es", "fr", "it", "pt", "nl", "zh", "ja", "ar"]) expect(defaultModeFor(locale)).toBe("course");
    expect(initialState("ects").mode).toBe("ects");
  });

  test("a link names its mode, so it opens the same way in every language", () => {
    const s = state(rows(["20", "92", "Essay"]));
    const fragment = encodeState(s, "course");
    expect(fragment).toBe("m=course&r=20~92~Essay");
    expect(decodeState(fragment, "ects")).toEqual(s);
    const m = modules(rows(["9", "2,3", "Mathematik I"]), "2.0");
    expect(encodeState(m, "ects")).toBe("m=ects&t=2.0&r=9~2,3~Mathematik+I");
    expect(decodeState(encodeState(m, "ects"), "course")).toEqual(m);
  });

  test("a blank calculator in the visitor's default mode has no fragment; in the other mode it keeps the mode", () => {
    expect(encodeState(initialState("course"), "course")).toBe("");
    expect(encodeState(initialState("ects"), "ects")).toBe("");
    expect(encodeState(initialState("ects"), "course")).toBe("m=ects");
    expect(decodeState("#m=ects", "course")).toEqual(initialState("ects"));
  });

  test("a fragment without a mode opens in the visitor's default", () => {
    expect(decodeState("#r=9~1,7~Analysis", "ects").modules.rows).toEqual(rows(["9", "1,7", "Analysis"]));
    expect(decodeState("#r=9~1,7~Analysis", "course").rows).toEqual(rows(["9", "1,7", "Analysis"]));
  });

  test("only the mode on screen goes into the address", () => {
    const both: CalcState = { ...state(rows(["50", "80", "Essay"])), modules: { target: "2.0", rows: rows(["6", "1,3", "Statistik"]) } };
    expect(encodeState(both, "course")).toBe("m=course&r=50~80~Essay");
    expect(encodeState({ ...both, mode: "ects" }, "course")).toBe("m=ects&t=2.0&r=6~1,3~Statistik");
  });

  test("an ECTS target is a passing grade or nothing", () => {
    expect(decodeState("#m=ects&t=1,7", "course").modules.target).toBe("1.7");
    expect(decodeState("#m=ects&t=4", "course").modules.target).toBe("4.0");
    for (const bad of ["4,3", "5,0", "0,5", "1,75", "abc", "%ZZ"]) {
      expect(decodeState(`#m=ects&t=${bad}`, "course").modules.target, bad).toBe("");
    }
    expect(moduleTarget(" 2,0 ")).toBe("2.0");
  });
});

describe("the address", () => {
  test("a blank calculator has no fragment, and no fragment is a blank calculator", () => {
    expect(decodeState("", "course")).toEqual(initialState("course"));
    expect(decodeState("#", "ects")).toEqual(initialState("ects"));
    expect(initialState().rows).toHaveLength(START_ROWS);
    expect(initialState().modules.rows).toHaveLength(START_ROWS);
  });

  test("is short and readable", () => {
    const s = state(rows(["20", "92", "Problem sets"], ["25", "42/50", "Midterm"], ["40", "", "Final"]), "87", "us_letter");
    expect(encodeState(s, "course")).toBe("m=course&s=us_letter&t=87&r=20~92~Problem+sets&r=25~42/50~Midterm&r=40~~Final");
  });

  test("round-trips what was typed, character for character", () => {
    const list = rows(
      ["12,5 %", "42,5 / 50", "Labs & quizzes = 10% #1"],
      ["", "84%", "a~b~c + d"],
      ["30", "", "Prüfung 🎓 مختبر"],
      ["", "", "  spaced  "],
      ["0", "100/0", "100% sure?"],
    );
    const s = state(list, "85,5", "de_grade");
    expect(decodeState(`#${encodeState(s, "course")}`, "course")).toEqual(s);
    for (const preset of GRADE_SCALE_PRESETS) {
      const other = { ...s, scale: preset };
      expect(decodeState(encodeState(other, "ects"), "ects")).toEqual(other);
    }
    const m = modules(list, "1.3");
    expect(decodeState(encodeState(m, "course"), "course")).toEqual(m);
  });

  test("leaves blank rows out at the end, but keeps them in the middle", () => {
    const s = state(rows(["20", "90"], ["", ""], ["30", ""], ["", ""], ["", ""]));
    expect(encodeState(s, "course")).toBe("m=course&r=20~90~&r=~~&r=30~~");
    expect(decodeState(encodeState(s, "course"), "course").rows).toEqual(s.rows.slice(0, 3));
  });

  test("a link with settings but no rows starts with blank rows", () => {
    const s = decodeState("#s=uk_degree&t=60", "course");
    expect(s.scale).toBe("uk_degree");
    expect(s.target).toBe("60");
    expect(s.rows).toEqual(initialState().rows);
  });

  test("ignores what it does not know", () => {
    const s = decodeState("#m=constructor&s=constructor&s=__proto__&x=1&=2&r&t&&&r=10~20~ok&v=9", "course");
    expect(s.mode).toBe("course");
    expect(s.scale).toBe("percent");
    expect(s.target).toBe("");
    expect(s.rows).toEqual(rows(["10", "20", "ok"]));
    expect(decodeState("#m=__proto__", "ects").mode).toBe("ects");
  });

  test("a broken escape reads as empty instead of failing", () => {
    const s = decodeState("#t=%E0%A4%A&r=%ZZ~%~%E0%A4%A8%E0%A4", "course");
    expect(s.target).toBe("");
    expect(s.rows).toEqual(rows(["", "", ""]));
  });

  test.each(["course", "ects"] as const)("keeps at most MAX_ROWS rows and cuts every text to its box (%s)", (mode) => {
    const long = "x".repeat(500);
    const many = Array.from({ length: 1_000 }, () => `r=${long}~${long}~${long}`).join("&");
    const s = decodeState(`#m=${mode}&t=${long}&${many}`, "course");
    const list = mode === "ects" ? s.modules.rows : s.rows;
    expect(list.length).toBeLessThanOrEqual(MAX_ROWS);
    if (mode === "course") expect(s.target).toHaveLength(MAX_NUMBER_LENGTH);
    else expect(s.modules.target).toBe("");
    for (const row of list) {
      expect(row.weight.length).toBeLessThanOrEqual(MAX_NUMBER_LENGTH);
      expect(row.score.length).toBeLessThanOrEqual(MAX_SCORE_LENGTH);
      expect(row.name.length).toBeLessThanOrEqual(MAX_NAME_LENGTH);
    }
    // Only the first MAX_FRAGMENT_LENGTH characters are read at all.
    expect(list.length).toBeLessThanOrEqual(Math.ceil(MAX_FRAGMENT_LENGTH / 1_500));
  });

  test("a huge fragment of rows stops at MAX_ROWS", () => {
    const s = decodeState(`#m=ects&${Array.from({ length: 5_000 }, () => "r=1~2~a").join("&")}`, "course");
    expect(s.modules.rows).toHaveLength(MAX_ROWS);
    expect(encodeState(s, "course").split("&")).toHaveLength(MAX_ROWS + 1);
  });

  test("strips control characters and never leaves half a character behind", () => {
    const s = decodeState(`#r=1~2~${encodeURIComponent("line\nbreak\u0000")}`, "course");
    expect(s.rows[0].name).toBe("line break ");
    // An emoji cut in half at the length limit is dropped, not kept as half.
    const name = `${"a".repeat(MAX_NAME_LENGTH - 1)}🎓`;
    const cut = decodeState(`#r=~~${encodeURIComponent(name)}`, "course").rows[0].name;
    expect(cut).toBe("a".repeat(MAX_NAME_LENGTH - 1));
    expect(() => encodeURIComponent(cut)).not.toThrow();
    // A lone surrogate in the state cannot break encoding.
    expect(() => encodeState(state(rows(["", "", "bad \uD800 half"])), "course")).not.toThrow();
  });
});

describe("one course", () => {
  test("nothing typed: nothing counted, no answer", () => {
    const r = calculate(initialState());
    expect(r.counted).toBe(0);
    expect(r.grade.outlook).toBeNull();
    expect(r.grade.current).toBeNull();
  });

  test("reads scores as percentages, with a sign, or as points", () => {
    const r = calculate(state(rows(["25", "84"], ["25", "84%"], ["25", "42/50"], ["25", "84,0 %"])));
    expect(r.grade.current).toBeCloseTo(84);
    expect(r.grade.decidedShare).toBe(1);
    expect(r.invalidScore.size).toBe(0);
  });

  test("what the rest needs, in the same terms as the grade tracker", () => {
    const r = calculate(state(rows(["60", "78"], ["40", ""]), "80"));
    expect(r.target).toBe(80);
    expect(r.grade.current).toBeCloseTo(78);
    expect(r.grade.decidedShare).toBeCloseTo(0.6);
    expect(r.grade.outlook).toEqual({ kind: "needed", average: expect.closeTo(83, 6) });
  });

  test("secured and out of reach", () => {
    expect(calculate(state(rows(["90", "100"], ["10", ""]), "85")).grade.outlook?.kind).toBe("secured");
    const out = calculate(state(rows(["80", "50"], ["20", ""]), "90")).grade.outlook;
    expect(out?.kind).toBe("unreachable");
    expect(out && out.kind === "unreachable" ? out.best : 0).toBeCloseTo(60);
  });

  test("weights that do not add up to 100 are flagged", () => {
    const r = calculate(state(rows(["30", "80"], ["40", ""])));
    expect(r.grade.notes).toContainEqual({ code: "weights_sum", sum: 70 });
  });

  test("an unreadable weight, score or target is flagged and left out", () => {
    const r = calculate(state(rows(["abc", "90"], ["50", "42/"], ["-5", "70"]), "lots"));
    expect([...r.invalidWeight]).toEqual([0, 2]);
    expect([...r.invalidScore]).toEqual([1]);
    expect(r.invalidTarget).toBe(true);
    expect(r.target).toBeNull();
    expect(calculate(state(rows(["50", "90"]), "5000")).invalidTarget).toBe(true);
  });

  test("blank rows do not count; a named row without numbers does", () => {
    expect(calculate(state(rows(["", ""], ["50", "80"], ["", ""]))).counted).toBe(1);
    const r = calculate(state(rows(["50", "80"], ["", "", "Final"])));
    expect(r.counted).toBe(2);
    expect(r.grade.notes).toContainEqual({ code: "unweighted_split", count: 1, each: 50 });
  });
});

describe("the German grade average", () => {
  test("reads credits and grades as typed, the German or the English way", () => {
    const r = calculateModules(modules(rows(["9", "2,3"], ["6", "1.7"], ["7,5", ""])).modules);
    expect(r.average.shown).toBe(2);
    expect(r.average.unrounded).toBe(2.06);
    expect(r.average.earnedEcts).toBe(15);
    expect(r.average.openEcts).toBe(7.5);
    expect(r.counted).toBe(3);
  });

  test("a 5,0 is not passed and not counted", () => {
    const r = calculateModules(modules(rows(["9", "2,3"], ["6", "5,0"])).modules);
    expect([...r.failed]).toEqual([1]);
    expect(r.average.shown).toBe(2.3);
    expect(r.average.failed).toBe(1);
  });

  test("unreadable credits or grades are flagged and left out", () => {
    const r = calculateModules(modules(rows(["neun", "2,3"], ["0", "1,7"], ["6", "1,75"], ["6", "87"], ["6", "2,0"])).modules);
    expect([...r.invalidEcts]).toEqual([0, 1]);
    expect([...r.invalidGrade]).toEqual([2, 3]);
    expect(r.average.passedWithoutEcts).toBe(2);
    expect(r.average.weighting).toBe("equal");
  });

  test("what the open modules need for the target", () => {
    expect(calculateModules(modules(rows(["5", "1,7"], ["5", ""]), "1.8").modules).needed).toEqual({ kind: "needed", grade: 2 });
    expect(calculateModules(modules(rows(["5", "1,7"], ["5", ""]), "").modules).needed).toBeNull();
    expect(calculateModules(modules(rows(["5", "1,7"], ["5", ""]), "4.5").modules).target).toBeNull();
  });
});

describe("the examples", () => {
  test.each(GRADE_SCALE_PRESETS)("a course on the %s scale aims for a real grade and still needs the final", (preset) => {
    const s = exampleState(NAMES, { ...initialState("course"), scale: preset });
    expect(s.scale).toBe(preset);
    expect(s.rows.map((r) => r.name)).toEqual(Object.values(NAMES));
    const r = calculate(s);
    expect(r.invalidScore.size + r.invalidWeight.size).toBe(0);
    expect(r.invalidTarget).toBe(false);
    expect(r.grade.outlook?.kind).toBe("needed");
  });

  test("a course example survives the address", () => {
    const s = exampleState(NAMES, { ...initialState("course"), scale: "us_letter" });
    expect(s.target).toBe("87");
    expect(decodeState(encodeState(s, "ects"), "ects")).toEqual(s);
  });

  test.each(["de", "en", "ar"])("a German Bachelor (%s): one module failed, two open, a 2,1 needed for a 2,0", (locale) => {
    const s = exampleModules(MODULES, initialState("ects"), locale);
    expect(s.mode).toBe("ects");
    const r = calculateModules(s.modules);
    expect(r.invalidEcts.size + r.invalidGrade.size).toBe(0);
    expect(r.failed.size).toBe(1);
    expect(r.average.shown).toBe(2);
    expect(r.average.openEcts).toBe(15);
    expect(r.needed).toEqual({ kind: "needed", grade: 2.1 });
    if (locale === "de") expect(s.modules.rows[0].score).toBe("2,3");
    expect(decodeState(encodeState(s, "course"), "course")).toEqual({ ...s, rows: emptyRows(START_ROWS) });
  });

  test("loading one mode's example keeps what the other mode had", () => {
    const typed = { ...state(rows(["50", "80", "Essay"])), mode: "ects" as const };
    expect(exampleModules(MODULES, typed, "de").rows).toEqual(typed.rows);
    const withModules = modules(rows(["6", "1,3", "Statistik"]));
    expect(exampleState(NAMES, withModules).modules).toEqual(withModules.modules);
  });
});
