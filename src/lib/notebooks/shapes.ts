/**
 * Shape snapping (pure): "draw and hold" turns a rough stroke into a clean
 * line, triangle, rectangle (or other quadrilateral), circle or ellipse.
 *
 * Input and output are flat x, y, pressure samples in page units. The result
 * keeps the stroke's typical pressure so a snapped shape has the same weight
 * as the hand-drawn line it replaces. Returns null when nothing fits well;
 * the stroke is then kept as drawn.
 */

export type ShapeKind = "line" | "triangle" | "rectangle" | "quad" | "circle" | "ellipse";

export interface SnappedShape {
  kind: ShapeKind;
  points: number[];
}

interface P {
  x: number;
  y: number;
}

function toPoints(flat: readonly number[]): P[] {
  const out: P[] = [];
  for (let i = 0; i < flat.length; i += 3) out.push({ x: flat[i], y: flat[i + 1] });
  return out;
}

function medianPressure(flat: readonly number[]): number {
  const ps: number[] = [];
  for (let i = 2; i < flat.length; i += 3) ps.push(flat[i]);
  ps.sort((a, b) => a - b);
  return ps.length ? ps[Math.floor(ps.length / 2)] : 0.5;
}

const dist = (a: P, b: P) => Math.hypot(a.x - b.x, a.y - b.y);

function pathLength(ps: P[]): number {
  let l = 0;
  for (let i = 1; i < ps.length; i++) l += dist(ps[i - 1], ps[i]);
  return l;
}

function segDist(p: P, a: P, b: P): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = dx * dx + dy * dy;
  let t = len ? ((p.x - a.x) * dx + (p.y - a.y) * dy) / len : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(a.x + t * dx - p.x, a.y + t * dy - p.y);
}

/** Ramer–Douglas–Peucker simplification. */
export function simplify(ps: P[], tol: number): P[] {
  if (ps.length < 3) return ps.slice();
  const keep = new Uint8Array(ps.length);
  keep[0] = keep[ps.length - 1] = 1;
  const stack: [number, number][] = [[0, ps.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    let best = -1;
    let bestD = tol;
    for (let i = a + 1; i < b; i++) {
      const d = segDist(ps[i], ps[a], ps[b]);
      if (d > bestD) {
        bestD = d;
        best = i;
      }
    }
    if (best >= 0) {
      keep[best] = 1;
      stack.push([a, best], [best, b]);
    }
  }
  return ps.filter((_, i) => keep[i]);
}

/** Evenly spaced samples along a polyline (closed when `close`). */
function samplePolyline(vs: P[], close: boolean, step: number, pressure: number): number[] {
  const pts = close ? [...vs, vs[0]] : vs;
  const out: number[] = [];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const n = Math.max(1, Math.ceil(dist(a, b) / step));
    for (let k = 0; k < n; k++) {
      const t = k / n;
      out.push(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, pressure);
    }
  }
  const last = pts[pts.length - 1];
  out.push(last.x, last.y, pressure);
  return out;
}

function meanDistToPolygon(ps: P[], vs: P[]): number {
  let total = 0;
  for (const p of ps) {
    let best = Infinity;
    for (let i = 0; i < vs.length; i++) best = Math.min(best, segDist(p, vs[i], vs[(i + 1) % vs.length]));
    total += best;
  }
  return total / ps.length;
}

interface EllipseFit {
  cx: number;
  cy: number;
  a: number;
  b: number;
  angle: number;
  error: number;
}

/** Fit an ellipse by principal axes; error is the mean relative radial misfit. */
function fitEllipse(ps: P[]): EllipseFit {
  let cx = 0;
  let cy = 0;
  for (const p of ps) {
    cx += p.x;
    cy += p.y;
  }
  cx /= ps.length;
  cy /= ps.length;
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (const p of ps) {
    const dx = p.x - cx;
    const dy = p.y - cy;
    sxx += dx * dx;
    syy += dy * dy;
    sxy += dx * dy;
  }
  sxx /= ps.length;
  syy /= ps.length;
  sxy /= ps.length;
  const angle = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  // Radii from the extent along each axis (robust to uneven sampling).
  let maxU = 0;
  let maxV = 0;
  for (const p of ps) {
    const dx = p.x - cx;
    const dy = p.y - cy;
    maxU = Math.max(maxU, Math.abs(dx * cos + dy * sin));
    maxV = Math.max(maxV, Math.abs(-dx * sin + dy * cos));
  }
  const a = Math.max(1, maxU);
  const b = Math.max(1, maxV);
  let err = 0;
  for (const p of ps) {
    const dx = p.x - cx;
    const dy = p.y - cy;
    const u = (dx * cos + dy * sin) / a;
    const v = (-dx * sin + dy * cos) / b;
    err += Math.abs(Math.hypot(u, v) - 1);
  }
  return { cx, cy, a, b, angle, error: err / ps.length };
}

