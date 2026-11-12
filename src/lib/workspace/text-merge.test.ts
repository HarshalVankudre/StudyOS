import { describe, expect, it } from "vitest";
import { lcsPairs, merge3, tokenize } from "./text-merge";

describe("tokenize", () => {
  it("splits words, spaces, punctuation and single CJK characters", () => {
    expect(tokenize("Hi, there  you")).toEqual(["Hi", ",", " ", "there", "  ", "you"]);
    expect(tokenize("学习abc")).toEqual(["学", "习", "abc"]);
    expect(tokenize("COVID19 and A1x2")).toEqual(["COVID19", " ", "and", " ", "A1x2"]);
    expect(tokenize("").length).toBe(0);
  });

  it("keeps emoji and other grapheme clusters whole", () => {
    expect(tokenize("ok 👍🏽 👨‍👩‍👧 🇩🇪")).toEqual(["ok", " ", "👍🏽", " ", "👨‍👩‍👧", " ", "🇩🇪"]);
    expect(tokenize("café")).toEqual(["café"]);
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
    expect(merge3("hi there", "hi and my new sentence", "Hello (agent fixed grammar)").ok).toBe(false);
    expect(merge3("one two three", "one 2 three", "one zwei three").ok).toBe(false);
  });

  it("combines a change to a word with text added right after it", () => {
    expect(merge3("hi", "hi and my new sentence", "Hello")).toEqual({
      ok: true,
      text: "Hello and my new sentence",
    });
  });

  // Second review, F2: the same insertion on both sides, aligned one space
  // apart, was kept twice and reported as clean.
  it("counts an insertion both sides contain once", () => {
    const cases: [string, string, string][] = [
      ["the cell is the unit of life", "the cell is the basic unit of life", "Biology: the cell is the basic unit of life"],
      ["energy flows and matter cycles", "energy flows [A3] and matter cycles", "[B2] energy flows [A3] and matter cycles"],
      ["Photosynthesis makes sugar.", "Photosynthesis makes sugar in the chloroplast.", "In plants, photosynthesis makes sugar in the chloroplast."],
      ["Rome fell in 476.", "Rome fell in 476 AD.", "The Western Roman Empire: Rome fell in 476 AD."],
      ["الخلية هي وحدة الحياة", "الخلية هي الوحدة الأساسية للحياة", "في علم الأحياء: الخلية هي الوحدة الأساسية للحياة"],
      ["細胞は生命の単位です。", "細胞は生命の基本単位です。", "生物学：細胞は生命の基本単位です。"],
      ["I love it 👍", "I love it 👍🏽 a lot", "Honestly, I love it 👍🏽 a lot"],
    ];
    for (const [base, ours, theirs] of cases) {
      expect(merge3(base, ours, theirs)).toEqual({ ok: true, text: theirs });
      expect(merge3(base, theirs, ours)).toEqual({ ok: true, text: theirs });
    }
  });

  // Browser QA: two tabs each appended a sentence to one paragraph.
  it("keeps both sentences when two people append to the same paragraph", () => {
    expect(
      merge3("Cells are small.", "Cells are small. They divide.", "Cells are small. They have a nucleus."),
    ).toEqual({ ok: true, text: "Cells are small. They have a nucleus. They divide." });
  });

  it("combines a deletion with an insertion right next to it", () => {
    expect(merge3("a X b", "a b", "a X Y b")).toEqual({ ok: true, text: "a Y b" });
  });

  it("never drops a deletion next to an identical insertion", () => {
    // One side deletes [B2]; the other inserts [C3] right after it.
    const r = merge3("a [B2] b", "a b", "a [B2] [C3] b");
    if (r.ok) expect(r.text).toBe("a [C3] b");
  });

  it("takes an insertion once when the other side's insertion at the same spot already contains it", () => {
    // An undo restores [A9] where the other side has [A9] and typed more.
    expect(merge3("new", "new [A9]", "new [A9] [A16]")).toEqual({ ok: true, text: "new [A9] [A16]" });
    expect(merge3("x", "x They divide.", "x They divide. Cells grow.")).toEqual({
      ok: true,
      text: "x They divide. Cells grow.",
    });
  });

  it("removes two neighbouring words deleted on different sides", () => {
    expect(merge3("the [B14] [B12] unit", "the [B12] unit", "the [B14] unit")).toEqual({
      ok: true,
      text: "the unit",
    });
  });

  it("does not place a new word twice when both sides add it in different places", () => {
    // A restore of [B12] meeting a copy that already has it a word away.
    expect(merge3("the [B14] unit", "the [B14] [B12] unit", "the [B12] unit")).toEqual({ ok: false });
  });
});

