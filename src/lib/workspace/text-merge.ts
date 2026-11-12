/**
 * Three-way text merge (diff3) for the workspace sync engine.
 *
 * Used when two people (two devices, or a device and the AI agent) changed the
 * same text field: `base` is the text as it was when they diverged, `ours` and
 * `theirs` are the two edited versions. Edits in different places combine;
 * edits to the same place are a conflict and the caller keeps both versions.
 *
 * Text is compared as tokens (words, runs of spaces, single punctuation marks,
 * single CJK characters), which merges the way a person would expect: "I added
 * a sentence" and "the agent fixed a typo in another sentence" both survive.
 */

// One CJK character, a run of whitespace, a run of word characters (CJK
// excluded), or any other single code point.
const TOKEN =
  /[\p{sc=Han}\p{sc=Hiragana}\p{sc=Katakana}]|\s+|(?:(?![\p{sc=Han}\p{sc=Hiragana}\p{sc=Katakana}])[\p{L}\p{M}\p{N}_])+|[\s\S]/gu;

export function tokenize(text: string): string[] {
  return text.match(TOKEN) ?? [];
}

/** Above this many cells the middle of a diff is not computed (treated as a conflict). */
const MAX_DP_CELLS = 1_500_000;

/**
 * Index pairs [i, j] with x[i] === y[j] forming a longest common subsequence,
 * in increasing order. Null when the texts are too large and different to
 * compare cheaply.
 */
export function lcsPairs(x: readonly string[], y: readonly string[]): Array<[number, number]> | null {
  let pre = 0;
  while (pre < x.length && pre < y.length && x[pre] === y[pre]) pre += 1;
  let suf = 0;
  while (
    suf < x.length - pre &&
    suf < y.length - pre &&
    x[x.length - 1 - suf] === y[y.length - 1 - suf]
  ) {
    suf += 1;
  }
  const pairs: Array<[number, number]> = [];
  for (let i = 0; i < pre; i += 1) pairs.push([i, i]);

  const n = x.length - pre - suf;
  const m = y.length - pre - suf;
  if (n > 0 && m > 0) {
    if (n * m > MAX_DP_CELLS) return null;
    // Classic LCS table over the differing middle, filled from the end so the
    // walk below can go forwards.
    const w = m + 1;
    const table = new Uint32Array((n + 1) * w);
    for (let i = n - 1; i >= 0; i -= 1) {
      for (let j = m - 1; j >= 0; j -= 1) {
        table[i * w + j] =
          x[pre + i] === y[pre + j]
            ? table[(i + 1) * w + j + 1] + 1
            : Math.max(table[(i + 1) * w + j], table[i * w + j + 1]);
      }
    }
    let i = 0;
    let j = 0;
    while (i < n && j < m) {
      if (x[pre + i] === y[pre + j]) {
        pairs.push([pre + i, pre + j]);
        i += 1;
        j += 1;
      } else if (table[(i + 1) * w + j] >= table[i * w + j + 1]) {
        i += 1;
      } else {
        j += 1;
      }
    }
  }
  for (let k = 0; k < suf; k += 1) pairs.push([x.length - suf + k, y.length - suf + k]);
  return pairs;
}

function sameTokens(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return false;
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
  const a = tokenize(ours);
  const b = tokenize(theirs);
  const pa = lcsPairs(o, a);
  const pb = lcsPairs(o, b);
  if (!pa || !pb) return { ok: false };

  // For every base token: where it sits in ours / theirs (-1 = changed there).
  const inA = new Int32Array(o.length).fill(-1);
  const inB = new Int32Array(o.length).fill(-1);
  for (const [oi, ai] of pa) inA[oi] = ai;
  for (const [oi, bi] of pb) inB[oi] = bi;

  const out: string[] = [];
  let i = 0;
  let j = 0;
  let k = 0;
  for (;;) {
    // A stable run: the same token, unchanged on both sides.
    let t = 0;
    while (i + t < o.length && inA[i + t] === j + t && inB[i + t] === k + t) t += 1;
    if (t > 0) {
      for (let s = 0; s < t; s += 1) out.push(o[i + s]);
      i += t;
      j += t;
      k += t;
      continue;
    }
    if (i >= o.length && j >= a.length && k >= b.length) break;

    // An unstable chunk: up to the next base token both sides kept.
    let m = i;
    while (m < o.length && !(inA[m] >= j && inB[m] >= k)) m += 1;
    const aEnd = m < o.length ? inA[m] : a.length;
    const bEnd = m < o.length ? inB[m] : b.length;
    const oSeg = o.slice(i, m);
    const aSeg = a.slice(j, aEnd);
    const bSeg = b.slice(k, bEnd);
    if (sameTokens(aSeg, oSeg)) out.push(...bSeg);
    else if (sameTokens(bSeg, oSeg)) out.push(...aSeg);
    else if (sameTokens(aSeg, bSeg)) out.push(...aSeg);
    else return { ok: false };
    i = m;
    j = aEnd;
    k = bEnd;
  }
  return { ok: true, text: out.join("") };
}
