import { describe, expect, it } from "vitest";
import { buildDatabase, inferColumn, parseCsv, parseNotionDate, parseNumber, readDateColumn } from "./csv";

const OPTIONS = {
  maxRows: 2_000,
  maxColumns: 50,
  maxCellChars: 5_000,
  columnName: (n: number) => `Column ${n}`,
  viewNames: { table: "Table", board: "Board", calendar: "Calendar" },
};

describe("parseCsv", () => {
  it("reads Notion's CSV: BOM, quoted commas, quotes and line breaks, CRLF", () => {
    const csv = '\uFEFFName,Notes,Tags\r\n"Essay, draft","She said ""hi""","Math, Physics"\r\nQuiz,"two\nlines",\r\n\r\n';
    expect(parseCsv(csv)).toEqual({
      header: ["Name", "Notes", "Tags"],
      rows: [
        ["Essay, draft", 'She said "hi"', "Math, Physics"],
        ["Quiz", "two\nlines", ""],
      ],
    });
  });

  it("skips blank rows and survives an empty file", () => {
    expect(parseCsv("A,B\n,\n1,2\n")).toEqual({ header: ["A", "B"], rows: [["1", "2"]] });
    expect(parseCsv("")).toEqual({ header: [], rows: [] });
  });
});

describe("dates", () => {
  it("reads Notion's date formats", () => {
    expect(parseNotionDate("March 3, 2024")).toBe("2024-03-03");
    expect(parseNotionDate("Mar 3, 2024")).toBe("2024-03-03");
    expect(parseNotionDate("Sept 30, 2025")).toBe("2025-09-30");
    expect(parseNotionDate("March 3, 2024 3:00 PM")).toBe("2024-03-03");
    expect(parseNotionDate("March 3, 2024 15:30 (GMT+1)")).toBe("2024-03-03");
    expect(parseNotionDate("@November 12, 2026")).toBe("2026-11-12");
    expect(parseNotionDate("March 3, 2024 → March 5, 2024")).toBe("2024-03-03");
    expect(parseNotionDate("3 March 2024")).toBe("2024-03-03");
    expect(parseNotionDate("2024/03/03")).toBe("2024-03-03");
    expect(parseNotionDate("2024-03-03")).toBe("2024-03-03");
    expect(parseNotionDate("2024-03-03T10:15:00.000Z")).toBe("2024-03-03");
    expect(parseNotionDate("2024年3月3日")).toBe("2024-03-03");
    expect(parseNotionDate("03/04/2024")).toBe("2024-03-04");
    expect(parseNotionDate("03/04/2024", true)).toBe("2024-04-03");
  });

  it("refuses what is not a real day", () => {
    expect(parseNotionDate("February 30, 2024")).toBeNull();
    expect(parseNotionDate("Smarch 3, 2024")).toBeNull();
    expect(parseNotionDate("13/13/2024")).toBeNull();
    expect(parseNotionDate("next Tuesday")).toBeNull();
    expect(parseNotionDate("2024")).toBeNull();
  });

  it("decides day or month first for the whole column", () => {
    expect(readDateColumn(["03/04/2024", "25/04/2024"])).toEqual(["2024-04-03", "2024-04-25"]);
    expect(readDateColumn(["03/04/2024", "04/25/2024"], true)).toEqual(["2024-03-04", "2024-04-25"]);
    expect(readDateColumn(["13/01/2024", "01/13/2024"])).toBeNull();
  });
});

describe("numbers", () => {
  it("reads plain numbers, thousands separators, currency and percent", () => {
    expect(parseNumber("12")).toBe(12);
    expect(parseNumber("-3.5")).toBe(-3.5);
    expect(parseNumber("1,234.5")).toBe(1234.5);
    expect(parseNumber("$12.50")).toBe(12.5);
    expect(parseNumber("40%")).toBe(40);
    expect(parseNumber("0.5")).toBe(0.5);
    expect(parseNumber("0")).toBe(0);
  });

  it("keeps ids, postcodes and prose as text", () => {
    expect(parseNumber("007")).toBeNull();
    expect(parseNumber("01234")).toBeNull();
    expect(parseNumber("12 apples")).toBeNull();
    expect(parseNumber("1,23")).toBeNull();
    expect(parseNumber("")).toBeNull();
  });
});

