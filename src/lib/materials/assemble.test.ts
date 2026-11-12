import { describe, expect, it } from "vitest";
import { allocateByWeight, balance, dropNearDuplicates, similarity, tokensOf, verifyItems, type Verified } from "./assemble";

const entry = (section: number, page: number, order: number, front = `card ${section}-${page}-${order}`): Verified<{ front: string }> => ({
  item: { front },
  page,
  quote: `quote ${section} ${page} ${order}`,
  section,
  order,
});

describe("dropNearDuplicates", () => {
  const card = (section: number, page: number, front: string, back: string): Verified<{ front: string; back: string }> => ({
    item: { front, back },
    page,
    quote: `quote ${section} ${page}`,
    section,
    order: page,
  });

  it("drops reworded duplicates across the document, keeping the first", () => {
    const items = [
      card(0, 1, "What is the function of mitochondria in the cell?", "Aerobic respiration, making ATP"),
      card(0, 2, "What is the function of the ribosome?", "Protein synthesis"),
      card(1, 7, "What is the function of mitochondria in a cell?", "They make ATP by aerobic respiration"),
      card(1, 8, "what is the function of the ribosome?", "Building proteins"),
    ];
    const { kept, dropped } = dropNearDuplicates(items, (c) => c.front, (c) => c.back);
    expect(kept.map((k) => k.page)).toEqual([1, 2]);
    expect(dropped).toBe(2);
  });

  it("keeps contrast cards whose prompts look alike but whose answers differ", () => {
    // Seen in a live run: these share most words but are different exam questions.
    const items = [
      card(0, 5, "When demand is inelastic, how do price and total revenue move?", "In the same direction: a price rise raises revenue"),
      card(0, 5, "When demand is elastic, how do price and total revenue move?", "In opposite directions: a price rise lowers revenue"),
      card(0, 6, "What sign does the income elasticity of demand have for a normal good?", "Positive"),
      card(0, 6, "What sign does the income elasticity of demand have for an inferior good?", "Negative"),
    ];
    expect(dropNearDuplicates(items, (c) => c.front, (c) => c.back).dropped).toBe(0);
  });

  it("keeps different questions that share a few words", () => {
    const a = tokensOf("What does glycolysis produce from glucose?");
    const b = tokensOf("Where in the cell does glycolysis take place?");
    expect(similarity(a, b)).toBeLessThan(0.7);
  });
});

describe("balance", () => {
  it("gives every section its quota so the kit covers the whole document", () => {
    // The model was generous with section 0 and modest with section 2.
    const items = [
      ...Array.from({ length: 12 }, (_, i) => entry(0, 1 + (i % 3), i)),
      ...Array.from({ length: 6 }, (_, i) => entry(1, 4 + (i % 2), i)),
      ...Array.from({ length: 4 }, (_, i) => entry(2, 6, i)),
    ];
    const chosen = balance(items, [4, 4, 4], 12);
    const perSection = [0, 1, 2].map((s) => chosen.filter((c) => c.section === s).length);
    expect(perSection).toEqual([4, 4, 4]);
  });

  it("hands a short section's share to sections with spare items", () => {
    const items = [
      ...Array.from({ length: 10 }, (_, i) => entry(0, 1, i)),
      entry(1, 5, 0),
    ];
    const chosen = balance(items, [3, 3], 6);
    expect(chosen.filter((c) => c.section === 0)).toHaveLength(5);
    expect(chosen.filter((c) => c.section === 1)).toHaveLength(1);
  });

  it("rotates through a section's pages and returns document order", () => {
    const items = [entry(0, 1, 0), entry(0, 1, 1), entry(0, 1, 2), entry(0, 2, 3), entry(0, 3, 4)];
    const chosen = balance(items, [3], 3);
    expect(chosen.map((c) => c.page)).toEqual([1, 2, 3]);
  });
});

describe("verifyItems", () => {
  it("keeps items whose quote is on the section's pages and counts the rest", () => {
    const pages = ["The heart has four chambers: two atria and two ventricles."];
    const { kept, dropped } = verifyItems(
      [
        { quote: "The heart has four chambers: two atria and two ventricles", page: 1 },
        { quote: "The heart has five chambers: two atria and three ventricles", page: 1 },
      ],
      pages,
      { index: 0, from: 1, to: 1 },
    );
    expect(kept).toHaveLength(1);
    expect(dropped).toBe(1);
  });
});

describe("allocateByWeight", () => {
  it("splits by weight, never past what a kind has, and lends a short kind's share", () => {
    const weights = { mcq: 3, true_false: 1, short: 1 };
    expect(allocateByWeight(10, { mcq: 20, true_false: 20, short: 20 }, weights)).toEqual({ mcq: 6, true_false: 2, short: 2 });
    expect(allocateByWeight(10, { mcq: 20, true_false: 1, short: 20 }, weights)).toEqual({ mcq: 7, true_false: 1, short: 2 });
    expect(allocateByWeight(3, { mcq: 1, true_false: 1, short: 1 }, weights)).toEqual({ mcq: 1, true_false: 1, short: 1 });
  });
});
