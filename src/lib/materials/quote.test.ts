import { describe, expect, it } from "vitest";
import { isSpecificQuote, locateQuote, skeletonText, verifyQuote } from "./quote";

const PAGE = `Lecture 4 — Cellular respiration

Glycolysis takes place in the cyto-
plasm and splits one molecule of glucose into two molecules of pyruvate.
The “Krebs cycle” (also called the citric acid cycle) runs in the mitochondrial matrix.
Oxidative phosphorylation produces most of the cell's ATP.`;

describe("locateQuote", () => {
  it("finds an exact quote and returns its range in the page", () => {
    const quote = "Oxidative phosphorylation produces most of the cell's ATP.";
    const match = locateQuote(PAGE, quote);
    expect(match).not.toBeNull();
    // The range runs from the first to the last letter (punctuation is not compared).
    expect(PAGE.slice(match!.start, match!.end)).toBe(quote.slice(0, -1));
  });

  it("tolerates line breaks, hyphenation, case and curly quotes", () => {
    expect(
      locateQuote(PAGE, "glycolysis takes place in the cytoplasm and splits one molecule of glucose"),
    ).not.toBeNull();
    expect(locateQuote(PAGE, 'The "Krebs cycle" (also called the citric acid cycle) runs')).not.toBeNull();
    expect(locateQuote(PAGE, "OXIDATIVE   PHOSPHORYLATION produces most")).not.toBeNull();
  });

  it("tolerates ligatures and accents written differently", () => {
    expect(locateQuote("The ﬁrst eﬀect is signiﬁcant in café culture.", "The first effect is significant in cafe culture")).not.toBeNull();
  });

  it("rejects a near miss: one word changed", () => {
    expect(locateQuote(PAGE, "Oxidative phosphorylation produces all of the cell's ATP.")).toBeNull();
    expect(locateQuote(PAGE, "Glycolysis takes place in the mitochondria and splits glucose")).toBeNull();
  });

  it("rejects a fabricated quote", () => {
    expect(locateQuote(PAGE, "The electron transport chain requires oxygen as the final acceptor.")).toBeNull();
  });

  it("rejects quotes too short to prove anything", () => {
    expect(isSpecificQuote("the cell")).toBe(false);
    expect(locateQuote(PAGE, "the cell's ATP")).toBeNull();
    expect(isSpecificQuote("光合作用发生在叶绿体中")).toBe(true);
  });

  it("accepts an elided quote whose parts are close and in order, not a stitched one", () => {
    expect(
      locateQuote(PAGE, "Glycolysis takes place in the cytoplasm ... into two molecules of pyruvate"),
    ).not.toBeNull();
    // Parts out of order are not a quote.
    expect(
      locateQuote(PAGE, "into two molecules of pyruvate … Glycolysis takes place in the cytoplasm"),
    ).toBeNull();
    const far = `Alpha beta gamma delta epsilon.${" filler words here".repeat(200)} Zeta eta theta iota kappa.`;
    expect(locateQuote(far, "Alpha beta gamma delta … Zeta eta theta iota")).toBeNull();
  });

  it("stays fast on a hostile page that repeats one phrase thousands of times", () => {
    const hostile = "aaaa aaaa aaaa ".repeat(4000);
    const started = performance.now();
    expect(locateQuote(hostile, "aaaa aaaa aaaa aaaa ... aaaa aaaa zzzz")).toBeNull();
    expect(performance.now() - started).toBeLessThan(1500);
  });
});

describe("verifyQuote", () => {
  const pages = [
    "Introduction to the course and how grading works in this module.",
    "Photosynthesis converts light energy into chemical energy stored in glucose.",
    "The light reactions happen in the thylakoid membranes of the chloroplast.",
  ];

  it("corrects a page cited one off, and returns the material's own wording", () => {
    const found = verifyQuote(
      pages,
      "the light  reactions happen in the thylakoid membranes",
      2,
      { from: 1, to: 3 },
    );
    expect(found).toEqual({ page: 3, quote: "The light reactions happen in the thylakoid membranes" });
  });

  it("only searches the section's own pages", () => {
    expect(verifyQuote(pages, "Photosynthesis converts light energy into chemical energy", 2, { from: 3, to: 3 })).toBeNull();
  });

  it("returns null for text that is on no page", () => {
    expect(verifyQuote(pages, "Chlorophyll absorbs mostly green light wavelengths", 2, { from: 1, to: 3 })).toBeNull();
  });
});

describe("skeletonText", () => {
  it("keeps only letters and digits, lower-case, accent-free", () => {
    expect(skeletonText("Café-Au Lait, 2x!")).toBe("cafeaulait2x");
  });
});
