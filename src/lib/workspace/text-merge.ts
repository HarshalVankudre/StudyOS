/**
 * Three-way text merge (diff3) for the workspace sync engine.
 *
 * Used when the same prose field was changed in two places (two devices, or a
 * device and the AI agent): `base` is the text as it was when they diverged,
 * `ours` and `theirs` are the two edited versions. Edits in different places
 * combine; anything else is a conflict and the caller keeps both versions.
 *
 * THE GUARANTEE. When `merge3` reports a clean result, that result holds
 * everything either side added exactly once and nothing either side removed.
 * When it cannot be sure, it reports a conflict. It errs on the side of
 * conflicts: a conflict costs the student one tap (two marked versions of the
 * paragraph), a wrong clean merge silently alters their text.
 *
 * How (the plain diff3 construction, over tokens: words, runs of spaces,
 * single punctuation marks and emoji, single characters of scripts written
 * without spaces):
 *  1. each side is diffed against the base into hunks (a base range and what
 *     replaced it). Applying a side's hunks to the base gives that side
 *     exactly; this is checked, not assumed;
 *  2. every pure insertion or deletion is slid to its leftmost equivalent
 *     position, so the same edit made on both sides lands at the same place
 *     however each diff happened to align it;
 *  3. a hunk both sides have (same place, same new text) is applied once.
 *     All other hunks of the two sides must not share any base text: they may
 *     touch, never overlap, and none may insert into the middle of what the
 *     other replaced. Then every hunk is applied to the base;
 *  4. things that look combinable and are not are conflicts: a word one side
 *     moved while the other changed anything; a mark (comma, bracket) one side
 *     took out in one place and put in at another, with a change of the other
 *     side between or next to those places (unless a word that occurs only
 *     once stands between them, kept); a word new to the text added by
 *     both sides (one addition seen twice); two insertions at the very same
 *     spot that share a word; and a shared change to a word one side also
 *     changed elsewhere (a move meeting a deletion);
 *  5. finally the result is counted, independently of any alignment: every
 *     word must occur exactly as often as the base, plus what each side added
 *     or removed, with shared changes counted once. Anything else is a
 *     conflict.
 * Since the hunks are disjoint, steps 1 and 3 already imply step 5; it is
 * kept as the check that holds whatever the steps before it did.
 */

// Grapheme clusters (an emoji with a skin tone or a family is one unit).
const graphemeSegmenter: { segment(text: string): Iterable<{ segment: string }> } | null = (() => {
  try {
    const S = (Intl as unknown as { Segmenter?: new (l?: string, o?: object) => { segment(t: string): Iterable<{ segment: string }> } }).Segmenter;
    return S ? new S(undefined, { granularity: "grapheme" }) : null;
  } catch {
    return null;
  }
})();

function graphemes(text: string): string[] {
  if (graphemeSegmenter) return Array.from(graphemeSegmenter.segment(text), (s) => s.segment);
  return Array.from(text);
}

// Scripts written without spaces between words: every character is a token
// (a run of them is not "one word" that two edits would always collide on).
const CJK = /[\p{sc=Han}\p{sc=Hiragana}\p{sc=Katakana}\p{sc=Thai}\p{sc=Lao}\p{sc=Khmer}\p{sc=Myanmar}]/u;
const SPACE = /^\s+$/u;
const WORD = /^[\p{L}\p{M}\p{N}_]/u;

type Kind = "space" | "word" | "single";
function kindOf(g: string): Kind {
  if (SPACE.test(g)) return "space";
  if (CJK.test(g)) return "single";
  return WORD.test(g) ? "word" : "single";
}

/** Tokens whose concatenation is exactly `text`. */
export function tokenize(text: string): string[] {
  const out: string[] = [];
  let run = "";
  let runKind: Kind | null = null;
  for (const g of graphemes(text)) {
    const k = kindOf(g);
    if (k !== "single" && k === runKind) {
      run += g;
      continue;
    }
    if (run) out.push(run);
    run = g;
    runKind = k === "single" ? null : k;
  }
  if (run) out.push(run);
  return out;
}

/** Above this many cells the middle of a diff is not computed (treated as a conflict). */
const MAX_DP_CELLS = 1_500_000;

