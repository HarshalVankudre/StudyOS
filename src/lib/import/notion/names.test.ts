import { describe, expect, it } from "vitest";
import { isJunkPath, notionUrlId, pathParts, resolveRelative, safeDecode, safeEntryPath, splitNotionName } from "./names";

const ID = "1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d";

describe("Notion names", () => {
  it("split the title from the 32-hex id Notion appends", () => {
    expect(splitNotionName(`Lecture notes ${ID}`)).toEqual({ title: "Lecture notes", id: ID });
    expect(splitNotionName(`Tasks ${ID.toUpperCase()}`)).toEqual({ title: "Tasks", id: ID });
    expect(splitNotionName("Plain title")).toEqual({ title: "Plain title" });
    // An id alone is a title, not an id.
    expect(splitNotionName(ID)).toEqual({ title: ID });
    // Only a full 32-hex run counts.
    expect(splitNotionName("Week 12345")).toEqual({ title: "Week 12345" });
  });

  it("split paths into folder, name and extension", () => {
    expect(pathParts(`Course ${ID}/Week 1 ${ID}.md`)).toEqual({
      dir: `Course ${ID}`,
      name: `Week 1 ${ID}.md`,
      base: `Week 1 ${ID}`,
      ext: "md",
    });
    expect(pathParts("README")).toEqual({ dir: "", name: "README", base: "README", ext: "" });
    expect(pathParts(".hidden").ext).toBe("");
  });

  it("refuse entry names that leave the archive and normalize the rest", () => {
    expect(safeEntryPath("a/b.md")).toBe("a/b.md");
    expect(safeEntryPath("a\\b.md")).toBe("a/b.md");
    expect(safeEntryPath("./a/./b.md")).toBe("a/b.md");
    expect(safeEntryPath("folder/")).toBeNull();
    expect(safeEntryPath("../x")).toBe("unsafe");
    expect(safeEntryPath("a/../../x")).toBe("unsafe");
    expect(safeEntryPath("/abs")).toBe("unsafe");
    expect(safeEntryPath("\\abs")).toBe("unsafe");
    expect(safeEntryPath("C:\\x")).toBe("unsafe");
    expect(safeEntryPath("a\u0000b")).toBe("unsafe");
    expect(safeEntryPath(`${"a/".repeat(600)}x`)).toBe("unsafe");
  });

  it("resolve URL-encoded relative links against the linking file's folder", () => {
    expect(resolveRelative("Course", `Week%201%20${ID}.md`)).toBe(`Course/Week 1 ${ID}.md`);
    expect(resolveRelative("Course/Week", "../Other.md")).toBe("Course/Other.md");
    expect(resolveRelative("", "./a/b.md#section")).toBe("a/b.md");
    expect(resolveRelative("", "a.md?pvs=4")).toBe("a.md");
    expect(resolveRelative("", "../escape.md")).toBeNull();
    expect(resolveRelative("", "https://example.org/a.md")).toBeNull();
    expect(resolveRelative("", "mailto:x@y.z")).toBeNull();
    expect(resolveRelative("", "#anchor")).toBeNull();
    expect(resolveRelative("", "/absolute.md")).toBeNull();
    expect(resolveRelative("A", "Caf%C3%A9.md")).toBe("A/Café.md");
  });

  it("decode percent escapes without throwing on a stray %", () => {
    expect(safeDecode("100%25")).toBe("100%");
    expect(safeDecode("50% off%20now")).toBe("50% off now");
  });

  it("find the page id in notion.so and notion.site links", () => {
    expect(notionUrlId(`https://www.notion.so/My-Page-${ID}`)).toBe(ID);
    expect(notionUrlId(`https://www.notion.so/team/${ID}?pvs=21`)).toBe(ID);
    expect(notionUrlId("https://www.notion.so/1a2b3c4d-5e6f-7a8b-9c0d-1e2f3a4b5c6d")).toBe(ID);
    expect(notionUrlId(`https://student.notion.site/Notes-${ID}`)).toBe(ID);
    expect(notionUrlId(`https://example.org/${ID}`)).toBeNull();
    expect(notionUrlId("not a url")).toBeNull();
  });

  it("recognise desktop clutter", () => {
    expect(isJunkPath("__MACOSX/a.md")).toBe(true);
    expect(isJunkPath("x/.DS_Store")).toBe(true);
    expect(isJunkPath("x/._Page.md")).toBe(true);
    expect(isJunkPath("x/Page.md")).toBe(false);
  });
});
