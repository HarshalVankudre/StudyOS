/**
 * Ink geometry (pure): bounding boxes, eraser hit tests, the precise eraser
 * (which splits strokes), lasso selection and affine transforms of strokes.
 *
 * All coordinates are page units. Strokes keep their samples flat
 * (x, y, pressure triples), see ./model.ts.
 */
import { newId, type Stroke } from "./model";

export interface BBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export const emptyBBox = (): BBox => ({ minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity });

export function pointsBBox(points: readonly number[], pad = 0): BBox {
  const b = emptyBBox();
  for (let i = 0; i < points.length; i += 3) {
    const x = points[i];
    const y = points[i + 1];
    if (x < b.minX) b.minX = x;
    if (y < b.minY) b.minY = y;
    if (x > b.maxX) b.maxX = x;
    if (y > b.maxY) b.maxY = y;
  }
  b.minX -= pad;
  b.minY -= pad;
  b.maxX += pad;
  b.maxY += pad;
  return b;
}

/** Bounds of everything a stroke paints (its samples padded by its width). */
export function strokeBBox(s: Stroke): BBox {
  return pointsBBox(s.points, s.width);
}

export function unionBBox(a: BBox, b: BBox): BBox {
  return {
    minX: Math.min(a.minX, b.minX),
    minY: Math.min(a.minY, b.minY),
    maxX: Math.max(a.maxX, b.maxX),
    maxY: Math.max(a.maxY, b.maxY),
  };
}

export function bboxIntersects(a: BBox, b: BBox): boolean {
  return a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;
}

export function isEmptyBBox(b: BBox): boolean {
  return !(b.maxX >= b.minX && b.maxY >= b.minY);
}

/** Squared distance from point p to segment ab. */
export function distSqToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len = dx * dx + dy * dy;
  let t = len > 0 ? ((px - ax) * dx + (py - ay) * dy) / len : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const cx = ax + t * dx - px;
  const cy = ay + t * dy - py;
  return cx * cx + cy * cy;
}

/** Radius a stroke paints around its centre line (generous: max pressure). */
function paintRadius(s: Stroke): number {
  return s.kind === "highlighter" ? s.width / 2 : s.width * 0.6;
}

/** True when a circle (an eraser tip) touches the stroke. */
export function strokeHitsCircle(s: Stroke, cx: number, cy: number, r: number): boolean {
  const reach = r + paintRadius(s);
  const reachSq = reach * reach;
  const p = s.points;
  if (p.length === 3) {
    const dx = p[0] - cx;
    const dy = p[1] - cy;
    return dx * dx + dy * dy <= reachSq;
  }
  for (let i = 3; i < p.length; i += 3) {
    if (distSqToSegment(cx, cy, p[i - 3], p[i - 2], p[i], p[i + 1]) <= reachSq) return true;
  }
  return false;
}

/**
 * Resample so no segment is longer than `step` (pressure interpolated), so a
 * precise erase of a long straight segment (a snapped shape has only a few
 * samples) cuts it where the eraser was instead of removing it whole.
 */
export function densify(points: readonly number[], step: number): number[] {
  if (points.length <= 3 || step <= 0) return points.slice();
  const out: number[] = [points[0], points[1], points[2]];
  for (let i = 3; i < points.length; i += 3) {
    const ax = points[i - 3];
    const ay = points[i - 2];
    const ap = points[i - 1];
    const bx = points[i];
    const by = points[i + 1];
    const bp = points[i + 2];
    const len = Math.hypot(bx - ax, by - ay);
    const n = Math.min(500, Math.ceil(len / step));
    for (let k = 1; k < n; k++) {
      const t = k / n;
      out.push(ax + (bx - ax) * t, ay + (by - ay) * t, ap + (bp - ap) * t);
    }
    out.push(bx, by, bp);
  }
  return out;
}

/**
 * The precise eraser: remove the parts of a stroke within the circle. Returns
 * null when the circle misses it, otherwise the pieces that remain (new ids;
 * possibly none). Pieces shorter than two samples are dropped.
 */