/** Indexes of a longest strictly increasing subsequence of `seq`. */
function lisIndexes(seq: readonly number[]): number[] {
  const tails: number[] = [];
  const prev = new Int32Array(seq.length).fill(-1);
  for (let i = 0; i < seq.length; i += 1) {
    let lo = 0;
    let hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (seq[tails[mid]] < seq[i]) lo = mid + 1;
      else hi = mid;
    }
    if (lo > 0) prev[i] = tails[lo - 1];
    tails[lo] = i;
  }
  const out: number[] = [];
  for (let k = tails.length ? tails[tails.length - 1] : -1; k >= 0; k = prev[k]) out.push(k);
  return out.reverse();
}

/**
 * Index pairs [i, j] with x[i] === y[j], in increasing order: a patience
 * alignment. Tokens that occur exactly once on both sides (a name, a number,
 * a rare word) are matched as themselves first, and only the stretches
 * between them are aligned by longest common subsequence. Plain LCS would
 * happily read "the word moved" just to match more brackets and spaces.
 * Null when a stretch is too large and different to compare cheaply.
 */
export function lcsPairs(x: readonly string[], y: readonly string[]): Array<[number, number]> | null {
  const pairs: Array<[number, number]> = [];
  return alignRange(x, y, 0, x.length, 0, y.length, pairs) ? pairs : null;
}

function alignRange(
  x: readonly string[],
  y: readonly string[],
  xlo: number,
  xhi: number,
  ylo: number,
  yhi: number,
  out: Array<[number, number]>,
): boolean {
  // Common prefix and suffix.
  while (xlo < xhi && ylo < yhi && x[xlo] === y[ylo]) out.push([xlo++, ylo++]);
  const tail: Array<[number, number]> = [];
  while (xhi > xlo && yhi > ylo && x[xhi - 1] === y[yhi - 1]) tail.push([--xhi, --yhi]);
  if (xlo < xhi && ylo < yhi) {
    // Anchors: tokens unique in both stretches.
    const count = new Map<string, { nx: number; ny: number; ix: number; iy: number }>();
    for (let i = xlo; i < xhi; i += 1) {
      const c = count.get(x[i]) ?? { nx: 0, ny: 0, ix: -1, iy: -1 };
      c.nx += 1;
      c.ix = i;
      count.set(x[i], c);
    }
    for (let j = ylo; j < yhi; j += 1) {
      const c = count.get(y[j]);
      if (!c) continue;
      c.ny += 1;
      c.iy = j;
    }
    // Only words anchor: a lone bracket or space says nothing about where
    // the text is ("[B8] read" against "read [A1]" must keep "read" matched).
    const uniques = [...count.values()]
      .filter((c) => c.nx === 1 && c.ny === 1 && WORD.test(x[c.ix]))
      .sort((a, b) => a.ix - b.ix);
    const anchors = lisIndexes(uniques.map((c) => c.iy)).map((k) => uniques[k]);
    if (anchors.length > 0) {
      let px = xlo;
      let py = ylo;
      for (const a of anchors) {
        if (!alignRange(x, y, px, a.ix, py, a.iy, out)) return false;
        out.push([a.ix, a.iy]);
        px = a.ix + 1;
        py = a.iy + 1;
      }
      if (!alignRange(x, y, px, xhi, py, yhi, out)) return false;
    } else if (!dpAlign(x, y, xlo, xhi, ylo, yhi, out)) {
      return false;
    }
  }
  for (let k = tail.length - 1; k >= 0; k -= 1) out.push(tail[k]);
  return true;
}

/** Longest common subsequence of a stretch (no unique anchors in it). */
function dpAlign(
  x: readonly string[],
  y: readonly string[],
  xlo: number,
  xhi: number,
  ylo: number,
  yhi: number,
  out: Array<[number, number]>,
): boolean {
  const n = xhi - xlo;
  const m = yhi - ylo;
  if (n * m > MAX_DP_CELLS) return false;
  // Filled from the end so the walk below can go forwards.
  const w = m + 1;
  const table = new Uint32Array((n + 1) * w);
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      table[i * w + j] =
        x[xlo + i] === y[ylo + j]
          ? table[(i + 1) * w + j + 1] + 1
          : Math.max(table[(i + 1) * w + j], table[i * w + j + 1]);
    }
  }
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (x[xlo + i] === y[ylo + j]) {
      out.push([xlo + i, ylo + j]);
      i += 1;
      j += 1;
    } else if (table[(i + 1) * w + j] >= table[i * w + j + 1]) {
      i += 1;
    } else {
      j += 1;
    }
  }
  return true;
}

