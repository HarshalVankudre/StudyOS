/**
 * Third sync review, finding 9: a clean three-way merge must hold everything
 * either side added exactly once and nothing either side removed; anything
 * less sure is a conflict. The reviewer's adversarial fuzz (repeated words,
 * scripts without spaces, spacing changes, moved text, one side already
 * holding the other's addition) is part of the suite here.
 *   SYNC_FUZZ_TEXT_CASES=20000 raises the runs per category (default 400).
 */
import { describe, expect, it } from "vitest";
import { merge3, tokenize } from "./text-merge";

describe("merge3: the cases the third review reproduced", () => {
  it("does not lose a repeated word when the diffs could explain an edit as a move", () => {
    const merged = merge3("gamma gamma gamma [O1]", "gamma [A2] gamma gamma", "[B3] gamma gamma gamma");
    // The old result, reported clean: "[B3] [A2] gamma gamma" (a word gone).
    if (merged.ok) expect(merged.text).toBe("[B3] gamma [A2] gamma gamma");
  });

  it("does not write an addition twice when the other side already holds it and both typed on", () => {
    // The closing-tab shape: both extend "[B5]" at the same spot.
    expect(merge3("alpha", "alpha [B5] [B9]", "alpha [B5] [A6]")).toEqual({ ok: false });
    // The other side holds this side's whole addition and more: once.
    expect(merge3("alpha", "alpha [B5]", "alpha [B5] [A6]")).toEqual({ ok: true, text: "alpha [B5] [A6]" });
  });

  it("treats a script written without spaces character by character, not as one word", () => {
    expect(tokenize("เซลล์เป็นหน่วย").length).toBeGreaterThan(3);
    // Edits at the two ends of a Thai sentence combine.
    expect(merge3("เซลล์เป็นหน่วยของชีวิต", "[A1]เซลล์เป็นหน่วยของชีวิต", "เซลล์เป็นหน่วยของชีวิต[B2]")).toEqual({
      ok: true,
      text: "[A1]เซลล์เป็นหน่วยของชีวิต[B2]",
    });
  });

  it("text one side moved while the other changed something is a conflict, never a guess", () => {
    expect(merge3("is the the the the [O1]", "the is the the the [O1]", "is [B1] [B2] the the the the")).toEqual({ ok: false });
  });

  // Found by the fuzz at 20,000 runs per category (seed 11): the diff read
  // "a marker in front of the full stop replaced by one behind it" as "the
  // full stop moved", and the other side's comma ended up on its wrong side
  // ("and , [B3] ." where one side wrote "and . ,").
  it("a mark one side took out and put in elsewhere, with the other side's change in between, is a conflict", () => {
    expect(merge3("a , [O1] , and . [O2]", "a , [O1] and . , [O2]", "a , [O1] , and [B3] .")).toEqual({ ok: false });
    expect(
      merge3(
        "of , , the cell the . a a . , of a [O1] . of [O2] . [O3]",
        "of , the cell the . a a . , of a , [O1] . of [O2] . [O3]",
        "of , , the cell the . a a . , of a . [B4] of [O2] .",
      ),
    ).toEqual({ ok: false });
    // Away from the other side's change it still combines.
    expect(merge3("one, two. three four five", "one two, three four five", "one, two. three four [B1] five")).toEqual({
      ok: true,
      text: "one two, three four [B1] five",
    });
  });

  // Browser QA: one tab appends to a paragraph, the other types at its start, no spaces involved.
  it("combines typing at the start and at the end of the same word", () => {
    expect(merge3("alpha", "headalpha", "alphatail")).toEqual({ ok: true, text: "headalphatail" });
    expect(merge3("alpha", "alphatail", "headalpha")).toEqual({ ok: true, text: "headalphatail" });
    // Both at the same end, or the same addition on both ends: not combinable with certainty.
    expect(merge3("alpha", "Xalpha", "Yalpha")).toEqual({ ok: false });
    expect(merge3("alpha", "Xalpha", "alphaX")).toEqual({ ok: false });
  });

  it("two additions that share nothing but punctuation still combine", () => {
    expect(merge3("the cell is alive", "the [B3] cell is alive", "the cell is [A4] alive")).toEqual({
      ok: true,
      text: "the [B3] cell is [A4] alive",
    });
  });
});

