import { describe, expect, it } from "vitest";
import type { Flashcard } from "@/lib/workspace/types";
import {
  cardsFromPlan,
  deckFileName,
  detectDelimiter,
  htmlToMarkdown,
  markdownToAnkiHtml,
  parseDeckText,
  planImport,
  splitDelimited,
  toAnkiText,
  toQuizletText,
} from "./transfer";

const fronts = (text: string, d?: "\t" | "," | ";") =>
  parseDeckText(text, { delimiter: d }).rows.map((r) => [r.front, r.back]);

describe("splitDelimited", () => {
  it("handles quoted fields with delimiters, doubled quotes and line breaks", () => {
    const rows = splitDelimited('"a, b","say ""hi"""\n"multi\nline",x\r\nlast,row', ",");
    expect(rows.map((r) => r.fields)).toEqual([
      ["a, b", 'say "hi"'],
      ["multi\nline", "x"],
      ["last", "row"],
    ]);
    expect(rows.map((r) => r.line)).toEqual([1, 2, 4]);
  });

  it("keeps tabs inside quoted fields of a tab-separated file", () => {
    const rows = splitDelimited('"col\twith tab"\tanswer\n', "\t");
    expect(rows[0].fields).toEqual(["col\twith tab", "answer"]);
  });
});

describe("detectDelimiter", () => {
  it("detects tabs (Quizlet default), commas and semicolons", () => {
    expect(detectDelimiter("mitochondria\tpowerhouse\nATP\tenergy")).toBe("\t");
    expect(detectDelimiter("mitochondria,powerhouse\nATP,energy")).toBe(",");
    expect(detectDelimiter("mitochondria;powerhouse, of the cell\nATP;energy")).toBe(";");
  });

  it("ignores commas inside quoted fields", () => {
    expect(detectDelimiter('"a, b, c"\tx\n"d, e"\ty')).toBe("\t");
  });
});

describe("parseDeckText", () => {
  it("parses a header-less Quizlet export and skips blank lines", () => {
    expect(fronts("cell\tbasic unit of life\n\n\nATP\tenergy currency\n   \n")).toEqual([
      ["cell", "basic unit of life"],
      ["ATP", "energy currency"],
    ]);
  });

  it("skips a recognised header row", () => {
    const parsed = parseDeckText("Term,Definition\nosmosis,water diffusion\n");
    expect(parsed.header).toBe(true);
    expect(parsed.rows.map((r) => r.front)).toEqual(["osmosis"]);
  });

  it("does not mistake a real first card for a header", () => {
    expect(fronts("What is a cell?,The basic unit of life\n")).toHaveLength(1);
  });

  it("reads Anki's plain-text export headers, HTML and MathJax", () => {
    const text = [
      "#separator:tab",
      "#html:true",
      "#guid column:1",
      "#notetype column:2",
      "#deck column:3",
      "#tags column:6",
      "abc123\tBasic\tBio\tWhat is <b>ATP</b>?\tEnergy&nbsp;currency<br>of the cell\tbio",
      'def456\tBasic\tBio\t"Area of a circle\twith tab"\t\\(\\pi r^2\\)\t',
    ].join("\n");
    const parsed = parseDeckText(text);
    expect(parsed.delimiter).toBe("\t");
    expect(parsed.rows.map((r) => [r.front, r.back])).toEqual([
      ["What is **ATP**?", "Energy currency\nof the cell"],
      ["Area of a circle\twith tab", "$\\pi r^2$"],
    ]);
    expect(parsed.rows[0].line).toBe(7);
  });

  it("honours an Anki #separator:comma line over auto-detection", () => {
    expect(fronts("#separator:comma\na\tb,c\n")).toEqual([["a\tb", "c"]]);
  });

  it("keeps a single-column row so the preview can flag it", () => {
    expect(fronts("only a front\n")).toEqual([["only a front", ""]]);
  });

  it("strips a UTF-8 byte-order mark and handles CRLF", () => {
    expect(fronts("﻿a,b\r\nc,d\r\n")).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
  });

  it("converts block MathJax to $$", () => {
    expect(fronts("x\t\\[E = mc^2\\]")).toEqual([["x", "$$E = mc^2$$"]]);
  });
});

describe("planImport", () => {
  const existing: Flashcard[] = [{ id: "1", front: "Mitochondria", back: "powerhouse" }];

  it("skips duplicates of the deck and of earlier rows, case/space-insensitively", () => {
    const { rows } = parseDeckText("mitochondria\tx\nATP\tenergy\n  atp \tdupe\nDNA\tgenes");
    const plan = planImport(rows, existing);
    expect(plan.map((r) => r.status)).toEqual(["duplicate", "new", "duplicate", "new"]);
  });

  it("flags rows with a missing side and over-long fields", () => {
    const plan = planImport(
      [
        { line: 1, front: "a", back: "" },
        { line: 2, front: "b".repeat(2001), back: "x" },
      ],
      [],
    );
    expect(plan.map((r) => r.status)).toEqual(["missingSide", "tooLong"]);
  });

  it("stops at the deck size limit", () => {
    const rows = [1, 2, 3].map((i) => ({ line: i, front: `q${i}`, back: "a" }));
    expect(planImport(rows, existing, 3).map((r) => r.status)).toEqual(["new", "new", "deckFull"]);
  });

  it("builds plain new cards (no scheduling state) from the plan", () => {
    let n = 0;
    const cards = cardsFromPlan(planImport([{ line: 1, front: "q", back: "a" }], []), () => `id${++n}`);
    expect(cards).toEqual([{ id: "id1", front: "q", back: "a" }]);
  });
});

describe("export", () => {
  const deck: Flashcard[] = [
    { id: "1", front: "Area of a circle", back: "$\\pi r^2$\n**always**" },
    { id: "2", front: "Tab\there", back: "a < b & \"c\"" },
    { id: "3", front: "", back: "" },
  ];

  it("writes an Anki notes file with headers, HTML and MathJax", () => {
    const text = toAnkiText(deck);
    const lines = text.trimEnd().split("\n");
    expect(lines.slice(0, 3)).toEqual(["#separator:tab", "#html:true", "#columns:Front\tBack"]);
    expect(lines[3]).toBe("Area of a circle\t\\(\\pi r^2\\)<br><b>always</b>");
    expect(lines[4]).toBe("Tab    here\ta &lt; b &amp; &quot;c&quot;");
    expect(lines).toHaveLength(5); // blank card left out
  });

  it("writes Quizlet's term<TAB>definition lines, flattening line breaks", () => {
    expect(toQuizletText(deck)).toBe(
      "Area of a circle\t$\\pi r^2$ / **always**\nTab here\ta < b & \"c\"\n",
    );
  });

  it("round-trips through our own importer", () => {
    for (const text of [toAnkiText(deck), toQuizletText(deck)]) {
      const rows = parseDeckText(text).rows;
      expect(rows[0].front).toBe("Area of a circle");
      expect(rows[0].back).toContain("$\\pi r^2$");
      expect(rows).toHaveLength(2);
    }
  });

  it("converts markdown emphasis and math for Anki", () => {
    expect(markdownToAnkiHtml("*x* and $$y$$")).toBe("<i>x</i> and \\[y\\]");
    expect(htmlToMarkdown("<div>a</div><div>b</div>")).toBe("a\nb");
  });

  it("makes safe file names", () => {
    expect(deckFileName("Bio 101: Cells / ATP", ".txt")).toBe("Bio-101-Cells-ATP.txt");
    expect(deckFileName("   ", "-anki.txt")).toBe("flashcards-anki.txt");
  });
});
