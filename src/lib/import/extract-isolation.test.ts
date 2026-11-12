// @vitest-environment node
/**
 * Regression tests for the wave-1 security review of document extraction.
 * Each hostile input the reviewer measured (a 400-byte .docx that blocked the
 * event loop for 14 s, 200 KB of spaces that blocked it for 17 s, PDF
 * decompression bombs that slipped past the pre-check and inflated to 2 GB)
 * must now finish or be refused quickly, without blocking this process's
 * event loop or growing its memory, because parsing runs in a capped child
 * process. Time bounds are generous so slow CI machines do not flake.
 */
import { afterEach, describe, expect, it } from "vitest";
import {
  ExtractError,
  configureExtractionIsolation,
  docxXmlToText,
  extractSourcePages,
  extractSourceText,
  extractionLoad,
} from "./extract";
import { docx, textPdf } from "./__fixtures__/documents";
import {
  doubleDeflated,
  pdfWithContent,
  runLengthSpaces,
  spacesDeflated,
  tabRunDocx,
  unclosedTagDocx,
} from "./__fixtures__/hostile";
import { MAX_SOURCE_INPUT, normalizeSourceText } from "./syllabus";

const MB = 1024 * 1024;

let restore: ReturnType<typeof configureExtractionIsolation> | null = null;
function isolation(changes: Parameters<typeof configureExtractionIsolation>[0]) {
  const previous = configureExtractionIsolation(changes);
  restore ??= previous;
}
afterEach(() => {
  if (restore) configureExtractionIsolation(restore);
  restore = null;
});

/**
 * Run `work` while watching this process: the longest event-loop stall and
 * the resident-memory peak above the starting point.
 */
async function watched<T>(work: () => Promise<T>) {
  (globalThis as { gc?: () => void }).gc?.();
  const baseline = process.memoryUsage.rss();
  let peak = baseline;
  let last = Date.now();
  let maxGap = 0;
  const ticker = setInterval(() => {
    const now = Date.now();
    maxGap = Math.max(maxGap, now - last);
    last = now;
    peak = Math.max(peak, process.memoryUsage.rss());
  }, 10);
  const started = Date.now();
  let result: { value?: T; error?: unknown };
  try {
    result = { value: await work() };
  } catch (error) {
    result = { error };
  }
  const elapsed = Date.now() - started;
  await new Promise((resolve) => setTimeout(resolve, 30));
  clearInterval(ticker);
  return { ...result, elapsed, maxGap, rssGrowthMb: (peak - baseline) / MB };
}

function codeOf(error: unknown): string {
  if (error instanceof ExtractError) return error.code;
  throw error ?? new Error("expected the extraction to fail");
}

describe("measured attack inputs complete or are refused quickly", () => {
  it("a .docx whose XML is a long run of unclosed '<' (review: 400 bytes, 14 s blocked)", async () => {
    const file = unclosedTagDocx(200_000);
    expect(file.length).toBeLessThan(1_000);
    const run = await watched(() => extractSourceText(file, "syllabus.docx", ""));
    expect(codeOf(run.error)).toBe("no_text");
    expect(run.elapsed).toBeLessThan(10_000);
    expect(run.maxGap).toBeLessThan(1_000);

    // Ten times longer stays linear.
    const bigger = await watched(() => extractSourceText(unclosedTagDocx(2_000_000), "syllabus.docx", ""));
    expect(codeOf(bigger.error)).toBe("no_text");
    expect(bigger.elapsed).toBeLessThan(10_000);
  });

  it("the tag walk itself is linear, including long tab runs", () => {
    const started = Date.now();
    expect(docxXmlToText("<w:t>" + "<".repeat(2_000_000))).toBe("");
    const tabs = docxXmlToText("<w:t>x</w:t>" + "<w:tab/>".repeat(1_000_000), 10_000_000);
    expect(tabs.trim()).toBe("x");
    expect(Date.now() - started).toBeLessThan(4_000);
  });

  it("a .docx of a million tabs and no line break", async () => {
    const run = await watched(() => extractSourceText(tabRunDocx(1_000_000), "s.docx", ""));
    expect(run.value?.text).toBe("Course CS 101 data structures syllabus");
    expect(run.elapsed).toBeLessThan(10_000);
  });

  it("a .txt of 200 KB of spaces with no newline (review: 16.8 s blocked)", async () => {
    const bytes = new TextEncoder().encode("Course syllabus for CS 101 data structures" + " ".repeat(200_000) + "x");
    const run = await watched(() => extractSourceText(bytes, "s.txt", "text/plain"));
    expect(run.value?.kind).toBe("text");
    expect(run.elapsed).toBeLessThan(10_000);
    expect(run.maxGap).toBeLessThan(1_000);
  });

  it("a .txt at the 10 MB maximum that is all spaces and tabs", async () => {
    const bytes = new Uint8Array(10 * MB - 64).fill(0x20);
    bytes.set(new TextEncoder().encode("Course syllabus CS 101 data structures\t"), 0);
    const run = await watched(() => extractSourceText(bytes, "s.txt", "text/plain"));
    expect(run.value?.text).toContain("Course syllabus");
    expect(run.elapsed).toBeLessThan(10_000);
  });

  it("normalizeSourceText on the generate route's maximum input (review: 5.2 s)", () => {
    const started = Date.now();
    normalizeSourceText(" ".repeat(MAX_SOURCE_INPUT - 1) + "x");
    // What only the 3 MB server-action body limit used to bound.
    normalizeSourceText(" \t".repeat(1_500_000));
    expect(Date.now() - started).toBeLessThan(1_500);
  });
});

