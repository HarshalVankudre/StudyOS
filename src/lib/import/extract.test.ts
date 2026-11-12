// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  ExtractError,
  MAX_UPLOAD_BYTES,
  detectSourceKind,
  docxXmlToText,
  extractSourceText,
} from "./extract";
import { MAX_SOURCE_TEXT } from "./syllabus";
import {
  docx,
  docxBomb,
  flateBombPdf,
  graphicsOnlyPdf,
  textPdf,
} from "./__fixtures__/documents";

async function extractError(promise: Promise<unknown>): Promise<ExtractError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof ExtractError) return error;
    throw error;
  }
  throw new Error("expected extraction to fail");
}

describe("extractSourceText — PDF", () => {
  it("reads the text layer of a PDF", async () => {
    const pdf = textPdf([
      "CS 201 Data Structures",
      "Grading: Midterm 25%, Final 35%, Homework 40%",
      "Midterm exam: March 5, 2027",
    ]);
    const result = await extractSourceText(pdf, "syllabus.pdf", "application/pdf");
    expect(result.kind).toBe("pdf");
    expect(result.pages).toBe(1);
    expect(result.text).toContain("CS 201 Data Structures");
    expect(result.text).toContain("Midterm 25%, Final 35%, Homework 40%");
    expect(result.text).toContain("March 5, 2027");
  });

  it("detects a PDF by its bytes even with a misleading name", async () => {
    const result = await extractSourceText(textPdf(["Organic Chemistry syllabus, fall term"]), "notes.txt", "text/plain");
    expect(result.kind).toBe("pdf");
  });

  it("reports a scanned PDF (no text layer) as no_text", async () => {
    const error = await extractError(
      extractSourceText(graphicsOnlyPdf(), "scan.pdf", "application/pdf"),
    );
    expect(error.code).toBe("no_text");
    expect(error.kind).toBe("pdf");
  });

  it("refuses a flate bomb before PDF.js inflates it", async () => {
    const error = await extractError(
      extractSourceText(flateBombPdf(120 * 1024 * 1024), "bomb.pdf", "application/pdf"),
    );
    expect(error.code).toBe("too_large");
  });

  it("gives up on a PDF that takes longer than the deadline", async () => {
    const error = await extractError(
      extractSourceText(textPdf(["Some syllabus text that is long enough"]), "slow.pdf", "application/pdf", {
        timeoutMs: 0,
      }),
    );
    expect(error.code).toBe("timeout");
  });

  it("reports a damaged PDF as unreadable", async () => {
    const broken = new Uint8Array(Buffer.from("%PDF-1.4\nthis is not really a pdf", "latin1"));
    const error = await extractError(extractSourceText(broken, "broken.pdf", "application/pdf"));
    expect(["unreadable", "no_text"]).toContain(error.code);
  });
});

describe("extractSourceText — .docx", () => {
  it("reads paragraphs and keeps table cells apart", async () => {
    const file = docx([
      "BIO 110 Cell Biology",
      "Grade breakdown",
      ["Midterm", "25%"],
      ["Final exam", "35%"],
      "Lab reports & quizzes — due weekly",
    ]);
    const result = await extractSourceText(
      file,
      "syllabus.docx",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    );
    expect(result.kind).toBe("docx");
    expect(result.text).toContain("BIO 110 Cell Biology");
    expect(result.text).toContain("Midterm\t25%");
    expect(result.text).toContain("Final exam\t35%");
    expect(result.text).toContain("Lab reports & quizzes");
  });

  it("refuses a zip bomb instead of inflating it all", async () => {
    const error = await extractError(
      extractSourceText(docxBomb(64 * 1024 * 1024), "bomb.docx", ""),
    );
    expect(error.code).toBe("too_large");
  });

  it("reports a .docx without a document body as unreadable", async () => {
    const { zipSync, strToU8 } = await import("fflate");
    const empty = zipSync({ "other.xml": strToU8("<x/>") });
    const error = await extractError(extractSourceText(empty, "x.docx", ""));
    expect(error.code).toBe("unreadable");
  });

  it("decodes entities and ignores markup outside text runs", () => {
    const xml =
      '<w:body><w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>A &amp; B &lt;3&#x21;</w:t></w:r><w:r><w:tab/><w:t>C</w:t></w:r></w:p><w:p><w:r><w:t>D</w:t><w:br/><w:t>E</w:t></w:r></w:p></w:body>';
    expect(docxXmlToText(xml)).toBe("A & B <3!\tC\nD\nE\n");
  });
});

describe("extractSourceText — limits and other formats", () => {
  it("reads UTF-8 text and Markdown", async () => {
    const bytes = new TextEncoder().encode("# PSY 101\nFinal exam — Dec 12\n");
    const result = await extractSourceText(bytes, "syllabus.md", "text/markdown");
    expect(result.kind).toBe("text");
    expect(result.text).toBe("# PSY 101\nFinal exam — Dec 12");
  });

  it("rejects oversized uploads before parsing", async () => {
    const big = new Uint8Array(MAX_UPLOAD_BYTES + 1);
    const error = await extractError(extractSourceText(big, "big.pdf", "application/pdf"));
    expect(error.code).toBe("too_large");
  });

  it("rejects unsupported formats (legacy .doc, images)", async () => {
    const doc = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
    expect((await extractError(extractSourceText(doc, "old.doc", "application/msword"))).code).toBe(
      "unsupported",
    );
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect((await extractError(extractSourceText(png, "photo.png", "image/png"))).code).toBe(
      "unsupported",
    );
  });

  it("reports how much text there was when it is longer than the prompt will use", async () => {
    const long = "Week 1 reading and problem set.\n".repeat(Math.ceil((MAX_SOURCE_TEXT * 1.5) / 32));
    const result = await extractSourceText(new TextEncoder().encode(long), "long.txt", "text/plain");
    expect(result.totalChars).toBeGreaterThan(MAX_SOURCE_TEXT);
  });

  it("treats a zip that is not named .docx as unsupported", () => {
    const zip = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0, 0]);
    expect(detectSourceKind(zip, "archive.zip", "application/zip")).toBeNull();
  });
});