function ellipsePoints(f: EllipseFit, pressure: number): number[] {
  const n = Math.max(48, Math.min(240, Math.round((f.a + f.b) / 2)));
  const cos = Math.cos(f.angle);
  const sin = Math.sin(f.angle);
  const out: number[] = [];
  for (let i = 0; i <= n; i++) {
    const t = (i / n) * Math.PI * 2;
    const u = Math.cos(t) * f.a;
    const v = Math.sin(t) * f.b;
    out.push(f.cx + u * cos - v * sin, f.cy + u * sin + v * cos, pressure);
  }
  return out;
}

/** Snap a 4-corner polygon to an axis-aligned rectangle when its sides are near-axis. */
function maybeAxisRect(vs: P[]): P[] | null {
  for (let i = 0; i < 4; i++) {
    const a = vs[i];
    const b = vs[(i + 1) % 4];
    const ang = Math.abs(Math.atan2(b.y - a.y, b.x - a.x)) % (Math.PI / 2);
    const off = Math.min(ang, Math.PI / 2 - ang);
    if (off > (12 * Math.PI) / 180) return null;
  }
  const xs = vs.map((v) => v.x).sort((a, b) => a - b);
  const ys = vs.map((v) => v.y).sort((a, b) => a - b);
  const x1 = (xs[0] + xs[1]) / 2;
  const x2 = (xs[2] + xs[3]) / 2;
  const y1 = (ys[0] + ys[1]) / 2;
  const y2 = (ys[2] + ys[3]) / 2;
  return [
    { x: x1, y: y1 },
    { x: x2, y: y1 },
    { x: x2, y: y2 },
    { x: x1, y: y2 },
  ];
}

export function recognizeShape(flat: readonly number[]): SnappedShape | null {
  const ps = toPoints(flat);
  if (ps.length < 3) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of ps) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  const diag = Math.hypot(maxX - minX, maxY - minY);
  if (diag < 12) return null;
  const pressure = medianPressure(flat);
  const step = 2;
  const length = pathLength(ps);
  const start = ps[0];
  const end = ps[ps.length - 1];

  // A line: the ends are nearly as far apart as the path is long.
  if (dist(start, end) / length > 0.93) {
    return { kind: "line", points: samplePolyline([start, end], false, step, pressure) };
  }

  // Closed shapes: the stroke ends near where it started.
  const gap = dist(start, end);
  if (gap > Math.max(24, length * 0.2)) return null;

  const body = ps;
  const ellipse = fitEllipse(body);

  let vs = simplify(body, diag * 0.09);
  // The simplification of a closed loop repeats the start at the end.
  if (vs.length > 2 && dist(vs[0], vs[vs.length - 1]) < diag * 0.2) {
    const merged = { x: (vs[0].x + vs[vs.length - 1].x) / 2, y: (vs[0].y + vs[vs.length - 1].y) / 2 };
    vs = [merged, ...vs.slice(1, -1)];
  }
  // Drop near-straight joints (a corner that turns less than ~25 degrees).
  vs = vs.filter((v, i) => {
    if (vs.length <= 3) return true;
    const a = vs[(i - 1 + vs.length) % vs.length];
    const b = vs[(i + 1) % vs.length];
    const a1 = Math.atan2(v.y - a.y, v.x - a.x);
    const a2 = Math.atan2(b.y - v.y, b.x - v.x);
    let turn = Math.abs(a2 - a1);
    if (turn > Math.PI) turn = 2 * Math.PI - turn;
    return turn > (25 * Math.PI) / 180;
  });

  const polygonFits = (n: number) =>
    vs.length === n && meanDistToPolygon(body, vs) < diag * 0.045;

  if (polygonFits(3) && ellipse.error > 0.06) {
    return { kind: "triangle", points: samplePolyline(vs, true, step, pressure) };
  }
  if (polygonFits(4) && ellipse.error > 0.05) {
    const rect = maybeAxisRect(vs);
    return rect
      ? { kind: "rectangle", points: samplePolyline(rect, true, step, pressure) }
      : { kind: "quad", points: samplePolyline(vs, true, step, pressure) };
  }
  if (ellipse.error < 0.12) {
    const ratio = Math.min(ellipse.a, ellipse.b) / Math.max(ellipse.a, ellipse.b);
    if (ratio > 0.85) {
      const r = (ellipse.a + ellipse.b) / 2;
      return { kind: "circle", points: ellipsePoints({ ...ellipse, a: r, b: r, angle: 0 }, pressure) };
    }
    return { kind: "ellipse", points: ellipsePoints(ellipse, pressure) };
  }
  return null;
}