describe("inferColumn", () => {
  it("keeps the title column text, whatever it holds", () => {
    expect(inferColumn("Name", ["1", "2"], { isTitle: true }).type).toBe("text");
  });

  it("infers checkbox, number, date and url only when every value fits (empty cells aside)", () => {
    expect(inferColumn("Done", ["Yes", "No", "", "yes"]).type).toBe("checkbox");
    expect(inferColumn("Score", ["90", "", "85.5"]).type).toBe("number");
    expect(inferColumn("Due", ["March 3, 2024", "", "April 1, 2024 9:00 AM"]).type).toBe("date");
    expect(inferColumn("Link", ["https://a.example", "http://b.example/x"]).type).toBe("url");
    expect(inferColumn("Score", ["90", "ninety"]).type).toBe("text");
    expect(inferColumn("Due", ["March 3, 2024", "soon"]).type).toBe("text");
    expect(inferColumn("Anything", ["", "  "]).type).toBe("text");
  });

  it("makes a select of a few values that recur, a status of a Status column", () => {
    expect(inferColumn("Course", ["Math", "Physics", "Math", "Math"])).toEqual({ type: "select", options: ["Math", "Physics"] });
    expect(inferColumn("Status", ["Done", "Not started"])).toEqual({ type: "status", options: ["Done", "Not started"] });
    expect(inferColumn("Priority", ["High"]).type).toBe("select");
    // Mostly unique values stay text.
    expect(inferColumn("Notes", ["a", "b", "c", "a"]).type).toBe("text");
    expect(inferColumn("Notes", ["only one"]).type).toBe("text");
  });

  it("makes a multi-select of comma lists whose items recur", () => {
    expect(inferColumn("Tags", ["Math, Physics", "Math", "Physics, Chemistry"])).toEqual({
      type: "multi_select",
      options: ["Math", "Physics", "Chemistry"],
    });
    // Prose with commas is not a list.
    expect(inferColumn("Notes", ["Read chapter one, then summarize it.", "Write, revise, submit the essay today."]).type).toBe("text");
  });
});

describe("buildDatabase", () => {
  const table = {
    header: ["Name", "Status", "Due", "Done", "Score", "Tags", "Notes"],
    rows: [
      ["Essay", "Done", "March 3, 2024", "Yes", "90", "Math, Physics", "first"],
      ["Quiz", "In progress", "", "No", "", "Math", ""],
      ["Lab (Lab%20abc.md)", "Done", "March 9, 2024", "No", "75", "Physics", "third"],
    ],
  };

  it("keeps the first column as the title and fills typed cells", () => {
    const { database, rowTitles } = buildDatabase("db1", "Tasks", table, OPTIONS);
    expect(database.properties.map((p) => [p.name, p.type])).toEqual([
      ["Name", "text"],
      ["Status", "status"],
      ["Due", "date"],
      ["Done", "checkbox"],
      ["Score", "number"],
      ["Tags", "multi_select"],
      ["Notes", "text"],
    ]);
    const [name, status, due, done, score, tags, notes] = database.properties;
    const option = (label: string) => status.options!.find((o) => o.label === label)!.id;
    const tag = (label: string) => tags.options!.find((o) => o.label === label)!.id;
    expect(database.rows[0].cells).toEqual({
      [name.id]: "Essay",
      [status.id]: option("Done"),
      [due.id]: "2024-03-03",
      [done.id]: true,
      [score.id]: 90,
      [tags.id]: [tag("Math"), tag("Physics")],
      [notes.id]: "first",
    });
    // Empty cells are left out; "No" is an unchecked box.
    expect(database.rows[1].cells).toEqual({ [name.id]: "Quiz", [status.id]: option("In progress"), [done.id]: false, [tags.id]: [tag("Math")] });
    // A relation-style link is reduced to its title.
    expect(rowTitles).toEqual(["Essay", "Quiz", "Lab"]);
    expect(status.options!.find((o) => o.label === "Done")!.color).toBe("green");
  });

  it("adds a board on the first select column and a calendar on the first date column", () => {
    const { database } = buildDatabase("db1", "Tasks", table, OPTIONS);
    expect(database.views.map((v) => [v.type, v.groupByPropertyId ?? v.datePropertyId ?? null])).toEqual([
      ["table", null],
      ["board", database.properties[1].id],
      ["calendar", database.properties[2].id],
    ]);
  });

  it("caps rows and columns and reports what it left out", () => {
    const built = buildDatabase("db1", "Tasks", table, { ...OPTIONS, maxRows: 2, maxColumns: 3 });
    expect(built.database.rows).toHaveLength(2);
    expect(built.database.properties).toHaveLength(3);
    expect(built.skippedRows).toBe(1);
    expect(built.skippedColumns).toBe(4);
  });

  it("names unnamed and duplicate columns, and is deterministic", () => {
    const a = buildDatabase("db1", "T", { header: ["Name", "", "Name"], rows: [["x", "y", "z"]] }, OPTIONS);
    expect(a.database.properties.map((p) => p.name)).toEqual(["Name", "Column 2", "Name 2"]);
    const b = buildDatabase("db1", "T", { header: ["Name", "", "Name"], rows: [["x", "y", "z"]] }, OPTIONS);
    expect(b).toEqual(a);
  });
});
