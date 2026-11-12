// @vitest-environment node
/**
 * Regression tests for the second security review of document extraction
 * (probes in sec2/materials). Each hostile input must now finish quickly and
 * within bounds; time bounds are generous so slow CI machines do not flake.
 *
 * - A 100 KB .docx of 420,000 one-character pages extracted to 266,667 pages,
 *   and one section's quote check then took 60 s on the main thread.
 * - A 58 KB PDF drawing one form 5,000 times took 19 s and 625 MB, because a
 *   page's whole text was built before the length cap was checked.
 * - "/Fl#61teDecode" (an escaped FlateDecode) skipped the bomb pre-check.
 * - One account could hold every extraction process of an instance.
 */
import { afterEach, describe, expect, it } from "vitest";
import { MAX_MATERIAL_CHARS, MAX_MATERIAL_PAGES, MAX_MATERIAL_PDF_PAGES } from "@/lib/materials/limits";
import { verifyItems } from "@/lib/materials/assemble";
import { capPages } from "@/lib/materials/pages";
import { verifyQuote } from "@/lib/materials/quote";
import {
  assertPdfStreamsBounded,
  configureExtractionIsolation,
  ExtractError,
  extractionLoad,
  extractSourcePages,
  extractSourceText,
} from "./extract";
import { formXObjectPdf, pdfWithContent, spacesDeflated, tinyPagesDocx } from "./__fixtures__/hostile";

const MB = 1024 * 1024;
const MATERIAL_LIMITS = {
  maxBytes: 10 * MB,
  maxPdfPages: MAX_MATERIAL_PDF_PAGES,
  maxChars: MAX_MATERIAL_CHARS,
  timeoutMs: 40_000,
  maxPdfInflatedBytes: 250 * MB,
};

let restore: ReturnType<typeof configureExtractionIsolation> | null = null;
afterEach(() => {
  if (restore) configureExtractionIsolation(restore);
  restore = null;
});

async function timed<T>(work: () => Promise<T>): Promise<{ value?: T; error?: unknown; ms: number }> {
  const t0 = performance.now();
  try {
    const value = await work();
    return { value, ms: performance.now() - t0 };
  } catch (error) {
    return { error, ms: performance.now() - t0 };
  }
}

describe("page counts are bounded for every format", () => {
  it("a .docx of 420,000 one-character pages becomes at most MAX_MATERIAL_PAGES pages", async () => {
    const bytes = tinyPagesDocx(420_000);
    expect(bytes.byteLength).toBeLessThan(400_000);
    const run = await timed(() => extractSourcePages(bytes, "tiny.docx", "", MATERIAL_LIMITS));
    expect(run.error).toBeUndefined();
    expect(run.ms).toBeLessThan(20_000);
    const pages = run.value!.pages;
    expect(pages.length).toBeLessThanOrEqual(MAX_MATERIAL_PDF_PAGES);
    // Nothing was dropped by the packing: the letters are all still there.
    expect(pages.join("").replace(/\s+/g, "").length).toBeGreaterThan(100_000);
  }, 60_000);

  it("capPages packs any page list to the cap, keeping text and order", () => {
    const pages = Array.from({ length: 266_667 }, (_, i) => `p${i}`);
    const t0 = performance.now();
    const packed = capPages(pages);
    expect(performance.now() - t0).toBeLessThan(2000);
    expect(packed.length).toBeLessThanOrEqual(MAX_MATERIAL_PAGES);
    expect(packed[0].startsWith("p0")).toBe(true);
    expect(packed.at(-1)!.endsWith("p266666")).toBe(true);
    expect(capPages(["a", "b"])).toEqual(["a", "b"]);
  });
});

