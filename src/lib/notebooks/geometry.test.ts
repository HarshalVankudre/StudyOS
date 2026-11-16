import { describe, expect, it } from "vitest";
import {
  densify,
  eraseFromStroke,
  lassoSelect,
  pointInPolygon,
  scaleAbout,
  strokeBBox,
  strokeHitsCircle,
  transformStroke,
} from "./geometry";
import { recognizeShape } from "./shapes";
import type { Stroke } from "./model";

const line = (id: string, x1: number, y1: number, x2: number, y2: number, n = 20): Stroke => ({
  id,
  kind: "ballpoint",
  color: "#000000",
  width: 2,
  points: Array.from({ length: n + 1 }, (_, i) => [x1 + ((x2 - x1) * i) / n, y1 + ((y2 - y1) * i) / n, 0.5]).flat(),
});

/** A wobbly hand-drawn loop through the given corners (or an ellipse). */
function drawn(corners: [number, number][], perSide = 30, wobble = 1.5): number[] {
  const out: number[] = [];
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * 2 * wobble;
  for (let i = 0; i < corners.length; i++) {
    const [ax, ay] = corners[i];
    const [bx, by] = corners[(i + 1) % corners.length];
    for (let k = 0; k < perSide; k++) {
      const t = k / perSide;
      out.push(ax + (bx - ax) * t + rnd(), ay + (by - ay) * t + rnd(), 0.5);
    }
  }
  out.push(corners[0][0] + 3, corners[0][1] + 2, 0.5);
  return out;
}

describe("eraser", () => {
  it("hits a stroke within reach and misses outside", () => {
    const s = line("aaaaaaaa", 0, 0, 100, 0);
    expect(strokeHitsCircle(s, 50, 3, 3)).toBe(true);
    expect(strokeHitsCircle(s, 50, 20, 3)).toBe(false);
  });

  it("splits a stroke in two around the eraser", () => {
    const s = line("aaaaaaaa", 0, 0, 100, 0, 2); // sparse: needs densifying
    const pieces = eraseFromStroke(s, 50, 0, 5)!;
    expect(pieces).toHaveLength(2);
    const [a, b] = pieces.map(strokeBBox);
    expect(a.maxX).toBeLessThan(50);
    expect(b.minX).toBeGreaterThan(50);
    expect(new Set(pieces.map((p) => p.id)).size).toBe(2);
    expect(pieces.every((p) => p.id !== s.id)).toBe(true);
  });

  it("returns null when it misses and [] when it covers everything", () => {
    const s = line("aaaaaaaa", 0, 0, 4, 0);
    expect(eraseFromStroke(s, 50, 50, 3)).toBeNull();
    expect(eraseFromStroke(s, 2, 0, 20)).toEqual([]);
  });

  it("densify bounds segment length", () => {
    const d = densify([0, 0, 0, 10, 0, 1], 2);
    expect(d.length / 3).toBe(6);
    expect(d[d.length - 1]).toBe(1);
  });
});

describe("lasso", () => {
  const square = [0, 0, 100, 0, 100, 100, 0, 100];
  it("point in polygon", () => {
    expect(pointInPolygon(50, 50, square)).toBe(true);
    expect(pointInPolygon(150, 50, square)).toBe(false);
  });
  it("selects strokes mostly inside", () => {
    const inside = line("aaaaaaaa", 10, 10, 90, 90);
    const half = line("bbbbbbbb", 50, 50, 150, 50);
    const outside = line("cccccccc", 200, 200, 300, 300);
    const ids = lassoSelect([inside, half, outside], square).map((s) => s.id);
    expect(ids).toEqual(["aaaaaaaa"]);
  });
});

describe("transform", () => {
  it("scales about an anchor and scales the width", () => {
    const s = line("aaaaaaaa", 10, 10, 20, 10, 1);
    const t = transformStroke(s, scaleAbout(10, 10, 2, 5, 0));
    expect(t.points.slice(0, 2)).toEqual([15, 10]);
    expect(t.points.slice(3, 5)).toEqual([35, 10]);
    expect(t.width).toBe(4);
    expect(t.id).toBe(s.id);
  });
});

describe("shape snapping", () => {
  it("snaps a nearly straight stroke to a line", () => {
    const pts = drawn([[0, 0]], 1, 0);
    const wobbly = [0, 0, 0.5, 50, 1, 0.5, 100, -1, 0.5, 150, 0.5, 0.5, 200, 0, 0.5];
    expect(recognizeShape(wobbly)?.kind).toBe("line");
    expect(pts.length).toBeGreaterThan(0);
  });

  it("snaps a rough box to an axis-aligned rectangle", () => {
    const shape = recognizeShape(drawn([[0, 0], [200, 0], [200, 120], [0, 120]]));
    expect(shape?.kind).toBe("rectangle");
  });

  it("snaps a rough triangle", () => {
    expect(recognizeShape(drawn([[0, 100], [60, 0], [120, 100]]))?.kind).toBe("triangle");
  });

  it("snaps a rough circle", () => {
    const pts: number[] = [];
    for (let i = 0; i <= 120; i++) {
      const t = (i / 120) * Math.PI * 2;
      const r = 80 + Math.sin(i * 1.7) * 2;
      pts.push(200 + Math.cos(t) * r, 200 + Math.sin(t) * r, 0.5);
    }
    expect(recognizeShape(pts)?.kind).toBe("circle");
  });

  it("snaps an ellipse", () => {
    const pts: number[] = [];
    for (let i = 0; i <= 120; i++) {
      const t = (i / 120) * Math.PI * 2;
      pts.push(200 + Math.cos(t) * 150, 200 + Math.sin(t) * 60, 0.5);
    }
    expect(recognizeShape(pts)?.kind).toBe("ellipse");
  });

  it("leaves scribbles alone", () => {
    const pts: number[] = [];
    for (let i = 0; i < 200; i++) pts.push(i * 2, Math.sin(i / 3) * 40, 0.5);
    expect(recognizeShape(pts)).toBeNull();
  });
});