/** Base tokens [s, e) replaced by `ins` on one side. */
interface Hunk {
  s: number;
  e: number;
  ins: string[];
}

const hunkKey = (h: Hunk) => `${h.s}:${h.e}:${h.ins.join("\u0000")}`;

/** The hunks turning `o` into `a`, each pure insertion/deletion slid left. */
function hunksOf(o: readonly string[], a: readonly string[]): Hunk[] | null {
  const pairs = lcsPairs(o, a);
  if (!pairs) return null;
  const raw: Hunk[] = [];
  let po = 0;
  let pa = 0;
  for (const [oi, ai] of [...pairs, [o.length, a.length] as [number, number]]) {
    if (oi > po || ai > pa) raw.push({ s: po, e: oi, ins: a.slice(pa, ai) });
    po = oi + 1;
    pa = ai + 1;
  }
  const out: Hunk[] = [];
  let floor = 0; // never slide across the previous hunk
  for (const h of raw) {
    let { s, e } = h;
    let ins = h.ins;
    if (s === e && ins.length > 0) {
      while (s > floor && o[s - 1] === ins[ins.length - 1]) {
        ins = [o[s - 1], ...ins.slice(0, -1)];
        s -= 1;
        e -= 1;
      }
    } else if (ins.length === 0 && e > s) {
      while (s > floor && o[s - 1] === o[e - 1]) {
        s -= 1;
        e -= 1;
      }
    }
    out.push({ s, e, ins });
    floor = e;
  }
  return out;
}

/** `o` with `hunks` applied (in order, none overlapping), or null if they overlap. */
function applyHunks(o: readonly string[], hunks: readonly Hunk[]): string[] | null {
  const out: string[] = [];
  let pos = 0;
  for (const h of hunks) {
    if (h.s < pos || h.e < h.s || h.e > o.length) return null;
    for (let k = pos; k < h.s; k += 1) out.push(o[k]);
    for (const t of h.ins) out.push(t);
    pos = h.e;
  }
  for (let k = pos; k < o.length; k += 1) out.push(o[k]);
  return out;
}

/** Can deletion `h` move by `d` tokens (right if positive) and delete the same tokens' worth? */
function canSlide(o: readonly string[], h: Hunk, d: number): boolean {
  if (d > 0) {
    if (h.e + d > o.length) return false;
    for (let k = 0; k < d; k += 1) if (o[h.s + k] !== o[h.e + k]) return false;
    return true;
  }
  if (h.s + d < 0) return false;
  for (let k = 1; k <= -d; k += 1) if (o[h.s - k] !== o[h.e - k]) return false;
  return true;
}

/**
 * Overlapping deletions `x` and `y` of the two sides: move one of them along
 * its run of equal tokens so that they only touch, without running into
 * another hunk of its own side. False if they cannot be. (Each side's own
 * result is unchanged by such a move; `merge3` checks that again afterwards.)
 */
function separateDeletions(
  o: readonly string[],
  x: Hunk,
  y: Hunk,
  sideOfFirst: readonly Hunk[],
  sideOfSecond: readonly Hunk[],
): boolean {
  const [a, b] = x.s <= y.s ? [x, y] : [y, x];
  const overlap = a.e - b.s;
  if (overlap <= 0) return false;
  const clear = (h: Hunk, s: number, e: number, own: readonly Hunk[]) =>
    own.every((g) => g === h || g.e < s || g.s > e);
  if (canSlide(o, b, overlap) && clear(b, b.s + overlap, b.e + overlap, sideOfSecond)) {
    b.s += overlap;
    b.e += overlap;
    return true;
  }
  if (canSlide(o, a, -overlap) && clear(a, a.s - overlap, a.e - overlap, sideOfFirst)) {
    a.s -= overlap;
    a.e -= overlap;
    return true;
  }
  return false;
}

