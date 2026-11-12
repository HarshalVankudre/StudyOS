/**
 * Turning per-section proposals into the kit: verify every quote against the
 * stored page text, drop duplicates and near-duplicates across the whole
 * document, then balance what is left so the kit covers every section
 * instead of whichever section the model was most generous with.
 */
import type { Skeleton } from "./quote";
import { verifyQuote } from "./quote";
import type { ProposedCard, ProposedQuestion } from "./parse";

export interface Verified<T> {
  item: T;
  page: number;
  quote: string;
  section: number;
  /** Position in the section's reply (the model's own order). */
  order: number;
}

/**
 * Keep the items whose quote is really on one of the section's pages, with
 * the page corrected to where it was found and the quote in the material's
 * own wording. Returns the kept items and how many were dropped.
 */
export function verifyItems<T extends { quote: string; page?: number }>(
  items: readonly T[],
  pages: readonly string[],
  section: { index: number; from: number; to: number },
  cache: Map<number, Skeleton> = new Map(),
): { kept: Verified<T>[]; dropped: number } {
  const kept: Verified<T>[] = [];
  let dropped = 0;
  items.forEach((item, order) => {
    const found = verifyQuote(pages, item.quote, item.page, section, cache);
    if (!found) {
      dropped += 1;
      return;
    }
    kept.push({ item, page: found.page, quote: found.quote, section: section.index, order });
  });
  return { kept, dropped };
}

// ---------------------------------------------------------------------------
// Near-duplicates
// ---------------------------------------------------------------------------

const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;

/**
 * Comparable tokens of a prompt: accent-free lower-case words of three or
 * more letters (which skips most articles and prepositions in every Latin
 * script language) and every number, or character pairs for scripts without
 * spaces.
 */
export function tokensOf(text: string): Set<string> {
  const folded = text.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase();
  if (CJK.test(folded)) {
    const chars = Array.from(folded.replace(/[^\p{L}\p{N}]/gu, ""));
    const pairs = new Set<string>();
    for (let i = 0; i + 1 < chars.length; i += 1) pairs.add(chars[i] + chars[i + 1]);
    return pairs;
  }
  // Numbers always count ("phase 1" and "phase 2" are different questions).
  return new Set(folded.split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 3 || /\d/.test(w)));
}

export function similarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const token of a) if (b.has(token)) shared += 1;
  return shared / (a.size + b.size - shared);
}

/** Prompts this similar may ask the same thing (if their answers agree too). */
export const NEAR_DUPLICATE = 0.7;
/** Lower prompt bar when both items also rest on the same passage. */
const SAME_PASSAGE_DUPLICATE = 0.45;
/** Answers this similar say the same thing. */
const SAME_ANSWER = 0.5;

/**
 * Drop items that ask what an earlier item already asks: the same prompt, or
 * a reworded prompt (or one on the same passage) whose answer also says the
 * same thing. Comparing answers matters: "When is demand elastic?" and "When
 * is demand inelastic?" share almost every word but are different cards, and
 * the contrast between them is exactly what exams test. Earlier sections win,
 * so the survivor sits where the idea first appears.
 */
export function dropNearDuplicates<T>(
  items: readonly Verified<T>[],
  key: (item: T) => string,
  answer: (item: T) => string,
): { kept: Verified<T>[]; dropped: number } {
  const kept: Verified<T>[] = [];
  const seen: { tokens: Set<string>; answer: Set<string>; text: string; quote: string }[] = [];
  let dropped = 0;
  for (const entry of items) {
    const text = key(entry.item).toLowerCase().trim();
    const tokens = tokensOf(text);
    const answerTokens = tokensOf(answer(entry.item));
    const quote = entry.quote.toLowerCase();
    const duplicate = seen.some((other) => {
      if (other.text === text) return true;
      const prompt = similarity(tokens, other.tokens);
      const promptClose = prompt >= NEAR_DUPLICATE || (other.quote === quote && prompt >= SAME_PASSAGE_DUPLICATE);
      return promptClose && sameAnswer(answerTokens, other.answer);
    });
    if (duplicate) {
      dropped += 1;
      continue;
    }
    seen.push({ tokens, answer: answerTokens, text, quote });
    kept.push(entry);
  }
  return { kept, dropped };
}

