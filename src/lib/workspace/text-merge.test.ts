import { describe, expect, it } from "vitest";
import { lcsPairs, merge3, tokenize } from "./text-merge";

describe("tokenize", () => {
  it("splits words, spaces, punctuation and single CJK characters", () => {
    expect(tokenize("Hi, there  you")).toEqual(["Hi", ",", " ", "there", "  ", "you"]);
    expect(tokenize("学习abc")).toEqual(["学", "习", "abc"]);
    expect(tokenize("").length).toBe(0);
  });
});

describe("lcsPairs", () => {
  it("finds a longest common subsequence", () => {
    const pairs = lcsPairs(["a", "b", "c", "d"], ["a", "x", "c", "d"])!;
    expect(pairs).toEqual([
      [0, 0],
      [2, 2],
      [3, 3],
    ]);
  });
});

describe("merge3", () => {
  it("combines edits in different places", () => {
    expect(merge3("the cat sat", "the black cat sat", "the cat sat down")).toEqual({
      ok: true,
      text: "the black cat sat down",
    });
    expect(
      merge3(
        "Mitochondria make ATP. Ribosomes make proteins.",
        "Mitochondria make ATP via respiration. Ribosomes make proteins.",
        "Mitochondria make ATP. Ribosomes build proteins.",
      ),
    ).toEqual({
      ok: true,
      text: "Mitochondria make ATP via respiration. Ribosomes build proteins.",
    });
  });

  it("takes the one side that changed, or the same change made twice", () => {
    expect(merge3("a", "a", "b")).toEqual({ ok: true, text: "b" });
    expect(merge3("a", "b", "a")).toEqual({ ok: true, text: "b" });
    expect(merge3("a", "b", "b")).toEqual({ ok: true, text: "b" });
  });

  it("reports a conflict when both changed the same words", () => {
    expect(merge3("hi", "hi and my new sentence", "Hello (agent fixed grammar)").ok).toBe(false);
    expect(merge3("one two three", "one 2 three", "one zwei three").ok).toBe(false);
  });
});