/** Does `long` contain `short` as a contiguous run of tokens? */
function containsRun(long: readonly string[], short: readonly string[]): boolean {
  if (short.length === 0) return true;
  for (let i = 0; i + short.length <= long.length; i += 1) {
    let k = 0;
    while (k < short.length && long[i + k] === short[k]) k += 1;
    if (k === short.length) return true;
  }
  return false;
}

/** How often each token that is not white space occurs. */
function counts(tokens: readonly string[], into = new Map<string, number>(), sign = 1): Map<string, number> {
  for (const t of tokens) {
    if (SPACE.test(t)) continue;
    into.set(t, (into.get(t) ?? 0) + sign);
  }
  return into;
}

/** A token that carries meaning of its own (a word, a number, an emoji), unlike a space or a punctuation mark. */
const SIGNIFICANT = /[\p{L}\p{N}\p{Extended_Pictographic}]/u;

/**
 * Does this side take a word out in one place and put the same word in at
 * another (it moved text, or the diff could only explain its edit that way)?
 * Then where the other side's changes belong relative to the moved words
 * cannot be told from the base text.
 */
function movesWords(o: readonly string[], hunks: readonly Hunk[]): boolean {
  const removedAt = new Map<string, number>();
  hunks.forEach((h, i) => {
    for (let k = h.s; k < h.e; k += 1) if (SIGNIFICANT.test(o[k]) && !removedAt.has(o[k])) removedAt.set(o[k], i);
  });
  if (removedAt.size === 0) return false;
  return hunks.some((h, i) =>
    h.ins.some((t) => {
      if (!removedAt.has(t)) return false;
      // Removed by another hunk than this one (also when more than one removes it).
      if (removedAt.get(t) !== i) return true;
      return hunks.some((g, j) => j !== i && o.slice(g.s, g.e).includes(t));
    }),
  );
}

/**
 * The same for marks (a comma, a full stop, a bracket), which are far too
 * common to treat every removal-and-addition as a move: this side takes a
 * mark out in one hunk and puts the same mark in in another, and the other
 * side changed something between those two places or right next to them.
 * Whether that change belongs before or after the mark then depends on how
 * the diff read this side's edit ("the full stop moved" or "a marker in
 * front of it was replaced by one behind it"), and the merge must not.
 *
 * Not when this side kept a word between the two places that occurs once in
 * the base and once in its own text: no reading of the edit can then take
 * the mark that went for the mark that came (it would have to cross that
 * word), so there is nothing to mistake.
 */
function movesMarkAcross(
  o: readonly string[],
  hunks: readonly Hunk[],
  others: readonly Hunk[],
  countBase: ReadonlyMap<string, number>,
  countSide: ReadonlyMap<string, number>,
): boolean {
  if (others.length === 0 || hunks.length < 2) return false;
  // Per token: the hunks that remove it.
  const removedBy = new Map<string, number[]>();
  hunks.forEach((h, i) => {
    for (let k = h.s; k < h.e; k += 1) {
      const t = o[k];
      if (SPACE.test(t)) continue;
      const list = removedBy.get(t);
      if (!list) removedBy.set(t, [i]);
      else if (list[list.length - 1] !== i) list.push(i);
    }
  });
  if (removedBy.size === 0) return false;
  // pins[k]: how many such kept, unique words lie before base position k.
  const pins = new Uint32Array(o.length + 1);
  let next = 0;
  for (let k = 0; k < o.length; k += 1) {
    while (next < hunks.length && hunks[next].e <= k) next += 1;
    const replaced = next < hunks.length && hunks[next].s <= k;
    const pin = !replaced && WORD.test(o[k]) && countBase.get(o[k]) === 1 && countSide.get(o[k]) === 1;
    pins[k + 1] = pins[k] + (pin ? 1 : 0);
  }
  return hunks.some((h, j) =>
    h.ins.some((t) =>
      (removedBy.get(t) ?? []).some((i) => {
        if (i === j) return false;
        const [first, second] = i < j ? [hunks[i], h] : [h, hunks[i]];
        if (pins[second.s] - pins[first.e] > 0) return false;
        return others.some((x) => x.s <= second.e && x.e >= first.s);
      }),
    ),
  );
}

/**
 * Both sides replaced the same stretch `was` of the base, and each kept it
 * whole: one only added in front of it, the other only behind it (two people
 * typing at the start and at the end of the same word, with no space). The
 * combined text, or null when that is not what happened or it can be read in
 * more than one way.
 */