describe("PDF decompression bombs", () => {
  const TOO_BIG = 200 * MB; // past the 80 MB default cap

  it("a deflate stream with an 8 KB window (zlib header 0x58)", async () => {
    const z = await spacesDeflated(TOO_BIG, 13);
    expect(z[0]).toBe(0x58);
    const pdf = pdfWithContent(z, "/Filter /FlateDecode");
    const run = await watched(() => extractSourceText(pdf, "s.pdf", "application/pdf"));
    expect(codeOf(run.error)).toBe("too_large");
    expect(run.elapsed).toBeLessThan(30_000);
    expect(run.rssGrowthMb).toBeLessThan(150);
    expect(run.maxGap).toBeLessThan(1_000);
  });

  it("a deflate stream wrapped in ASCIIHexDecode", async () => {
    const hex = Buffer.from((await spacesDeflated(TOO_BIG)).toString("hex") + ">", "latin1");
    const pdf = pdfWithContent(hex, "/Filter [/ASCIIHexDecode /FlateDecode]");
    const run = await watched(() => extractSourceText(pdf, "s.pdf", "application/pdf"));
    expect(codeOf(run.error)).toBe("too_large");
    expect(run.elapsed).toBeLessThan(30_000);
  });

  it("a deflate stream with no endstream", async () => {
    const pdf = pdfWithContent(await spacesDeflated(TOO_BIG), "/Filter /FlateDecode", {
      endstream: false,
    });
    const run = await watched(() => extractSourceText(pdf, "s.pdf", "application/pdf"));
    expect(codeOf(run.error)).toBe("too_large");
  });

  it("deflate inside deflate, RunLength, and a /Filter given by reference", async () => {
    const twice = pdfWithContent(doubleDeflated(await spacesDeflated(TOO_BIG)), "/Filter [/FlateDecode /FlateDecode]");
    expect(codeOf((await watched(() => extractSourceText(twice, "s.pdf", "application/pdf"))).error)).toBe(
      "too_large",
    );

    const rl = pdfWithContent(runLengthSpaces(100 * MB), "/Filter /RunLengthDecode");
    expect(codeOf((await watched(() => extractSourceText(rl, "s.pdf", "application/pdf"))).error)).toBe(
      "too_large",
    );

    const byRef = pdfWithContent(await spacesDeflated(TOO_BIG), "/Filter 6 0 R", {
      extraObjects: ["/FlateDecode"],
    });
    expect(codeOf((await watched(() => extractSourceText(byRef, "s.pdf", "application/pdf"))).error)).toBe(
      "too_large",
    );
  });

  it("the course-material limits are enforced the same way", async () => {
    const pdf = pdfWithContent(await spacesDeflated(300 * MB, 13), "/Filter /FlateDecode");
    const run = await watched(() =>
      extractSourcePages(pdf, "slides.pdf", "application/pdf", {
        maxPdfInflatedBytes: 250 * MB,
        timeoutMs: 40_000,
      }),
    );
    expect(codeOf(run.error)).toBe("too_large");
    expect(run.rssGrowthMb).toBeLessThan(150);
  });

  it("a normal compressed PDF still reads", async () => {
    const ops = "BT /F1 12 Tf 72 700 Td (CS 201 Data Structures, midterm 25 percent) Tj ET";
    const pdf = pdfWithContent(doubleDeflated(Buffer.from(ops, "latin1")), "/Filter /FlateDecode");
    const result = await extractSourceText(pdf, "s.pdf", "application/pdf");
    expect(result.text).toContain("CS 201 Data Structures");
  });
});

