import { describe, expect, it } from "vitest";
import { calloutParts, extractTitle, parseMarkdown, plainText, rewriteInline, soleLink, tableCells } from "./markdown";

describe("parseMarkdown", () => {
  it("reads headings h1–h3 (deeper ones as h3)", () => {
    expect(parseMarkdown("# One\n\n## Two\n\n### Three\n\n#### Four ####")).toEqual([
      { type: "heading", level: 1, text: "One" },
      { type: "heading", level: 2, text: "Two" },
      { type: "heading", level: 3, text: "Three" },
      { type: "heading", level: 3, text: "Four" },
    ]);
    expect(parseMarkdown("#hashtag")).toEqual([{ type: "paragraph", text: "#hashtag" }]);
  });

  it("keeps inline formatting as Markdown and joins soft-wrapped lines", () => {
    expect(parseMarkdown("Some **bold**, *italic*, `code`, ~~gone~~ and $x^2$.\nNext line\n\nNew paragraph")).toEqual([
      { type: "paragraph", text: "Some **bold**, *italic*, `code`, ~~gone~~ and $x^2$.\nNext line" },
      { type: "paragraph", text: "New paragraph" },
    ]);
  });

  it("reads bulleted, numbered and to-do lists, flattening nested items in order", () => {
    const md = ["- one", "    - nested", "        1. deep", "- [ ] open task", "- [x] done task", "1. first", "2. second", "* star", "+ plus"].join("\n");
    expect(parseMarkdown(md)).toEqual([
      { type: "bulleted_list_item", text: "one" },
      { type: "bulleted_list_item", text: "nested" },
      { type: "numbered_list_item", text: "deep" },
      { type: "todo", text: "open task", checked: false },
      { type: "todo", text: "done task", checked: true },
      { type: "numbered_list_item", text: "first" },
      { type: "numbered_list_item", text: "second" },
      { type: "bulleted_list_item", text: "star" },
      { type: "bulleted_list_item", text: "plus" },
    ]);
  });

  it("keeps a list item's continuation lines, and a toggle's indented content after it", () => {
    expect(parseMarkdown("- Toggle title\n  more of the title\n\n    Hidden content\n\nAfter")).toEqual([
      { type: "bulleted_list_item", text: "Toggle title\nmore of the title" },
      { type: "paragraph", text: "Hidden content" },
      { type: "paragraph", text: "After" },
    ]);
  });

  it("reads quotes, dividers and <details> toggles", () => {
    expect(parseMarkdown("> quoted\n> still\n\n---\n\n<details>\n<summary>Spoiler</summary>\n\nInside\n\n</details>")).toEqual([
      { type: "quote", text: "quoted\nstill" },
      { type: "divider" },
      { type: "paragraph", text: "**Spoiler**" },
      { type: "paragraph", text: "Inside" },
    ]);
    expect(parseMarkdown("***\n\n___\n\n- - -")).toEqual([{ type: "divider" }, { type: "divider" }, { type: "divider" }]);
  });

  it("turns Notion's <aside> into a callout with its emoji as the icon", () => {
    expect(parseMarkdown("<aside>\n💡 Remember the **exam**\n\n</aside>")).toEqual([
      { type: "callout", text: "Remember the **exam**", emoji: "💡" },
    ]);
    expect(parseMarkdown("<aside>\n⚠️\n\nTwo lines\n- and a list\n\n</aside>\n\nAfter")).toEqual([
      { type: "callout", text: "Two lines\n- and a list", emoji: "⚠️" },
      { type: "paragraph", text: "After" },
    ]);
    expect(parseMarkdown("<aside>No icon here</aside>")).toEqual([{ type: "callout", text: "No icon here" }]);
    expect(parseMarkdown('<aside>\n<img src="https://www.notion.so/icons/x.svg" alt="x" width="40px" /> Custom icon\n</aside>')).toEqual([
      { type: "callout", text: "Custom icon" },
    ]);
  });

  it("keeps code blocks with their language as fenced Markdown", () => {
    expect(parseMarkdown("```python\ndef f():\n    return `x`\n```")).toEqual([
      { type: "code", text: "```python\ndef f():\n    return `x`\n```" },
    ]);
    expect(parseMarkdown("```plain text\nno language\n```")).toEqual([{ type: "code", text: "```\nno language\n```" }]);
    // A fence inside the code gets a longer one around it.
    expect(parseMarkdown("~~~\nuse ``` here\n~~~")).toEqual([{ type: "code", text: "````\nuse ``` here\n````" }]);
    // Unclosed: to the end of the file.
    expect(parseMarkdown("```js\nlet a = 1;")).toEqual([{ type: "code", text: "```js\nlet a = 1;\n```" }]);
  });

  it("keeps $$ equations as display math", () => {
    expect(parseMarkdown("$$\n\\int_0^1 x\\,dx\n$$")).toEqual([{ type: "math", text: "$$\n\\int_0^1 x\\,dx\n$$" }]);
    expect(parseMarkdown("$$E = mc^2$$")).toEqual([{ type: "math", text: "$$E = mc^2$$" }]);
  });

  it("reads Markdown tables, escaped pipes and <br> included", () => {
    expect(parseMarkdown("| Name | Notes |\n| --- | :---: |\n| A | x \\| y |\n| B | line<br>two |")).toEqual([
      { type: "table", header: ["Name", "Notes"], rows: [["A", "x | y"], ["B", "line\ntwo"]] },
    ]);
    // A line starting with "|" without a separator is just text.
    expect(parseMarkdown("| not a table")).toEqual([{ type: "paragraph", text: "| not a table" }]);
  });

  it("marks an image or a link alone on its line", () => {
    expect(parseMarkdown("![Diagram](Page%20abc/diagram.png)\n\n[Tasks](Tasks%20abc.csv)\n\nText with [a link](x.md) inside")).toEqual([
      { type: "image", alt: "Diagram", src: "Page%20abc/diagram.png" },
      { type: "link", label: "Tasks", href: "Tasks%20abc.csv" },
      { type: "paragraph", text: "Text with [a link](x.md) inside" },
    ]);
  });

  it("stays linear on hostile input", () => {
    const started = Date.now();
    parseMarkdown(`${"[".repeat(50_000)}\n${"#".repeat(50_000)}\n${"- ".repeat(30_000)}\n${" ".repeat(60_000)}x\n${"`".repeat(20_000)}`);
    rewriteInline(`${"[a](".repeat(20_000)}`, () => "");
    expect(Date.now() - started).toBeLessThan(3_000);
  });
});

describe("extractTitle", () => {
  it("takes the leading # heading as the page title", () => {
    expect(extractTitle("\uFEFF\n# Week 1\n\nBody")).toEqual({ title: "Week 1", body: "\nBody" });
    expect(extractTitle("## Not a title\n\nBody")).toEqual({ title: null, body: "## Not a title\n\nBody" });
    expect(extractTitle("Body only")).toEqual({ title: null, body: "Body only" });
  });
});

describe("inline links", () => {
  it("rewrites links and images, leaving code spans alone", () => {
    const out = rewriteInline("See [Week 1](Week%201.md), ![pic](a.png) and `[not](a link)`.", (l) => `<${l.kind}:${l.label}:${l.href}>`);
    expect(out).toBe("See <link:Week 1:Week%201.md>, <image:pic:a.png> and `[not](a link)`.");
  });

  it("handles parentheses in file names, angle brackets, titles and nested brackets", () => {
    const seen: string[] = [];
    rewriteInline('[A](Lecture%20(1).md) [B](<My File.md>) [C](c.md "Title") [[D]](d.md)', (l) => {
      seen.push(`${l.label}|${l.href}`);
      return "";
    });
    expect(seen).toEqual(["A|Lecture%20(1).md", "B|My File.md", "C|c.md", "[D]|d.md"]);
  });

  it("finds a link that is the whole line", () => {
    expect(soleLink("  [Tasks](Tasks.csv) ")).toEqual({ kind: "link", label: "Tasks", href: "Tasks.csv" });
    expect(soleLink("[Tasks](Tasks.csv) and more")).toBeNull();
    expect(soleLink("plain")).toBeNull();
  });

  it("reduces Markdown to plain text for cells and titles", () => {
    expect(plainText("**Bold** [Week](w.md) ![x](y.png) a\\|b")).toBe("Bold Week x a|b");
  });
});

describe("callouts and table cells", () => {
  it("split a leading emoji (with variation selectors and joiners)", () => {
    expect(calloutParts("👩‍🎓 Study")).toEqual({ emoji: "👩‍🎓", text: "Study" });
    expect(calloutParts("ℹ️ Info")).toEqual({ emoji: "ℹ️", text: "Info" });
    expect(calloutParts("Plain")).toEqual({ text: "Plain" });
  });

  it("split rows on unescaped pipes", () => {
    expect(tableCells("| a | b \\| c | d |")).toEqual(["a", "b | c", "d"]);
    expect(tableCells("|a|")).toEqual(["a"]);
  });
});