function sameAnswer(a: Set<string>, b: Set<string>): boolean {
  // Answers too short to compare by words ("Yes", "1") must match exactly.
  if (a.size === 0 || b.size === 0) return a.size === b.size;
  return similarity(a, b) >= SAME_ANSWER;
}

// ---------------------------------------------------------------------------
// Balancing across the document
// ---------------------------------------------------------------------------

/**
 * Choose `total` items so every section gets its quota (from sectionQuotas)
 * when it has enough, a section that came up short leaves its share to
 * sections with spare items (largest spare first), and within a section the
 * picks rotate through its pages rather than taking the first page's items.
 * The result is in document order.
 */
export function balance<T>(
  items: readonly Verified<T>[],
  quotas: readonly number[],
  total: number,
): Verified<T>[] {
  const bySection = quotas.map((_, index) =>
    spreadOverPages(items.filter((entry) => entry.section === index)),
  );
  const take = bySection.map((list, index) => Math.min(list.length, quotas[index] ?? 0));
  let left = total - take.reduce((a, b) => a + b, 0);
  while (left > 0) {
    let best = -1;
    let bestSpare = 0;
    bySection.forEach((list, index) => {
      const spare = list.length - take[index];
      if (spare > bestSpare) {
        best = index;
        bestSpare = spare;
      }
    });
    if (best < 0) break;
    take[best] += 1;
    left -= 1;
  }
  const chosen = bySection.flatMap((list, index) => list.slice(0, take[index]));
  return chosen.sort((a, b) => a.section - b.section || a.page - b.page || a.order - b.order);
}

/** Reorder a section's items so taking a prefix samples every page in turn. */
function spreadOverPages<T>(items: readonly Verified<T>[]): Verified<T>[] {
  const byPage = new Map<number, Verified<T>[]>();
  for (const entry of [...items].sort((a, b) => a.order - b.order)) {
    const list = byPage.get(entry.page) ?? [];
    list.push(entry);
    byPage.set(entry.page, list);
  }
  const queues = [...byPage.entries()].sort((a, b) => a[0] - b[0]).map(([, list]) => list);
  const out: Verified<T>[] = [];
  let round = 0;
  while (out.length < items.length) {
    for (const queue of queues) if (queue[round]) out.push(queue[round]);
    round += 1;
  }
  return out;
}

/**
 * Split `total` between kinds by weight (e.g. 3 multiple-choice : 1 true/false
 * : 1 short answer), never giving a kind more than it has; a kind that runs
 * short leaves its share to the others. Each next item goes to the kind
 * furthest below its weighted share (weighted fair queueing), ties to the
 * heavier kind. Trimming to the requested amount then never silently drops a
 * whole kind.
 */
export function allocateByWeight(
  total: number,
  available: Record<string, number>,
  weights: Record<string, number>,
): Record<string, number> {
  const kinds = Object.keys(available);
  const taken: Record<string, number> = Object.fromEntries(kinds.map((k) => [k, 0]));
  const weight = (k: string) => Math.max(0.01, weights[k] ?? 1);
  for (let n = 0; n < total; n += 1) {
    let best: string | null = null;
    for (const kind of kinds) {
      if (taken[kind] >= available[kind]) continue;
      if (
        best === null ||
        (taken[kind] + 1) / weight(kind) < (taken[best] + 1) / weight(best) ||
        ((taken[kind] + 1) / weight(kind) === (taken[best] + 1) / weight(best) && weight(kind) > weight(best))
      ) {
        best = kind;
      }
    }
    if (best === null) break;
    taken[best] += 1;
  }
  return taken;
}

export type { ProposedCard, ProposedQuestion };
