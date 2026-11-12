/**
 * Ids derived from what an item is, not drawn at random: the same parts give
 * the same id on every device and every run.
 *
 * Needed wherever an edit can run twice: an edit passed to
 * `update(fn, { rebase: "rerun" })` is run again on a newer version of the
 * document, and any random id it draws would then differ from the one the
 * student's later edits refer to (an imported deadline would be added twice).
 */

/** 53-bit string hash (cyrb53), as base36. */
function hash53(text: string, seed: number): string {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

/** A stable id for the given parts, e.g. stableId("feed", feedId, eventKey). */
export function stableId(...parts: string[]): string {
  const text = parts.map((p) => `${p.length}:${p}`).join("|");
  return `s-${hash53(text, 1)}${hash53(text, 2)}`;
}
