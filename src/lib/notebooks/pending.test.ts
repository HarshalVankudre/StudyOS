import { describe, expect, it } from "vitest";
import { encodeStroke, toBase64 } from "./codec";
import type { PageMeta, Stroke } from "./model";
import type { Op } from "./ops";
import { batchOps, pagesWithPendingInk, withPendingInk, withPendingPages } from "./pending";

const s = (id: string, color = "#000000"): Stroke => ({ id, kind: "ballpoint", color, width: 2, points: [1, 2, 0.5, 3, 4, 0.5] });
const put = (page: string, st: Stroke): Op => ({ t: "ink.put", page, s: toBase64(encodeStroke(st)) });
const meta = (id: string, position: number): PageMeta => ({
  id,
  position,
  template: { kind: "ruled", paper: "white" },
  width: 794,
  height: 1123,
  pdf: null,
  inkVersion: 3,
  strokeCount: 0,
});

describe("withPendingInk", () => {
  it("replays this page's puts and deletes over the server copy", () => {
    const server = [s("aaaaaaaa"), s("bbbbbbbb")];
    const out = withPendingInk("page0001", server, [
      put("page0001", s("aaaaaaaa", "#ff0000")),
      { t: "ink.del", page: "page0001", id: "bbbbbbbb" },
      put("page0001", s("cccccccc")),
      put("otherpg1", s("dddddddd")),
    ]);
    expect(out.map((x) => [x.id, x.color])).toEqual([
      ["aaaaaaaa", "#ff0000"],
      ["cccccccc", "#000000"],
    ]);
  });
});

describe("withPendingPages", () => {
  it("applies adds, moves, template changes and deletes, sorted by position", () => {
    const out = withPendingPages(
      [meta("page0001", 1), meta("page0002", 2)],
      [
        { t: "page.add", id: "page0003", position: 1.5, template: { kind: "grid", paper: "cream" }, width: 794, height: 1123, pdf: null },
        { t: "page.move", id: "page0001", position: 3 },
        { t: "page.template", id: "page0002", template: { kind: "dots", paper: "dark" } },
        { t: "page.del", id: "nope0000" },
      ],
    );
    expect(out.map((p) => p.id)).toEqual(["page0003", "page0002", "page0001"]);
    expect(out[1].template.kind).toBe("dots");
    expect(out[0].inkVersion).toBe(0);
  });

  it("does not duplicate a page the server already has", () => {
    const out = withPendingPages([meta("page0001", 1)], [
      { t: "page.add", id: "page0001", position: 9, template: { kind: "grid", paper: "cream" }, width: 794, height: 1123 },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].position).toBe(1);
  });
});

describe("batching", () => {
  it("splits by count and size, in order", () => {
    const ops = Array.from({ length: 7 }, (_, i) => put("page0001", s(`stroke0${i}`)));
    const batches = batchOps(ops, 3, 1e9);
    expect(batches.map((b) => b.length)).toEqual([3, 3, 1]);
    expect(batches.flat()).toEqual(ops);
    expect(batchOps(ops, 100, 1).map((b) => b.length)).toEqual([1, 1, 1, 1, 1, 1, 1]);
  });

  it("lists pages with pending ink", () => {
    expect([...pagesWithPendingInk([put("page0001", s("aaaaaaaa")), { t: "page.del", id: "page0002" }])]).toEqual(["page0001"]);
  });
});
