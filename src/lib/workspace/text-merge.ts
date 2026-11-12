/**
 * Three-way text merge (diff3) for the workspace sync engine.
 *
 * Used when two people (two devices, or a device and the AI agent) changed the
 * same prose field: `base` is the text as it was when they diverged, `ours`
 * and `theirs` are the two edited versions. Edits in different places combine;
 * edits to the same place are a conflict and the caller keeps both versions.
 *
 * The classic diff3 construction, over tokens (words, runs of spaces, single
 * punctuation marks and emoji, single CJK characters):
 *  1. each side is diffed against the base into hunks (a base range and what
 *     replaced it);
 *  2. every pure insertion or deletion is slid to its leftmost equivalent
 *     position, so the same edit made on both sides lands at the same place
 *     however each diff happened to align it ("the basic unit" typed on both
 *     sides is one insertion, not two one space apart);
 *  3. a change made identically on both sides counts once; changes of the
 *     two sides that share any of the base text conflict; changes that only
 *     touch combine, and two different insertions at the very same spot are
 *     both kept, the other side's first (two people each adding a sentence
 *     at the end of a paragraph get both sentences);
 *  4. finally an alignment-independent count check (`countsConsistent`)
 *     rejects any result whose words do not add up, whatever the diffs
 *     decided about where things moved.
 * A clean result therefore only ever contains, for every stretch of the base,
 * the base itself or exactly one side's change to it.
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

const CJK = /[\p{sc=Han}\p{sc=Hiragana}\p{sc=Katakana}]/u;
const SPACE = /^\s+$/u;
const WORD = /^[\p{L}\p{M}\p{N}_]/u;

type Kind = "space" | "word" | "single";
function kindOf(g: string): Kind {
  if (SPACE.test(g)) return "space";
  if (CJK.test(g)) return "single";
  return WORD.test(g) ? "word" : "single";
}

/**
 * The pieces a word is counted by in the final check: its letter and digit
 * runs ("COVID19" counts as "COVID" and "19"), so two words glued together
 * (Latin words inside text written without spaces) are still checked one by
 * one, while the diff itself never cuts a word in half.
 */
const PIECE = /\p{N}+|[^\p{N}]+/gu;

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
 * Overlapping deletions `x` (earlier) and `y` of the two sides: move one of
 * them along its run of equal tokens so that they only touch, without
 * running into another hunk of its own side. False if they cannot be.
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

/** For each piece a side inserted: where ("i<pos>" a pure insertion, "r<s>:<e>" a replacement). */
function spots(hunks: readonly Hunk[]): Map<string, Set<string>> {
  const m = new Map<string, Set<string>>();
  for (const h of hunks) {
    const where = h.s === h.e ? `i${h.s}` : `r${h.s}:${h.e}`;
    for (const t of h.ins) {
      if (SPACE.test(t)) continue;
      for (const piece of t.match(PIECE) ?? [t]) {
        const set = m.get(piece) ?? new Set<string>();
        set.add(where);
        m.set(piece, set);
      }
    }
  }
  return m;
}

function counts(tokens: readonly string[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const t of tokens) {
    if (SPACE.test(t)) continue;
    for (const piece of t.match(PIECE) ?? [t]) m.set(piece, (m.get(piece) ?? 0) + 1);
  }
  return m;
}

/**
 * Alignment-independent check of a clean merge. Whatever the diffs decided
 * about where things moved, every word (and mark) must appear as often as
 * the two edits together allow:
 *  - one side changed its count, or the two changed it in opposite
 *    directions: base + both changes, exactly;
 *  - both added (or both removed) some: between "the same change, made on
 *    both sides" (the larger of the two) and "two separate changes" (their
 *    sum). A word that is new to the text and added by both sides in
 *    different places, though, is one addition placed twice (a restore
 *    meeting a copy that already has it): the larger of the two, exactly.
 *    Only additions at the very same spot (two sentences appended to the
 *    same paragraph, both starting "They") count as separate.
 * Anything else means the two edits were entangled (one side moved a word
 * the other deleted, the same insertion was placed twice...), and the merge
 * is reported as a conflict, so both versions are kept.
 */
function countsConsistent(
  o: readonly string[],
  a: readonly string[],
  b: readonly string[],
  r: readonly string[],
  ha: readonly Hunk[],
  hb: readonly Hunk[],
  sharedHunks: readonly Hunk[],
): boolean {
  const co = counts(o);
  const ca = counts(a);
  const cb = counts(b);
  const cr = counts(r);
  // A change both sides made (applied once) counts once: the rules below
  // judge what each side did beyond it.
  const cs = new Map<string, number>();
  const removedByBoth = new Set<string>();
  for (const h of sharedHunks) {
    for (const [k, n] of counts(h.ins)) cs.set(k, (cs.get(k) ?? 0) + n);
    for (const [k, n] of counts(o.slice(h.s, h.e))) {
      cs.set(k, (cs.get(k) ?? 0) - n);
      if (WORD.test(k)) removedByBoth.add(k);
    }
  }
  // A word both removed from the same place that one side put in again
  // elsewhere was moved there by that side and deleted by the other: entangled.
  if (removedByBoth.size > 0) {
    const sharedKeys = new Set(sharedHunks.map(hunkKey));
    for (const h of [...ha, ...hb]) {
      if (sharedKeys.has(hunkKey(h))) continue;
      for (const k of counts(h.ins).keys()) if (removedByBoth.has(k)) return false;
    }
  }
  const spotsA = spots(ha);
  const spotsB = spots(hb);
  const sameSpot = (k: string) => {
    const x = spotsA.get(k);
    const y = spotsB.get(k);
    if (!x || !y || x.size !== 1 || y.size !== 1) return false;
    const [p] = x;
    return p.startsWith("i") && y.has(p);
  };
  const keys = new Set([...co.keys(), ...ca.keys(), ...cb.keys(), ...cr.keys()]);
  for (const k of keys) {
    const base = co.get(k) ?? 0;
    const both = cs.get(k) ?? 0;
    const da = (ca.get(k) ?? 0) - base - both;
    const db = (cb.get(k) ?? 0) - base - both;
    const got = (cr.get(k) ?? 0) - base - both;
    if (da > 0 && db > 0) {
      const most = base === 0 && WORD.test(k) && !sameSpot(k) ? Math.max(da, db) : da + db;
      if (got < Math.max(da, db) || got > most) return false;
    } else if (da < 0 && db < 0) {
      if (got > Math.min(da, db) || got < da + db) return false;
    } else if (got !== da + db) {
      return false;
    }
  }
  return true;
}