// ---------------------------------------------------------------------------
// Property fuzz (adopted from the second review): every clean merge must keep
// each unique marker exactly as the two edits imply, across scripts.
// SYNC_FUZZ_TEXT_CASES raises the case count (the review ran 600,000).
// ---------------------------------------------------------------------------

function mulberry32(seed: number) {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ALPHABETS: Record<string, string[]> = {
  latin: ["the", "cell", "is", "a", "unit", "of", "life", "and", "energy", "flows", "cell", "the"],
  emoji: ["👍🏽", "👨‍👩‍👧", "🇩🇪", "❤️", "é", "é", "ok", "👍", "🏽"],
  rtl: ["الخلية", "هي", "وحدة", "الحياة", "‏", "שלום", "עולם", "و"],
  cjk: ["細胞", "は", "生命", "の", "単位", "です", "。", "細", "胞"],
  mixed: ["2026-11-12", "https://a.b/c", "x", "—", "...", "(", ")", '"', "'", "\n"],
};
const MARK = /\[M\d+\]|M\d+x|«\d+»/gu;
const marks = (s: string): string[] => s.match(MARK) ?? [];

export function fuzzMerge(seed: number, cases: number) {
  const rnd = mulberry32(seed);
  const pick = <T,>(a: readonly T[]): T => a[Math.floor(rnd() * a.length)];
  let id = 0;
  const marker = (style: string) => {
    id += 1;
    return style === "bracket" ? `[M${id}]` : style === "plain" ? `M${id}x` : `«${id}»`;
  };
  const edit = (words: string[], style: string, alphabet: string[]) => {
    const w = words.slice();
    const n = 1 + Math.floor(rnd() * 3);
    for (let i = 0; i < n; i += 1) {
      const r = rnd();
      const markerIdx = w.map((x, j) => (marks(x).length ? j : -1)).filter((j) => j >= 0);
      if (r < 0.45) w.splice(Math.floor(rnd() * (w.length + 1)), 0, marker(style));
      else if (r < 0.75 && markerIdx.length) w.splice(pick(markerIdx), 1);
      else if (r < 0.9 && w.length) w.splice(Math.floor(rnd() * w.length), 1, pick(alphabet));
      else w.splice(Math.floor(rnd() * (w.length + 1)), 0, pick(alphabet));
    }
    return w;
  };
  const stats = { runs: 0, clean: 0, conflicts: 0, garbled: 0, joinMismatch: 0 };
  const examples: string[] = [];
  for (let run = 0; run < cases; run += 1) {
    const alphaName = pick(Object.keys(ALPHABETS));
    const alphabet = ALPHABETS[alphaName];
    const style = pick(["bracket", "plain", "guillemet"]);
    const sep = alphaName === "cjk" && rnd() < 0.5 ? "" : " ";
    const baseWords: string[] = [];
    const len = 2 + Math.floor(rnd() * 10);
    for (let i = 0; i < len; i += 1) baseWords.push(rnd() < 0.35 ? marker(style) : pick(alphabet));
    const base = baseWords.join(sep);
    const ours = edit(baseWords, style, alphabet).join(sep);
    const theirs = edit(baseWords, style, alphabet).join(sep);
    for (const t of [base, ours, theirs]) if (tokenize(t).join("") !== t) stats.joinMismatch += 1;
    stats.runs += 1;
    const r = merge3(base, ours, theirs);
    if (!r.ok) {
      stats.conflicts += 1;
      continue;
    }
    stats.clean += 1;
    const all = new Set([...marks(base), ...marks(ours), ...marks(theirs)]);
    const got = marks(r.text);
    let bad = "";
    for (const m of all) {
      const want = marks(base).includes(m)
        ? marks(ours).includes(m) && marks(theirs).includes(m)
        : marks(ours).includes(m) || marks(theirs).includes(m);
      const n = got.filter((x) => x === m).length;
      if (n > 1) bad = `${m} x${n}`;
      else if ((n === 1) !== want) bad = `${m} ${n ? "present" : "missing"}`;
      if (bad) break;
    }
    if (!bad && /�/.test(r.text)) bad = "replacement char";
    if (bad) {
      stats.garbled += 1;
      if (examples.length < 5) examples.push(`${bad}: ${JSON.stringify({ base, ours, theirs, merged: r.text })}`);
    }
  }
  return { stats, examples };
}

describe("merge3 property fuzz (second review, F2)", () => {
  it("never returns a clean merge that loses, duplicates or invents a marker", () => {
    const cases = Number(process.env.SYNC_FUZZ_TEXT_CASES ?? 60_000);
    const { stats, examples } = fuzzMerge(1, cases);
    expect(examples).toEqual([]);
    expect(stats.garbled).toBe(0);
    expect(stats.joinMismatch).toBe(0);
    // A merge that conflicts on everything would pass trivially: most must merge.
    expect(stats.clean / stats.runs).toBeGreaterThan(0.4);
  }, 120_000);
});
