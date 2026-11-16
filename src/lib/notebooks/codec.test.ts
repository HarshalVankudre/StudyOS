import { describe, expect, it } from "vitest";
import {
  CodecError,
  decodePage,
  decodeStroke,
  EMPTY_PAGE,
  encodePage,
  encodeStroke,
  fromBase64,
  normalizeStroke,
  recordId,
  splitPage,
  toBase64,
} from "./codec";
import { applyInkOps, InkLimitError } from "./ops";
import type { Stroke } from "./model";

const stroke = (id: string, n = 50): Stroke => ({
  id,
  kind: "fountain",
  color: "#1e40af",
  width: 2.5,
  points: Array.from({ length: n }, (_, i) => [100 + i * 1.37, 200 - i * 0.61, (i % 10) / 10]).flat(),
});

describe("ink codec", () => {
  it("round-trips a stroke within the quantisation step", () => {
    const s = stroke("abcdefgh12");
    const back = decodeStroke(encodeStroke(s));
    expect(back.id).toBe(s.id);
    expect(back.kind).toBe("fountain");
    expect(back.color).toBe("#1e40af");
    expect(back.width).toBe(2.5);
    expect(back.points).toHaveLength(s.points.length);
    for (let i = 0; i < s.points.length; i++) {
      const tol = i % 3 === 2 ? 1 / 255 : 1 / 16;
      expect(Math.abs(back.points[i] - s.points[i])).toBeLessThanOrEqual(tol);
    }
  });

  it("normalised strokes are stable", () => {
    const n = normalizeStroke(stroke("abcdefgh12"));
    expect(normalizeStroke(n)).toEqual(n);
  });

  it("is compact (about 4 bytes a sample)", () => {
    const rec = encodeStroke(stroke("abcdefgh12", 1000));
    expect(rec.length).toBeLessThan(1000 * 5);
  });

  it("handles negative coordinates", () => {
    const s: Stroke = { ...stroke("abcdefgh12", 3), points: [-5, -10, 0.5, 3, -2, 0.2, -1000, 400, 1] };
    expect(decodeStroke(encodeStroke(s)).points).toEqual([-5, -10, 0.5 * 0 + 128 / 255, 3, -2, 51 / 255, -1000, 400, 1]);
  });

  it("frames pages and reads ids without decoding", () => {
    const page = encodePage([stroke("aaaaaaaa"), stroke("bbbbbbbb")]);
    const recs = splitPage(page);
    expect(recs.map(recordId)).toEqual(["aaaaaaaa", "bbbbbbbb"]);
    expect(decodePage(page).map((s) => s.id)).toEqual(["aaaaaaaa", "bbbbbbbb"]);
    expect(splitPage(EMPTY_PAGE)).toEqual([]);
    expect(splitPage(new Uint8Array())).toEqual([]);
  });

  it("refuses malformed input", () => {
    expect(() => splitPage(new Uint8Array([1, 2, 3]))).toThrow(CodecError);
    const rec = encodeStroke(stroke("abcdefgh12"));
    expect(() => decodeStroke(rec.subarray(0, rec.length - 1))).toThrow(CodecError);
    const bad = rec.slice();
    bad[1] = "!".charCodeAt(0); // invalid id character
    expect(() => decodeStroke(bad)).toThrow(CodecError);
    expect(() => decodeStroke(new Uint8Array([...rec, 0]))).toThrow(CodecError);
  });

  it("base64 round-trips", () => {
    const bytes = encodePage([stroke("aaaaaaaa", 5000)]);
    expect(fromBase64(toBase64(bytes))).toEqual(bytes);
  });
});

describe("applyInkOps", () => {
  const put = (s: Stroke) => ({ t: "ink.put" as const, page: "pagepage1", s: toBase64(encodeStroke(s)) });

  it("adds, replaces in place and deletes by id", () => {
    let blob = EMPTY_PAGE;
    blob = applyInkOps(blob, [put(stroke("aaaaaaaa")), put(stroke("bbbbbbbb"))])!.blob;
    const moved = { ...stroke("aaaaaaaa"), color: "#ff0000" };
    const res = applyInkOps(blob, [put(moved), { t: "ink.del", page: "pagepage1", id: "zzzzzzzz" }])!;
    expect(res.strokeCount).toBe(2);
    const strokes = decodePage(res.blob);
    expect(strokes.map((s) => s.id)).toEqual(["aaaaaaaa", "bbbbbbbb"]);
    expect(strokes[0].color).toBe("#ff0000");
    const del = applyInkOps(res.blob, [{ t: "ink.del", page: "pagepage1", id: "aaaaaaaa" }])!;
    expect(decodePage(del.blob).map((s) => s.id)).toEqual(["bbbbbbbb"]);
  });

  it("is idempotent", () => {
    const ops = [put(stroke("aaaaaaaa"))];
    const once = applyInkOps(EMPTY_PAGE, ops)!.blob;
    expect(applyInkOps(once, ops)!.blob).toEqual(once);
    expect(applyInkOps(once, [{ t: "ink.del", page: "pagepage1", id: "nothere1" }])).toBeNull();
  });

  it("refuses a malformed record", () => {
    expect(() => applyInkOps(EMPTY_PAGE, [{ t: "ink.put", page: "pagepage1", s: toBase64(new Uint8Array([3, 1, 2])) }])).toThrow(
      CodecError,
    );
  });

  it("caps strokes per page", () => {
    const many = Array.from({ length: 20_001 }, (_, i) => put(stroke(`s${String(i).padStart(9, "0")}`, 1)));
    expect(() => applyInkOps(EMPTY_PAGE, many)).toThrow(InkLimitError);
  });
});