export type MergeResult = { ok: true; text: string } | { ok: false };

/**
 * Merge `ours` and `theirs`, both derived from `base`. Returns the combined
 * text, or `{ ok: false }` when both changed the same part differently.
 */
export function merge3(base: string, ours: string, theirs: string): MergeResult {
  if (ours === theirs) return { ok: true, text: ours };
  if (ours === base) return { ok: true, text: theirs };
  if (theirs === base) return { ok: true, text: ours };

  const o = tokenize(base);
  const ta = tokenize(ours);
  const tb = tokenize(theirs);
  const ha = hunksOf(o, ta);
  const hb = hunksOf(o, tb);
  if (!ha || !hb) return { ok: false };

  // The same change made on both sides counts once.
  const inB = new Set(hb.map(hunkKey));
  const shared = new Set(ha.map(hunkKey).filter((k) => inB.has(k)));
  const sharedHunks = ha.filter((h) => shared.has(hunkKey(h)));
  const merged: Array<Hunk & { side: number }> = [
    ...ha.map((h) => ({ ...h, side: 0 })),
    ...hb.filter((h) => !shared.has(hunkKey(h))).map((h) => ({ ...h, side: 1 })),
  ].sort((x, y) => x.s - y.s || x.e - y.e || y.side - x.side);

  // Edits of the two sides may touch but not share any of the base text: a
  // change to the same words is a conflict. Two different insertions at the
  // very same spot are both kept, the other side's first (both people added
  // a sentence at the end of the paragraph: both sentences stay).
  const mine = merged.filter((h) => h.side === 0);
  const other = merged.filter((h) => h.side === 1);
  // A deletion can sit anywhere along a run of equal tokens ("␣[B14]" or
  // "[B14]␣"): two deletions that overlap only because of where the diffs
  // put them are moved apart (each side's own result is unchanged).
  let moved = false;
  for (const x of mine) {
    for (const y of other) {
      if (x.ins.length === 0 && y.ins.length === 0 && x.s < y.e && y.s < x.e) {
        moved = separateDeletions(o, x, y, x.s <= y.s ? mine : other, x.s <= y.s ? other : mine) || moved;
      }
    }
  }
  if (moved) merged.sort((x, y) => x.s - y.s || x.e - y.e || y.side - x.side);
  for (const x of mine) {
    for (const y of other) {
      const overlap = x.s < y.e && y.s < x.e;
      const inside =
        (x.s === x.e && x.s > y.s && x.s < y.e) || (y.s === y.e && y.s > x.s && y.s < x.e);
      // Two deletions that share only the space between them (each removed
      // a word, and the space before or after it): everything either removed goes.
      const spaceOnly =
        overlap &&
        x.ins.length === 0 &&
        y.ins.length === 0 &&
        o.slice(Math.max(x.s, y.s), Math.min(x.e, y.e)).every((t) => SPACE.test(t));
      if ((overlap && !spaceOnly) || inside) return { ok: false };
      // The same new text at two different places is almost certainly one
      // edit the two diffs placed differently: keeping both would duplicate it.
      if (x.ins.length > 0 && x.ins.join("") === y.ins.join("") && x.ins.some((t) => !SPACE.test(t))) {
        return { ok: false };
      }
    }
  }

  // Two insertions at the very same spot where one already contains the
  // other (the same words typed or restored on both sides, one side then
  // typing more): the longer one, once.
  for (let i = 0; i + 1 < merged.length; i += 1) {
    const x = merged[i];
    const y = merged[i + 1];
    if (x.side === y.side || x.s !== x.e || y.s !== y.e || x.s !== y.s) continue;
    const [long, short] = x.ins.length >= y.ins.length ? [x, y] : [y, x];
    if (short.ins.some((t) => WORD.test(t)) && containsRun(long.ins, short.ins)) {
      merged.splice(i, 2, long);
      i -= 1;
    }
  }

  const out: string[] = [];
  let pos = 0;
  for (const h of merged) {
    for (let k = pos; k < h.s; k += 1) out.push(o[k]);
    out.push(...h.ins);
    pos = Math.max(pos, h.e);
  }
  for (let k = pos; k < o.length; k += 1) out.push(o[k]);
  if (!countsConsistent(o, ta, tb, out, ha, hb, sharedHunks)) return { ok: false };
  return { ok: true, text: out.join("") };
}
