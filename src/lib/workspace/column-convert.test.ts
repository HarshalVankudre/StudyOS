import { describe, expect, it } from "vitest";
import type { Database, PropertyType, SelectOption } from "./types";
import { convertProperty, parseDay, parseNumber } from "./column-convert";

let n = 0;
const opts = {
  newId: () => `id${++n}`,
  defaultOptions: (type: PropertyType): SelectOption[] =>
    type === "status"
      ? [
          { id: "d-todo", label: "To do" },
          { id: "d-doing", label: "In progress" },
          { id: "d-done", label: "Done", color: "green" },
        ]
      : [{ id: "d-1", label: "Option 1" }],
  relationDatabaseId: "other",
};

function db(type: PropertyType, values: unknown[], extra: Partial<Database["properties"][number]> = {}): Database {
  return {
    id: "db",
    name: "DB",
    properties: [{ id: "p", name: "Field", type, ...extra }],
    rows: values.map((v, i) => ({ id: `r${i}`, cells: { p: v as never } })),
    views: [],
  };
}

describe("parsers", () => {
  it("parses numbers written in common ways", () => {
    expect(parseNumber("12")).toBe(12);
    expect(parseNumber(" 1,5 ")).toBe(1.5);
    expect(parseNumber("1,000.5")).toBe(1000.5);
    expect(parseNumber("1.000,5")).toBe(1000.5);
    expect(parseNumber("1,000")).toBe(1000);
    expect(parseNumber("80 %")).toBe(80);
    expect(parseNumber("-3")).toBe(-3);
    expect(parseNumber("ten")).toBeNull();
    expect(parseNumber("")).toBeNull();
  });

  it("parses unambiguous dates only", () => {
    expect(parseDay("2026-09-14")).toBe("2026-09-14");
    expect(parseDay("2026/09/14")).toBe("2026-09-14");
    expect(parseDay("14.9.2026")).toBe("2026-09-14");
    expect(parseDay("2026-09-14T08:00:00Z")).toBe("2026-09-14");
    expect(parseDay("09/14/2026")).toBeNull();
    expect(parseDay("2026-02-30")).toBeNull();
  });
});

describe("convertProperty", () => {
  it("text -> number keeps numeric values and counts the rest as lost", () => {
    const res = convertProperty(db("text", ["12", "3,5", "lots", "", null]), "p", "number", opts);
    expect(res.cells).toEqual({ r0: 12, r1: 3.5, r2: null, r3: null, r4: null });
    expect(res.lost).toBe(1);
    expect(res.converted).toBe(2);
    expect(res.property.type).toBe("number");
    expect(res.property.options).toBeUndefined();
  });

  it("number -> text never loses anything", () => {
    const res = convertProperty(db("number", [4, 0.5, null]), "p", "text", opts);
    expect(res.cells).toEqual({ r0: "4", r1: "0.5", r2: null });
    expect(res.lost).toBe(0);
  });

  it("select -> status keeps the options and values", () => {
    const options = [{ id: "a", label: "Open", color: "zinc" }, { id: "b", label: "Done", color: "green" }];
    const res = convertProperty(db("select", ["a", "b", null], { options }), "p", "status", opts);
    expect(res.property.options).toEqual(options);
    expect(res.cells).toEqual({ r0: "a", r1: "b", r2: null });
    expect(res.lost).toBe(0);
  });

  it("text -> select builds one option per distinct value", () => {
    const res = convertProperty(db("text", ["CS 101", "Math", "cs 101", " ", null]), "p", "select", opts);
    expect(res.property.options?.map((o) => o.label)).toEqual(["CS 101", "Math"]);
    expect(res.cells.r0).toBe(res.cells.r2);
    expect(res.cells.r1).not.toBe(res.cells.r0);
    expect(res.cells.r3).toBeNull();
    expect(res.lost).toBe(0);
  });

  it("text -> multi-select splits on commas", () => {
    const res = convertProperty(db("text", ["sql, joins", "joins"]), "p", "multi_select", opts);
    expect(res.property.options?.map((o) => o.label)).toEqual(["sql", "joins"]);
    expect((res.cells.r0 as string[]).length).toBe(2);
    expect(res.cells.r1).toEqual([(res.cells.r0 as string[])[1]]);
  });

  it("multi-select -> select keeps the first value but reports the dropped extras", () => {
    const options = [{ id: "a", label: "A" }, { id: "b", label: "B" }];
    const res = convertProperty(db("multi_select", [["a", "b"], ["b"], []], { options }), "p", "select", opts);
    expect(res.cells).toEqual({ r0: "a", r1: "b", r2: null });
    expect(res.lost).toBe(1);
  });

  it("select -> text uses the labels", () => {
    const options = [{ id: "a", label: "Alpha" }, { id: "b", label: "Beta" }];
    const res = convertProperty(db("multi_select", [["a", "b"]], { options }), "p", "text", opts);
    expect(res.cells.r0).toBe("Alpha, Beta");
  });

  it("checkbox -> status maps checked to the last (done) option", () => {
    const res = convertProperty(db("checkbox", [true, false, null]), "p", "status", opts);
    expect(res.property.options?.map((o) => o.id)).toEqual(["d-todo", "d-doing", "d-done"]);
    expect(res.cells).toEqual({ r0: "d-done", r1: null, r2: null });
    expect(res.lost).toBe(0);
  });

  it("text -> checkbox understands yes/no words and loses the rest", () => {
    const res = convertProperty(db("text", ["yes", "no", "x", "maybe"]), "p", "checkbox", opts);
    expect(res.cells).toEqual({ r0: true, r1: false, r2: true, r3: null });
    expect(res.lost).toBe(1);
  });

  it("text -> date keeps parseable dates", () => {
    const res = convertProperty(db("text", ["2026-10-01", "next week"]), "p", "date", opts);
    expect(res.cells).toEqual({ r0: "2026-10-01", r1: null });
    expect(res.lost).toBe(1);
  });

  it("date -> number cannot convert", () => {
    const res = convertProperty(db("date", ["2026-10-01", null]), "p", "number", opts);
    expect(res.lost).toBe(1);
  });

  it("anything -> relation clears values and points at a database", () => {
    const res = convertProperty(db("text", ["a", ""]), "p", "relation", opts);
    expect(res.property.relationDatabaseId).toBe("other");
    expect(res.lost).toBe(1);
  });

  it("an empty column converts to an option type with default options", () => {
    const res = convertProperty(db("text", [null, ""]), "p", "status", opts);
    expect(res.property.options?.map((o) => o.id)).toEqual(["d-todo", "d-doing", "d-done"]);
    expect(res.lost).toBe(0);
    expect(res.converted).toBe(0);
  });

  it("does not mutate the input database", () => {
    const input = db("text", ["5"]);
    const before = structuredClone(input);
    convertProperty(input, "p", "number", opts);
    expect(input).toEqual(before);
  });
});