// ---------------------------------------------------------------------------
// The reviewer's fuzz. Markers ([X12]) carry identity; plain words repeat.
// ---------------------------------------------------------------------------

function fuzz(seedStart: number, runs: number) {
  let seed = seedStart;
  const rnd = () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const pick = <T,>(a: readonly T[]): T => a[Math.floor(rnd() * a.length)];
  const int = (n: number) => Math.floor(rnd() * n);
  const VOCAB: Record<string, { words: string[]; sep: () => string }> = {
    repeat: { words: ["the", "the", "cell", "cell", "is", "a", "of", "and", "the cell", ".", ",", "the"], sep: () => " " },
    latin: { words: ["energy", "flows", "matter", "cycles", "in", "plants", "light", "water", "is", "split", "."], sep: () => (rnd() < 0.1 ? "  " : " ") },
    cjk: { words: ["細胞", "は", "生命", "の", "基本", "単位", "です", "。", "光", "合成"], sep: () => "" },
    arabic: { words: ["الخلية", "هي", "وحدة", "الحياة", "و", "الطاقة", "،"], sep: () => " " },
    emoji: { words: ["👍🏽", "👨‍👩‍👧", "🇩🇪", "❤️", "é", "é", "ok", "👍"], sep: () => " " },
    thai: { words: ["เซลล์", "เป็น", "หน่วย", "ของ", "ชีวิต"], sep: () => (rnd() < 0.3 ? " " : "") },
    whitespace: { words: ["alpha", "beta", "gamma", "\n", "\n\n", "\t", "delta"], sep: () => pick([" ", "  ", "\n", " "]) },
  };
  let mid = 0;
  const mk = (side: string) => `[${side}${(mid += 1)}]`;
  const MARK = /\[[A-Z]\d+\]/g;
  const marks = (s: string): string[] => s.match(MARK) ?? [];
  const flat = (s: string) => s.replace(MARK, "").replace(/\s+/g, "");
  const words = (len: number, v: string[]) => Array.from({ length: len }, () => (rnd() < 0.25 ? mk("O") : pick(v)));
  const markerEdits = (w: string[], side: string, n: number) => {
    const x = w.slice();
    for (let i = 0; i < n; i += 1) {
      const ms = x.map((t, j) => (/^\[[A-Z]\d+\]$/.test(t) ? j : -1)).filter((j) => j >= 0);
      if (rnd() < 0.6 || ms.length === 0) x.splice(int(x.length + 1), 0, mk(side));
      else x.splice(pick(ms), 1);
    }
    return x;
  };
  const join = (w: string[], sep: () => string) => w.map((t, i) => (i === 0 ? t : sep() + t)).join("");

  const stats: Record<string, { runs: number; clean: number }> = {};
  const bad: string[] = [];
  /** `plain`: what the result's plain words must be (null: not checked). */
  const judge = (cat: string, base: string, ours: string, theirs: string, plain: string | null) => {
    const s = (stats[cat] ??= { runs: 0, clean: 0 });
    s.runs += 1;
    const r = merge3(base, ours, theirs);
    if (!r.ok) return;
    s.clean += 1;
    const [mb, mo, mt, got] = [marks(base), marks(ours), marks(theirs), marks(r.text)];
    let why = "";
    for (const m of new Set([...mb, ...mo, ...mt])) {
      const want = mb.includes(m) ? mo.includes(m) && mt.includes(m) : mo.includes(m) || mt.includes(m);
      const count = got.filter((x) => x === m).length;
      if (count > 1) why = `${m} x${count}`;
      else if ((count === 1) !== want) why = `${m} ${count ? "came back / not deleted" : "missing"}`;
      if (why) break;
    }
    if (!why && plain !== null && flat(r.text) !== flat(plain)) why = "plain words changed";
    if (why && bad.length < 8) bad.push(`[${cat}] ${why}: ${JSON.stringify({ base, ours, theirs, merged: r.text })}`);
    else if (why) bad.push(cat);
  };

  for (let run = 0; run < runs; run += 1) {
    for (const [name, v] of Object.entries(VOCAB)) {
      // A: marker edits over repeated words, spacing drawn afresh for each version.
      const base = words(3 + int(14), v.words);
      const b = join(base, v.sep);
      judge(`A-${name}`, b, join(markerEdits(base, "A", 1 + int(3)), v.sep), join(markerEdits(base, "B", 1 + int(3)), v.sep), b);
      // F: the same spacing on all three versions.
      const fixedBase = words(3 + int(14), v.words);
      const gaps: string[] = [];
      const fixed = (ws: string[]) =>
        ws.map((t, i) => (i === 0 ? t : (gaps[(t.length + ws[i - 1].length) % 7] ??= v.sep()) + t)).join("");
      judge(`F-${name}`, fixed(fixedBase), fixed(markerEdits(fixedBase, "A", 1 + int(3))), fixed(markerEdits(fixedBase, "B", 1 + int(3))), fixed(fixedBase));
    }
    {
      // B: one side moves a span (cut and paste), the other edits markers.
      const v = VOCAB[pick(["repeat", "latin", "cjk"])];
      const base = words(6 + int(14), v.words);
      const ours = base.slice();
      const i = int(ours.length - 2);
      const span = ours.splice(i, 1 + int(Math.min(4, ours.length - i - 1)));
      ours.splice(int(ours.length + 1), 0, ...span);
      const o = join(ours, v.sep);
      judge("B-move", join(base, v.sep), o, join(markerEdits(base, "B", 1 + int(3)), v.sep), o);
    }
    {
      // C: one side changes only white space (also joining words), the other edits markers.
      const base = words(5 + int(10), VOCAB.latin.words);
      const b = base.join(" ");
      const spaced = b.replace(/ /g, () => pick([" ", " ", "  ", "\n", ""]));
      const theirs = markerEdits(base, "B", 1 + int(2)).join(" ");
      judge("C-whitespace", b, spaced, theirs, theirs);
    }
    {
      // G: theirs already holds ours's insertion, plus more; then ours typed on as well.
      const base = words(4 + int(10), VOCAB.latin.words);
      const x = mk("X");
      const ours = base.slice();
      ours.splice(int(base.length + 1), 0, x);
      const theirs = ours.slice();
      theirs.splice(int(theirs.length + 1), 0, mk("Y"));
      judge("G-theirsHasOurs", base.join(" "), ours.join(" "), theirs.join(" "), base.join(" "));
      const more = ours.slice();
      more.splice(rnd() < 0.5 ? more.indexOf(x) + 1 : int(more.length + 1), 0, mk("Z"));
      judge("G-bothExtend", base.join(" "), more.join(" "), theirs.join(" "), base.join(" "));
    }
  }
  for (let run = 0; run < Math.max(3, runs / 200); run += 1) {
    const base = words(3000 + int(6000), VOCAB.repeat.words);
    const b = base.join(" ");
    judge("D-long", b, markerEdits(base, "A", 1 + int(6)).join(" "), markerEdits(base, "B", 1 + int(6)).join(" "), b);
  }
  return { stats, bad };
}

describe("merge3: adversarial property fuzz (third review)", () => {
  it("a clean merge never loses, repeats or brings back a marker, and never changes the plain words", () => {
    const runs = Number(process.env.SYNC_FUZZ_TEXT_CASES ?? 400);
    const { stats, bad } = fuzz(Number(process.env.SYNC_FUZZ_TEXT_SEED ?? 1), runs);
    expect(bad).toEqual([]);
    // Conservative, not useless: marker edits in ordinary text mostly merge.
    for (const cat of ["A-repeat", "A-cjk", "A-arabic", "F-latin", "F-thai", "G-theirsHasOurs"]) {
      expect(stats[cat].clean / stats[cat].runs, cat).toBeGreaterThan(0.4);
    }
  }, 300_000);
});
