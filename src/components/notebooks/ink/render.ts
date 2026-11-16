/**
 * Drawing primitives for notebook pages (browser only): paper templates and
 * ink strokes on a 2D canvas context whose transform maps page units to
 * device pixels.
 *
 * Pen strokes are filled outlines from perfect-freehand (pressure-varying
 * width). The outline of a finished stroke is built once and cached as a
 * Path2D (strokes are immutable: an edit makes a new Stroke object), so
 * repainting a page is one fill per stroke. The live stroke uses the very
 * same outline function, so a stroke does not change shape when it is
 * committed. Highlighters are a plain translucent polyline, painted before
 * the pens so they never wash out the writing on top.
 */
import { getStroke } from "perfect-freehand";
import type { PageTemplate, Stroke, StrokeKind } from "@/lib/notebooks/model";
import { strokeBBox, type BBox, bboxIntersects } from "@/lib/notebooks/geometry";

export const HIGHLIGHTER_ALPHA = 0.32;

// ---- Paper ----------------------------------------------------------------------

export const PAPER_FILL: Record<PageTemplate["paper"], string> = {
  white: "#ffffff",
  cream: "#fbf6e8",
  dark: "#1d1f23",
};
const LINE_COLOR: Record<PageTemplate["paper"], string> = {
  white: "#c7d3e3",
  cream: "#d9cfb6",
  dark: "#3a3f47",
};
const MARGIN_COLOR: Record<PageTemplate["paper"], string> = {
  white: "#efb4b4",
  cream: "#e2b0a0",
  dark: "#5b3a3f",
};

/** Ink colours that need flipping to stay visible on dark paper. */
export function inkColorFor(color: string, paper: PageTemplate["paper"]): string {
  if (paper !== "dark") return color;
  if (color === "#000000" || color === "#111111" || color === "#1f2937") return "#f3f4f6";
  return color;
}

/**
 * Paint the paper and its template into the page rectangle (0, 0, w, h) of
 * a context already transformed to page units. `clip` limits line drawing to
 * the visible part (page units).
 */
export function drawPaper(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  template: PageTemplate,
  w: number,
  h: number,
  scale: number,
  clip?: BBox,
) {
  ctx.fillStyle = PAPER_FILL[template.paper];
  ctx.fillRect(0, 0, w, h);
  const x0 = Math.max(0, clip?.minX ?? 0);
  const x1 = Math.min(w, clip?.maxX ?? w);
  const y0 = Math.max(0, clip?.minY ?? 0);
  const y1 = Math.min(h, clip?.maxY ?? h);
  if (x1 <= x0 || y1 <= y0) return;
  // Hairlines: one device pixel at least, so lines stay crisp at any zoom.
  const hair = Math.max(0.6, 1 / scale);
  ctx.lineWidth = hair;
  ctx.strokeStyle = LINE_COLOR[template.paper];
  ctx.fillStyle = LINE_COLOR[template.paper];

  const hLines = (spacing: number, top: number, from = 0, to = w) => {
    ctx.beginPath();
    const first = Math.max(top, top + Math.ceil((y0 - top) / spacing) * spacing);
    for (let y = first; y <= Math.min(y1, h - 8); y += spacing) {
      ctx.moveTo(Math.max(from, x0), y);
      ctx.lineTo(Math.min(to, x1), y);
    }
    ctx.stroke();
  };
  const vLines = (spacing: number) => {
    ctx.beginPath();
    for (let x = Math.ceil(x0 / spacing) * spacing; x <= x1; x += spacing) {
      ctx.moveTo(x, y0);
      ctx.lineTo(x, y1);
    }
    ctx.stroke();
  };
  const margin = (x: number) => {
    if (x < x0 || x > x1) return;
    ctx.save();
    ctx.strokeStyle = MARGIN_COLOR[template.paper];
    ctx.beginPath();
    ctx.moveTo(x, y0);
    ctx.lineTo(x, y1);
    ctx.stroke();
    ctx.restore();
  };

  switch (template.kind) {
    case "blank":
      return;
    case "ruled":
      hLines(32, 112);
      margin(88);
      return;
    case "narrow":
      hLines(25, 100);
      margin(80);
      return;
    case "grid":
      hLines(19, 0);
      vLines(19);
      return;
    case "dots": {
      const r = Math.max(0.9, 1.2 / Math.sqrt(scale));
      const s = 19;
      for (let y = Math.ceil(y0 / s) * s; y <= y1; y += s) {
        ctx.beginPath();
        for (let x = Math.ceil(x0 / s) * s; x <= x1; x += s) {
          ctx.moveTo(x + r, y);
          ctx.arc(x, y, r, 0, Math.PI * 2);
        }
        ctx.fill();
      }
      return;
    }
    case "cornell": {
      const titleH = 120;
      const summaryTop = h - 190;
      const cueW = Math.round(w * 0.3);
      hLines(30, titleH + 30, cueW, w);
      ctx.save();
      ctx.lineWidth = hair * 2;
      ctx.beginPath();
      ctx.moveTo(0, titleH);
      ctx.lineTo(w, titleH);
      ctx.moveTo(cueW, titleH);
      ctx.lineTo(cueW, summaryTop);
      ctx.moveTo(0, summaryTop);
      ctx.lineTo(w, summaryTop);
      ctx.stroke();
      ctx.restore();
      return;
    }
  }
}