export function eraseFromStroke(s: Stroke, cx: number, cy: number, r: number): Stroke[] | null {
  if (!strokeHitsCircle(s, cx, cy, r)) return null;
  const reach = r + paintRadius(s) * 0.5;
  const reachSq = reach * reach;
  const pts = densify(s.points, Math.max(0.5, r / 3));
  const pieces: Stroke[] = [];
  let run: number[] = [];
  const flush = () => {
    if (run.length >= 6) pieces.push({ ...s, id: newId(), points: run });
    run = [];
  };
  for (let i = 0; i < pts.length; i += 3) {
    const dx = pts[i] - cx;
    const dy = pts[i + 1] - cy;
    if (dx * dx + dy * dy <= reachSq) flush();
    else run.push(pts[i], pts[i + 1], pts[i + 2]);
  }
  flush();
  return pieces;
}

// ---- Lasso --------------------------------------------------------------------

/** Even-odd point in polygon; `poly` is flat x, y pairs. */
export function pointInPolygon(x: number, y: number, poly: readonly number[]): boolean {
  let inside = false;
  const n = poly.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = poly[i * 2];
    const yi = poly[i * 2 + 1];
    const xj = poly[j * 2];
    const yj = poly[j * 2 + 1];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/**
 * Strokes the lasso selects: at least `share` of a stroke's samples (checked
 * on up to 64 evenly spaced samples) lie inside the polygon.
 */
export function lassoSelect(strokes: Iterable<Stroke>, poly: readonly number[], share = 0.6): Stroke[] {
  if (poly.length < 6) return [];
  const xs: number[] = [];
  const ys: number[] = [];
  for (let i = 0; i < poly.length; i += 2) {
    xs.push(poly[i]);
    ys.push(poly[i + 1]);
  }
  const box: BBox = {
    minX: Math.min(...xs),
    minY: Math.min(...ys),
    maxX: Math.max(...xs),
    maxY: Math.max(...ys),
  };
  const out: Stroke[] = [];
  for (const s of strokes) {
    if (!bboxIntersects(strokeBBox(s), box)) continue;
    const n = s.points.length / 3;
    const step = Math.max(1, Math.floor(n / 64));
    let inside = 0;
    let total = 0;
    for (let i = 0; i < n; i += step) {
      total++;
      if (pointInPolygon(s.points[i * 3], s.points[i * 3 + 1], poly)) inside++;
    }
    if (total > 0 && inside / total >= share) out.push(s);
  }
  return out;
}

// ---- Transforms -----------------------------------------------------------------

/** x' = sx * x + tx, y' = sy * y + ty (uniform or axis scale plus move). */
export interface ScaleMove {
  sx: number;
  sy: number;
  tx: number;
  ty: number;
}

export const IDENTITY: ScaleMove = { sx: 1, sy: 1, tx: 0, ty: 0 };

export function transformStroke(s: Stroke, m: ScaleMove, id = s.id): Stroke {
  const points = s.points.slice();
  for (let i = 0; i < points.length; i += 3) {
    points[i] = points[i] * m.sx + m.tx;
    points[i + 1] = points[i + 1] * m.sy + m.ty;
  }
  const k = Math.sqrt(Math.abs(m.sx * m.sy));
  return { ...s, id, points, width: Math.min(80, Math.max(0.25, s.width * k)) };
}

/** Scale about an anchor point, then move. */
export function scaleAbout(ax: number, ay: number, s: number, dx = 0, dy = 0): ScaleMove {
  return { sx: s, sy: s, tx: ax - ax * s + dx, ty: ay - ay * s + dy };
}

export function transformBBox(b: BBox, m: ScaleMove): BBox {
  const x1 = b.minX * m.sx + m.tx;
  const x2 = b.maxX * m.sx + m.tx;
  const y1 = b.minY * m.sy + m.ty;
  const y2 = b.maxY * m.sy + m.ty;
  return { minX: Math.min(x1, x2), minY: Math.min(y1, y2), maxX: Math.max(x1, x2), maxY: Math.max(y1, y2) };
}
