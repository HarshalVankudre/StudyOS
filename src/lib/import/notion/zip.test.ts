// @vitest-environment node
import { describe, expect, it } from "vitest";
import { NOTION_IMPORT_LIMITS, NotionImportError, SkipLog, type NotionImportLimits } from "./limits";
import { openArchive } from "./zip";
import { makeZip, withDeclaredSize, withEncryptedFlag } from "./zip-fixture";

const limits = (changes: Partial<NotionImportLimits> = {}): NotionImportLimits => ({ ...NOTION_IMPORT_LIMITS, ...changes });

function open(bytes: Uint8Array, changes: Partial<NotionImportLimits> = {}, skip = new SkipLog()) {
  return openArchive(bytes, { limits: limits(changes), deadline: Date.now() + 10_000, skip });
}

function codeOf(fn: () => unknown): string | null {
  try {
    fn();
    return null;
  } catch (error) {
    return error instanceof NotionImportError ? error.code : `other: ${String(error)}`;
  }
}

const text = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

describe("openArchive", () => {
  it("lists the files with their paths and reads them on demand", () => {
    const files = open(makeZip({ "Notes 1.md": "# Notes", "Folder/Sub.md": "hello", "Folder/": new Uint8Array() }));
    expect(files.map((f) => f.path)).toEqual(["Notes 1.md", "Folder/Sub.md"]);
    expect(text(files[1].read())).toBe("hello");
  });

  it("reads stored and deflated entries alike", () => {
    const body = "x".repeat(5_000);
    for (const level of [0, 9] as const) {
      const [file] = open(makeZip({ "a.md": body }, level));
      expect(text(file.read())).toBe(body);
    }
  });

  it("refuses what is not a zip", () => {
    expect(codeOf(() => open(new TextEncoder().encode("just some text, not a zip")))).toBe("not_zip");
    expect(codeOf(() => open(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3])))).toBe("not_zip");
  });

  it("refuses an upload over the size limit before reading it", () => {
    const zip = makeZip({ "a.md": "a".repeat(2_000) }, 0);
    expect(codeOf(() => open(zip, { maxUploadBytes: 1_000 }))).toBe("too_large");
    expect(NOTION_IMPORT_LIMITS.maxUploadBytes).toBe(25 * 1024 * 1024);
  });

  it("refuses more entries than the limit (5,000 by default), counted across nested zips", () => {
    const many: Record<string, string> = {};
    for (let i = 0; i <= NOTION_IMPORT_LIMITS.maxEntries; i += 1) many[`p${i}.md`] = "x";
    expect(codeOf(() => open(makeZip(many, 0)))).toBe("too_many_files");

    const inner = makeZip({ "a.md": "a", "b.md": "b", "c.md": "c" });
    const outer = makeZip({ "Part-1.zip": inner, "top.md": "t" }, 0);
    expect(codeOf(() => open(outer, { maxEntries: 4 }))).toBe("too_many_files");
    expect(open(outer, { maxEntries: 5 }).map((f) => f.path).sort()).toEqual(["a.md", "b.md", "c.md", "top.md"]);
  });

  it("refuses an archive that declares more uncompressed bytes than the total limit (120 MB by default)", () => {
    const zip = makeZip({ "a.md": "a".repeat(3_000), "b.md": "b".repeat(3_000) }, 0);
    expect(codeOf(() => open(zip, { maxTotalBytes: 5_000 }))).toBe("too_large");
    expect(open(zip, { maxTotalBytes: 6_000 })).toHaveLength(2);
    expect(NOTION_IMPORT_LIMITS.maxTotalBytes).toBe(120 * 1024 * 1024);
  });

  it("refuses an entry whose compression ratio looks like a bomb", () => {
    const bomb = makeZip({ "big.csv": new Uint8Array(2 * 1024 * 1024) }, 9);
    expect(codeOf(() => open(bomb))).toBe("unsafe");
    // Small files may compress as well as they like.
    expect(open(makeZip({ "small.md": new Uint8Array(100_000) }, 9))).toHaveLength(1);
  });

  it("never inflates past the size the directory declares", () => {
    const zip = withDeclaredSize(makeZip({ "a.md": "y".repeat(50_000) }, 9), 1_000);
    const [file] = open(zip);
    expect(codeOf(() => file.read())).toBe("unsafe");
  });

  it("refuses paths that leave the archive: .., absolute, drive letters, backslashes", () => {
    for (const name of ["../evil.md", "a/../../evil.md", "/etc/passwd.md", "C:/Windows/x.md", "..\\evil.md", "a\\..\\..\\x.md"]) {
      expect(codeOf(() => open(makeZip({ [name]: "x", "ok.md": "y" }))), name).toBe("unsafe");
    }
    // "." segments and doubled slashes are harmless and normalized.
    expect(open(makeZip({ "./a//b.md": "x" })).map((f) => f.path)).toEqual(["a/b.md"]);
  });

  it("refuses encrypted entries", () => {
    expect(codeOf(() => open(withEncryptedFlag(makeZip({ "a.md": "secret" }))))).toBe("encrypted");
  });

  it("opens Notion's part zips at the root and merges them", () => {
    const outer = makeZip(
      {
        "Export-1-Part-1.zip": makeZip({ "Course abc.md": "# Course", "Course abc/Week 1.md": "w1" }),
        "Export-1-Part-2.zip": makeZip({ "Course abc/Week 2.md": "w2", "Course abc.md": "duplicate" }),
      },
      0,
    );
    const files = open(outer);
    expect(files.map((f) => f.path)).toEqual(["Course abc.md", "Course abc/Week 1.md", "Course abc/Week 2.md"]);
    expect(text(files[0].read())).toBe("# Course");
  });

  it("opens zips two levels deep at most and reports the deeper ones", () => {
    const level3 = makeZip({ "deep.md": "too deep" });
    const level2 = makeZip({ "inner.md": "inner", "Part-9.zip": level3 });
    const skip = new SkipLog();
    const files = open(makeZip({ "Part-1.zip": level2 }, 0), {}, skip);
    expect(files.map((f) => f.path)).toEqual(["inner.md"]);
    expect(skip.list()).toEqual([{ reason: "nested_zip", count: 1, examples: ["Part-9.zip"] }]);
    expect(NOTION_IMPORT_LIMITS.maxDepth).toBe(2);
  });

  it("leaves a zip attached inside a page alone", () => {
    const files = open(makeZip({ "Page abc.md": "p", "Page abc/code.zip": makeZip({ "x.md": "x" }) }));
    expect(files.map((f) => f.path)).toEqual(["Page abc.md", "Page abc/code.zip"]);
  });

  it("shares one inflation budget across nested archives", () => {
    const inner = makeZip({ "a.md": "a".repeat(4_000) }, 0);
    const outer = makeZip({ "Part-1.zip": inner }, 0);
    // Declared: the inner zip (~4 KB) plus its entry (4 KB).
    expect(codeOf(() => open(outer, { maxTotalBytes: 6_000 }))).toBe("too_large");
  });

  it("stops when the time budget is over", () => {
    expect(codeOf(() => openArchive(makeZip({ "a.md": "a" }), { limits: limits(), deadline: Date.now() - 1, skip: new SkipLog() }))).toBe("timeout");
  });
});