// ---- Ink ----------------------------------------------------------------------

type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

interface FreehandOptions {
  size: number;
  thinning: number;
  smoothing: number;
  streamline: number;
}

/**
 * Per-kind outline settings. They are part of how a stored stroke looks, so
 * they are the same on every device and input type; mouse and finger input
 * record a constant pressure instead (see the engine).
 */
export function freehandOptions(kind: StrokeKind, width: number): FreehandOptions {
  if (kind === "fountain") return { size: width * 1.15, thinning: 0.62, smoothing: 0.55, streamline: 0.22 };
  return { size: width, thinning: 0.18, smoothing: 0.5, streamline: 0.22 };
}

function toFreehandInput(points: readonly number[], extra?: readonly number[]): number[][] {
  const out: number[][] = [];
  for (let i = 0; i < points.length; i += 3) out.push([points[i], points[i + 1], points[i + 2]]);
  if (extra) for (let i = 0; i < extra.length; i += 3) out.push([extra[i], extra[i + 1], extra[i + 2]]);
  return out;
}

/** Path through the outline using quadratic curves between midpoints. */
function outlinePath(outline: number[][]): Path2D {
  const path = new Path2D();
  const n = outline.length;
  if (n < 2) return path;
  path.moveTo(outline[0][0], outline[0][1]);
  for (let i = 1; i < n; i++) {
    const [x0, y0] = outline[i];
    const [x1, y1] = outline[(i + 1) % n];
    path.quadraticCurveTo(x0, y0, (x0 + x1) / 2, (y0 + y1) / 2);
  }
  path.closePath();
  return path;
}

/** Outline path of a pen stroke (live or finished). */
export function penPath(kind: StrokeKind, width: number, points: readonly number[], last: boolean, predicted?: readonly number[]): Path2D {
  const input = toFreehandInput(points, predicted);
  if (input.length === 1) {
    // A dot: perfect-freehand needs two samples.
    const [x, y, p] = input[0];
    const r = (width * (kind === "fountain" ? 0.35 + p * 0.5 : 0.5)) / 1;
    const path = new Path2D();
    path.arc(x, y, Math.max(0.3, r), 0, Math.PI * 2);
    return path;
  }
  const o = freehandOptions(kind, width);
  return outlinePath(getStroke(input, { ...o, simulatePressure: false, last }));
}

/** Centre-line path of a highlighter stroke. */
export function polylinePath(points: readonly number[], predicted?: readonly number[]): Path2D {
  const path = new Path2D();
  if (points.length < 3) return path;
  path.moveTo(points[0], points[1]);
  if (points.length === 3) path.lineTo(points[0] + 0.01, points[1]);
  for (let i = 3; i < points.length; i += 3) path.lineTo(points[i], points[i + 1]);
  if (predicted) for (let i = 0; i < predicted.length; i += 3) path.lineTo(predicted[i], predicted[i + 1]);
  return path;
}

interface StrokeCache {
  path: Path2D;
  bbox: BBox;
}
const cache = new WeakMap<Stroke, StrokeCache>();

export function strokeCache(s: Stroke): StrokeCache {
  let c = cache.get(s);
  if (!c) {
    c = {
      path: s.kind === "highlighter" ? polylinePath(s.points) : penPath(s.kind, s.width, s.points, true),
      bbox: strokeBBox(s),
    };
    cache.set(s, c);
  }
  return c;
}

/** Paint one finished stroke (context in page units). */
export function drawStroke(ctx: Ctx2D, s: Stroke, paper: PageTemplate["paper"] = "white") {
  const { path } = strokeCache(s);
  if (s.kind === "highlighter") {
    ctx.save();
    ctx.globalAlpha = HIGHLIGHTER_ALPHA;
    ctx.strokeStyle = s.color;
    ctx.lineWidth = s.width;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.stroke(path);
    ctx.restore();
    return;
  }
  ctx.fillStyle = inkColorFor(s.color, paper);
  ctx.fill(path);
}

/**
 * Paint strokes (highlighters first), skipping those outside `clip` and
 * those in `hidden` (strokes being dragged by the lasso).
 */
export function drawStrokes(
  ctx: Ctx2D,
  strokes: Iterable<Stroke>,
  paper: PageTemplate["paper"],
  clip?: BBox,
  hidden?: ReadonlySet<string>,
) {
  const pens: Stroke[] = [];
  for (const s of strokes) {
    if (hidden?.has(s.id)) continue;
    if (clip && !bboxIntersects(strokeCache(s).bbox, clip)) continue;
    if (s.kind === "highlighter") drawStroke(ctx, s, paper);
    else pens.push(s);
  }
  for (const s of pens) drawStroke(ctx, s, paper);
}

/** Paint the stroke being drawn, with optional predicted samples ahead of the pen. */
export function drawLiveStroke(
  ctx: Ctx2D,
  kind: StrokeKind,
  color: string,
  width: number,
  points: readonly number[],
  paper: PageTemplate["paper"],
  predicted?: readonly number[],
) {
  if (points.length < 3) return;
  if (kind === "highlighter") {
    ctx.save();
    ctx.globalAlpha = HIGHLIGHTER_ALPHA;
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.stroke(polylinePath(points, predicted));
    ctx.restore();
    return;
  }
  ctx.fillStyle = inkColorFor(color, paper);
  ctx.fill(penPath(kind, width, points, false, predicted));
}