describe("quote verification only reads the cited page and its neighbours", () => {
  it("36 unverifiable quotes over 12,000 tiny pages (review: 60 s)", () => {
    const pages = Array.from({ length: 266_667 }, () => "a");
    const range = { index: 0, from: 1, to: 12_000 };
    const quote = "lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor ".repeat(8).slice(0, 590);
    const items = Array.from({ length: 36 }, (_, i) => ({ front: `f${i}`, back: "b", page: 1, quote }));
    const uncited = items.map((item) => ({ front: item.front, back: item.back, quote: item.quote }));
    const t0 = performance.now();
    const cited = verifyItems(items, pages, range, new Map());
    const without = verifyItems(uncited, pages, range, new Map());
    expect(performance.now() - t0).toBeLessThan(2000);
    expect(cited.kept).toHaveLength(0);
    expect(without.kept).toHaveLength(0);
  });

  it("still finds a quote one page off, and refuses one far from the cited page", () => {
    const pages = ["intro page text here", "The mitochondria produce most of the cell's ATP by oxidative phosphorylation.", "end"];
    const quote = "mitochondria produce most of the cell's ATP";
    expect(verifyQuote(pages, quote, 3, { from: 1, to: 3 })).toMatchObject({ page: 2 });
    expect(verifyQuote(pages, quote, undefined, { from: 1, to: 3 })).toMatchObject({ page: 2 });
    const far = [...pages, "x", "y", "z"];
    expect(verifyQuote(far, quote, 6, { from: 1, to: 6 })).toBeNull();
  });
});

describe("PDF text stops at the length cap", () => {
  it("a page drawing one text-heavy form 5,000 times (review: 19 s, 625 MB)", async () => {
    const bytes = formXObjectPdf(5_000);
    expect(bytes.byteLength).toBeLessThan(100_000);
    const run = await timed(() => extractSourcePages(bytes, "a.pdf", "application/pdf", MATERIAL_LIMITS));
    expect(run.ms).toBeLessThan(15_000);
    if (run.value) {
      expect(run.value.totalChars).toBeLessThanOrEqual(MAX_MATERIAL_CHARS);
      expect(run.value.truncated).toBe(true);
    } else {
      // Refusing it outright is also acceptable; hanging or exhausting memory is not.
      expect(run.error).toBeInstanceOf(ExtractError);
    }
  }, 60_000);
});

describe("escaped filter names", () => {
  it("/Fl#61teDecode and /F#69lter are measured by the bomb pre-check", async () => {
    const bomb = await spacesDeflated(300 * MB);
    for (const dictionary of ["/Filter /Fl#61teDecode", "/F#69lter /FlateDecode", "/Filter [/Fl#61te#44ecode]"]) {
      const pdf = pdfWithContent(bomb, dictionary);
      const t0 = performance.now();
      expect(() => assertPdfStreamsBounded(pdf, 250 * MB)).toThrow(ExtractError);
      expect(performance.now() - t0).toBeLessThan(15_000);
    }
  }, 120_000);
});

describe("one extraction per account", () => {
  it("a second extraction for the same account is refused while the first runs, across both entry points", async () => {
    const slow = await spacesDeflated(1 * MB);
    const pdf = pdfWithContent(slow, "/Filter /FlateDecode");
    const first = extractSourcePages(pdf, "a.pdf", "application/pdf", { ...MATERIAL_LIMITS, owner: "user_a" });
    await expect(extractSourceText(pdf, "a.pdf", "application/pdf", { owner: "user_a" })).rejects.toMatchObject({
      code: "busy",
    });
    // Another account is not affected.
    const other = extractSourceText(pdf, "b.pdf", "application/pdf", { owner: "user_b" });
    await Promise.allSettled([first, other]);
    expect(extractionLoad()).toEqual({ active: 0, waiting: 0 });
    // Once the first finished, the account may extract again.
    await expect(extractSourceText(pdf, "a.pdf", "application/pdf", { owner: "user_a" })).resolves.toBeDefined();
  }, 60_000);

  it("a waiting extraction also counts as the account's one", async () => {
    restore = configureExtractionIsolation({ maxConcurrent: 1 });
    const pdf = pdfWithContent(await spacesDeflated(1 * MB), "/Filter /FlateDecode");
    const running = extractSourceText(pdf, "a.pdf", "application/pdf", { owner: "user_c" });
    const queued = extractSourceText(pdf, "b.pdf", "application/pdf", { owner: "user_d" });
    await expect(extractSourceText(pdf, "c.pdf", "application/pdf", { owner: "user_d" })).rejects.toMatchObject({
      code: "busy",
    });
    await Promise.allSettled([running, queued]);
  }, 60_000);
});