function fuseAround(was: string, a: string, b: string): string | null {
  if (!was) return null;
  const results = new Set<string>();
  const fuse = (front: string, back: string) => {
    // `front` ends with the original, `back` starts with it.
    if (!front.endsWith(was) || !back.startsWith(was)) return;
    const before = front.slice(0, front.length - was.length);
    const after = back.slice(was.length);
    // The same addition on both ends is more likely one edit seen twice.
    if (before && after && before !== after) results.add(before + was + after);
  };
  fuse(a, b);
  fuse(b, a);
  if (results.size !== 1) return null;
  const [only] = results;
  return only;
}

export type MergeResult = { ok: true; text: string } | { ok: false };

/**
 * Merge `ours` and `theirs`, both derived from `base`. Returns the combined
 * text, or `{ ok: false }` when the two edits cannot be combined with
 * certainty (the caller then keeps both versions).
 */
export function merge3(base: string, ours: string, theirs: string): MergeResult {
  if (ours === theirs) return { ok: true, text: ours };
  if (ours === base) return { ok: true, text: theirs };
  if (theirs === base) return { ok: true, text: ours };

  const o = tokenize(base);
  const ta = tokenize(ours);
  const tb = tokenize(theirs);
  const forward = mergeTokens(o, ta, tb, false);
  if (!forward) return { ok: false };
  // Where a text repeats itself a diff has a choice (which of three equal
  // words was removed?), and the merge must not depend on it: the same merge
  // read from the end makes the opposite choices, and has to give the same text.
  const backward = mergeTokens(o.slice().reverse(), ta.slice().reverse(), tb.slice().reverse(), true);
  if (!backward) return { ok: false };
  const text = forward.join("");
  if (backward.reverse().join("") !== text) return { ok: false };
  return { ok: true, text };
}