describe("the extraction process is capped and killed", () => {
  it("is killed at its memory cap when PDF.js meets a bomb the pre-check did not catch", async () => {
    // Stand-in for any bomb the pre-check cannot measure (an encrypted one):
    // PDF.js inflates 800 MB of spaces until the watchdog kills the process
    // at 300 MB. The deadline is long so only the memory cap can end it, even
    // on a machine busy with the rest of the suite.
    isolation({ skipPdfPrecheck: true, rssLimitMb: 300 });
    const pdf = pdfWithContent(await spacesDeflated(800 * MB), "/Filter /FlateDecode");
    const run = await watched(() =>
      extractSourceText(pdf, "s.pdf", "application/pdf", { timeoutMs: 50_000 }),
    );
    expect(codeOf(run.error)).toBe("too_large");
    expect(run.elapsed).toBeLessThan(50_000);
    // The server process never held the inflated data.
    expect(run.rssGrowthMb).toBeLessThan(150);
    expect(run.maxGap).toBeLessThan(1_000);
    expect(extractionLoad()).toEqual({ active: 0, waiting: 0 });
  }, 120_000);

  it("is stopped by its heap cap", async () => {
    isolation({ heapLimitMb: 32 });
    const bytes = new TextEncoder().encode("Course syllabus CS 101 data structures\n" + "a \n".repeat(3_000_000));
    const run = await watched(() => extractSourceText(bytes, "s.txt", "text/plain"));
    expect(codeOf(run.error)).toBe("too_large");
    expect(run.elapsed).toBeLessThan(20_000);
  }, 30_000);

  it("is killed at its deadline whatever the format", async () => {
    isolation({ maxTimeoutMs: 1, killGraceMs: 0 });
    const run = await watched(() => extractSourceText(docx(["BIO 110 Cell Biology syllabus"]), "s.docx", ""));
    expect(codeOf(run.error)).toBe("timeout");
    expect(run.elapsed).toBeLessThan(10_000);
    expect(extractionLoad()).toEqual({ active: 0, waiting: 0 });
  });

  it("runs at most maxConcurrent processes and refuses past the queue", async () => {
    isolation({ maxConcurrent: 1, maxQueued: 1, maxWaitMs: 20_000 });
    const file = () => textPdf(["PSY 101 Intro to Psychology, final exam 40 percent"]);
    const first = extractSourceText(file(), "a.pdf", "application/pdf");
    const second = extractSourceText(file(), "b.pdf", "application/pdf");
    const third = extractSourceText(file(), "c.pdf", "application/pdf");
    await expect(third).rejects.toMatchObject({ code: "busy" });
    expect(extractionLoad()).toEqual({ active: 1, waiting: 1 });
    await expect(first).resolves.toMatchObject({ kind: "pdf" });
    await expect(second).resolves.toMatchObject({ kind: "pdf" });
    expect(extractionLoad()).toEqual({ active: 0, waiting: 0 });
  });

  it("gives up waiting for a slot after maxWaitMs", async () => {
    isolation({ maxConcurrent: 1, maxQueued: 4, maxWaitMs: 1 });
    const first = extractSourceText(textPdf(["PSY 101 Intro to Psychology"]), "a.pdf", "application/pdf");
    const waiting = extractSourceText(textPdf(["PSY 101 Intro to Psychology"]), "b.pdf", "application/pdf");
    await expect(waiting).rejects.toMatchObject({ code: "busy" });
    await first;
    expect(extractionLoad()).toEqual({ active: 0, waiting: 0 });
  });
});
