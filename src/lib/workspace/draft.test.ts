import { describe, expect, it } from "vitest";
import { deepEqual } from "./changes";
import { produce } from "./draft";

type Doc = {
  name: string;
  pages: { id: string; title: string; blocks: { id: string; type: string; text: string; tags?: string[] }[] }[];
  meta?: { n: number };
};

function doc(): Doc {
  return {
    name: "W",
    pages: [
      { id: "p1", title: "Home", blocks: [{ id: "a", type: "p", text: "A" }, { id: "b", type: "p", text: "B", tags: ["x"] }] },
      { id: "p2", title: "Notes", blocks: [{ id: "c", type: "p", text: "C" }] },
    ],
    meta: { n: 1 },
  };
}

describe("produce (copy-on-write drafts)", () => {
  it("writes like a clone, never changes the input, and shares what it did not touch", () => {
    const base = doc();
    const frozen = structuredClone(base);
    const next = produce(base, (d) => {
      d.pages[0].blocks[1].text = "B!";
      d.pages[0].blocks.push({ id: "n", type: "p", text: "new" });
    });
    expect(base).toEqual(frozen);
    expect(next.pages[0].blocks.map((b) => b.text)).toEqual(["A", "B!", "new"]);
    expect(next.pages[1]).toBe(base.pages[1]);
    expect(next.pages[0].blocks[0]).toBe(base.pages[0].blocks[0]);
    expect(next.meta).toBe(base.meta);
    expect(Array.isArray(next.pages[0].blocks)).toBe(true);
  });

  it("returns the input itself when nothing was written", () => {
    const base = doc();
    expect(produce(base, (d) => void d.pages[0].blocks.find((b) => b.id === "a"))).toBe(base);
    expect(produce(base, (d) => void (d.name = "W"))).toBe(base);
  });

  it("supports moving, filtering, replacing and deleting", () => {
    const base = doc();
    const next = produce(base, (d) => {
      const bs = d.pages[0].blocks;
      bs.push(bs.shift()!); // move
      d.pages[1].blocks = d.pages[1].blocks.filter((b) => b.id !== "c");
      d.pages.push({ ...d.pages[0], id: "p3" }); // a copy holding drafted children
      delete d.meta;
    });
    expect(next.pages[0].blocks.map((b) => b.id)).toEqual(["b", "a"]);
    expect(next.pages[1].blocks).toEqual([]);
    expect(next.pages[2].id).toBe("p3");
    expect(next.pages[2].blocks).toEqual(next.pages[0].blocks);
    expect("meta" in next).toBe(false);
    expect(JSON.stringify(next)).not.toContain("draft-state");
  });

  it("ignores writes to a draft kept after produce returned", () => {
    const base = doc();
    let kept: Doc["pages"][0] | null = null;
    const next = produce(base, (d) => {
      kept = d.pages[0];
      d.name = "X";
    });
    kept!.title = "late";
    expect(next.pages[0].title).toBe("Home");
    expect(base.pages[0].title).toBe("Home");
  });

  // Compared with a JSON clone: documents are JSON, with value semantics (an
  // object placed in two spots is two values from then on).
  it("matches a cloned run on random mutations", () => {
    let seed = 7;
    const rnd = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    // Every random choice is made before the mutation runs, so the clone run
    // and the draft run do exactly the same thing.
    const muts: ((r: number) => (d: Doc) => void)[] = [
      () => (d) => void (d.pages[0].blocks[0] && (d.pages[0].blocks[0].text += "x")),
      (r) => (d) => void d.pages[Math.floor(r * d.pages.length)].blocks.splice(0, 1),
      (r) => (d) => void d.pages[0].blocks.unshift({ id: `n${r}`, type: "p", text: "u" }),
      () => (d) => void d.pages.reverse(),
      () => (d) => void (d.pages[0].blocks = d.pages[0].blocks.map((b) => ({ ...b, text: b.text + "!" }))),
      () => (d) => void d.pages[1]?.blocks.sort((a, b) => a.id.localeCompare(b.id)),
      () => (d) => void (d.pages[0].blocks[1] && (d.pages[0].blocks[1].tags = ["y", ...(d.pages[0].blocks[1].tags ?? [])])),
      () => (d) => void (d.meta = { n: (d.meta?.n ?? 0) + 1 }),
      () => (d) => void d.pages.push(d.pages[0]),
      () => (d) => void (d.pages[0].blocks.length = Math.min(1, d.pages[0].blocks.length)),
    ];
    for (let run = 0; run < 500; run += 1) {
      let base = doc();
      for (let step = 0; step < 6; step += 1) {
        const fns = Array.from({ length: 1 + Math.floor(rnd() * 3) }, () =>
          muts[Math.floor(rnd() * muts.length)](rnd()),
        );
        const clone = JSON.parse(JSON.stringify(base)) as Doc;
        for (const fn of fns) fn(clone);
        const frozen = JSON.stringify(base);
        const next = produce(base, (d) => fns.forEach((fn) => fn(d)));
        expect(JSON.stringify(base)).toBe(frozen);
        expect(deepEqual(next, clone)).toBe(true);
        base = next;
      }
    }
  });

  it("throws for what a draft cannot take part in (callers fall back to a clone)", () => {
    expect(() => produce(doc(), (d) => void structuredClone(d.pages[0]))).toThrow();
  });
});