/** One pass of the merge over token lists; null on a conflict. `mirrored`: the lists are reversed. */
function mergeTokens(
  o: readonly string[],
  ta: readonly string[],
  tb: readonly string[],
  mirrored: boolean,
): string[] | null {
  const ha = hunksOf(o, ta);
  const hb = hunksOf(o, tb);
  if (!ha || !hb) return null;

  // The same change made on both sides (same place, same new text) counts once.
  const keysB = new Set(hb.map(hunkKey));
  const shared = new Set(ha.map(hunkKey).filter((k) => keysB.has(k)));
  const mine = ha.filter((h) => !shared.has(hunkKey(h)));
  const other = hb.filter((h) => !shared.has(hunkKey(h)));

  // A deletion can sit anywhere along a run of equal tokens ("␣word" or
  // "word␣"): two deletions that overlap only because of where the diffs put
  // them are moved apart.
  for (const x of mine) {
    for (const y of other) {
      if (x.ins.length === 0 && y.ins.length === 0 && x.s < y.e && y.s < x.e) {
        separateDeletions(o, x, y, x.s <= y.s ? ha : hb, x.s <= y.s ? hb : ha);
      }
    }
  }
  // Whatever was moved: each side's hunks must still produce exactly that side.
  const againA = applyHunks(o, ha);
  const againB = applyHunks(o, hb);
  if (!againA || !againB || againA.join("") !== ta.join("") || againB.join("") !== tb.join("")) return null;
  // Text one side moved while the other changed something too.
  if ((other.length > 0 && movesWords(o, ha)) || (mine.length > 0 && movesWords(o, hb))) return null;

  const co = counts(o);
  const ca = counts(ta);
  const cb = counts(tb);
  if (movesMarkAcross(o, ha, other, co, ca) || movesMarkAcross(o, hb, mine, co, cb)) return null;
  // A word (not a bracket or a comma) that the base text does not contain.
  const isNew = (t: string) => SIGNIFICANT.test(t) && !co.has(t);
  // What is applied once although both sides have it: per word, how often.
  const net = new Map<string, number>();
  const dropped = new Set<Hunk>();
  // The same stretch replaced on both sides, each side only adding at one
  // end of it ("alpha" -> "headalpha" and "alphatail"): one replacement
  // holding both additions.
  const read = (tokens: readonly string[]) => (mirrored ? tokens.slice().reverse() : tokens).join("");
  for (const x of mine) {
    for (const y of other) {
      if (dropped.has(y) || x.s !== y.s || x.e !== y.e || x.e === x.s) continue;
      const fused = fuseAround(read(o.slice(x.s, x.e)), read(x.ins), read(y.ins));
      if (fused === null) continue;
      const tokens = tokenize(fused);
      // Counted as: both replacements once each gone, the stretch they shared
      // once less removed, the fused text in.
      counts(x.ins, net, 1);
      counts(y.ins, net, 1);
      counts(o.slice(x.s, x.e), net, -1);
      counts(tokens, net, -1);
      x.ins = mirrored ? tokens.reverse() : tokens;
      dropped.add(y);
      break;
    }
  }
  const fusedNet = new Map(net);
  for (const x of mine) {
    for (const y of other) {
      if (dropped.has(x) || dropped.has(y)) continue;
      // Changes of the two sides may touch but not share any of the base text.
      if (x.s < y.e && y.s < x.e) return null;
      // An insertion in the middle of what the other side replaced.
      if ((x.s === x.e && x.s > y.s && x.s < y.e) || (y.s === y.e && y.s > x.s && y.s < x.e)) return null;
      if (x.s === x.e && y.s === y.e && x.s === y.s) {
        // Two insertions at the very same spot. One holds the other whole,
        // and that other has a word new to the text (the same words typed or
        // restored on both sides, one side then typing more): the longer
        // one, once.
        const [long, short] = x.ins.length >= y.ins.length ? [x, y] : [y, x];
        if (short.ins.some(isNew) && containsRun(long.ins, short.ins)) {
          dropped.add(short);
          counts(short.ins, net, 1);
          continue;
        }
        // They share a word otherwise (the same sentence begun on both
        // sides): which words are the same typing cannot be told. Two
        // unrelated additions are both kept, see below.
        if (x.ins.some((t) => WORD.test(t) && y.ins.includes(t))) return null;
      }
      // A word (a name, a number, a mark) that was not in the text and that
      // both sides add is taken to be one addition, placed twice by the two
      // diffs (the other side already holds this side's words): combining
      // would write it twice.
      if (x.ins.some((t) => isNew(t) && y.ins.includes(t))) return null;
    }
  }

  // A shared change is only "the same change" if neither side did more to
  // the same words elsewhere: a word both removed from one place that one
  // side put in again somewhere else was moved by that side and deleted by
  // the other, and applying the removal once would keep the moved copy.
  for (const h of ha) {
    if (!shared.has(hunkKey(h))) continue;
    counts(h.ins, net, 1);
    counts(o.slice(h.s, h.e), net, -1);
  }
  for (const [k, total] of net) {
    const s = total - (fusedNet.get(k) ?? 0);
    const base0 = co.get(k) ?? 0;
    const da = (ca.get(k) ?? 0) - base0;
    const db = (cb.get(k) ?? 0) - base0;
    if (s > 0 && (da < s || db < s)) return null;
    if (s < 0 && (da > s || db > s)) return null;
  }

  // Shared changes once, then each side's own. At the very same spot the
  // other side's insertion goes first (both added a sentence at the end of
  // the paragraph: both sentences stay).
  const merged: Array<Hunk & { side: number }> = [
    ...ha.filter((h) => !dropped.has(h)).map((h) => ({ ...h, side: 0 })),
    ...other.filter((h) => !dropped.has(h)).map((h) => ({ ...h, side: 1 })),
  ].sort((x, y) => x.s - y.s || x.e - y.e || (mirrored ? x.side - y.side : y.side - x.side));
  const out = applyHunks(o, merged);
  if (!out) return null;

  // Last, a check that does not depend on how the diffs aligned anything:
  // every word must occur exactly as often as the two edits together make it
  // (the base, plus what each side added or removed, with a shared change
  // counted once). Otherwise something was written twice or dropped.
  const cr = counts(out);
  for (const k of new Set([...co.keys(), ...ca.keys(), ...cb.keys(), ...cr.keys()])) {
    const base0 = co.get(k) ?? 0;
    const want = (ca.get(k) ?? 0) + (cb.get(k) ?? 0) - base0 - (net.get(k) ?? 0);
    if ((cr.get(k) ?? 0) !== want) return null;
  }
  return out;
}
