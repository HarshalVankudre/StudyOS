/**
 * The notebook ink engine (browser only, framework-free).
 *
 * Latency is the point of this file. The hot path (a pen sample arriving)
 * never goes through React, never waits for an animation frame and never
 * repaints the page:
 *
 *  - Input: Pointer Events with every coalesced sample (Apple Pencil reports
 *    240 Hz; the browser dispatches one event per frame carrying the rest),
 *    `pointerrawupdate` where supported (Chromium: events at hardware rate,
 *    not aligned to frames), and predicted samples drawn ahead of the pen
 *    (the browser's getPredictedEvents, or a short linear extrapolation).
 *  - Wet layer: the stroke being drawn is painted on its own canvas created
 *    `desynchronized` (Chromium presents it without waiting for the
 *    compositor's frame), cleared and redrawn only inside its dirty rectangle.
 *  - Delegated ink trail: on Chromium (Windows, ChromeOS) `navigator.ink`
 *    lets the OS compositor draw the last stretch from the newest sample to
 *    the pen tip, the same technique as native Windows Ink.
 *  - Page layer: each page is kept as a raster (paper, PDF background and
 *    ink), so scrolling and pinch-zooming are a few image copies per frame.
 *    At rest a page whose raster is too coarse for the zoom (or too big to
 *    allocate) is drawn from vectors, clipped to the visible part.
 *
 * On iPad, Safari renders at 60 Hz unless the "Prefer Page Rendering Updates
 * near 60fps" feature flag is off; the engine runs at whatever rate the
 * browser presents (120 Hz with ProMotion when allowed) and still uses all
 * 240 Hz samples for the stroke's shape.
 *
 * Every change is reported as ops (lib/notebooks/ops.ts) through
 * `callbacks.onOps`; the sync layer persists and sends them.
 */
import { normalizeStroke, encodeStroke, toBase64 } from "@/lib/notebooks/codec";
import {
  bboxIntersects,
  eraseFromStroke,
  isEmptyBBox,
  lassoSelect,
  pointsBBox,
  scaleAbout,
  strokeBBox,
  strokeHitsCircle,
  transformBBox,
  transformStroke,
  unionBBox,
  emptyBBox,
  type BBox,
  type ScaleMove,
} from "@/lib/notebooks/geometry";
import {
  newId,
  positionBetween,
  type PageMeta,
  type PageTemplate,
  type Stroke,
  type StrokeKind,
} from "@/lib/notebooks/model";
import type { Op } from "@/lib/notebooks/ops";
import { recognizeShape } from "@/lib/notebooks/shapes";
import { drawLiveStroke, drawPaper, drawStroke, drawStrokes } from "./render";
import { renderPdfPage } from "./pdf";

// ---- Public types ---------------------------------------------------------------

export type Tool = "pen" | "highlighter" | "eraser" | "lasso";
export type EraserMode = "stroke" | "precise";

export interface ToolSettings {
  tool: Tool;
  penKind: Exclude<StrokeKind, "highlighter">;
  penColor: string;
  penWidth: number;
  highlighterColor: string;
  highlighterWidth: number;
  eraserMode: EraserMode;
  eraserSize: number;
}

export const DEFAULT_TOOLS: ToolSettings = {
  tool: "pen",
  penKind: "fountain",
  penColor: "#1f2937",
  penWidth: 2.2,
  highlighterColor: "#facc15",
  highlighterWidth: 16,
  eraserMode: "stroke",
  eraserSize: 10,
};

/** "auto": fingers draw until an Apple Pencil or other pen is seen. */
export type FingerMode = "auto" | "draw" | "scroll";

export interface SelectionState {
  pageId: string;
  count: number;
  /** Screen rectangle (CSS px, relative to the container). */
  box: { left: number; top: number; width: number; height: number };
}

export interface EngineState {
  zoom: number;
  pageIndex: number;
  pageCount: number;
  canUndo: boolean;
  canRedo: boolean;
  selection: SelectionState | null;
  penSeen: boolean;
  hasClipboard: boolean;
}

export interface EngineCallbacks {
  onOps(ops: Op[]): void;
  onState(state: EngineState): void;
  /** Pages near the viewport whose ink is not loaded yet. */
  onNeedInk(pageIds: string[]): void;
}

// ---- Internals ------------------------------------------------------------------

interface EnginePage {
  meta: PageMeta;
  /** null until the page's ink is loaded. */
  strokes: Map<string, Stroke> | null;
}

interface Raster {
  canvas: HTMLCanvasElement;
  scale: number;
  dirty: boolean;
  lastUsed: number;
}

interface PdfRaster {
  canvas: HTMLCanvasElement | null;
  scale: number;
  pending: boolean;
}

/** One undoable action on one page: `before` strokes are replaced by `after`. */
interface HistoryEntry {
  pageId: string;
  before: Stroke[];
  after: Stroke[];
}

interface LiveStroke {
  pointerId: number;
  pointerType: string;
  pageIndex: number;
  kind: StrokeKind;
  color: string;
  width: number;
  points: number[];
  predicted: number[];
  lastPressure: number;
  stillSince: number;
  stillX: number;
  stillY: number;
  snapped: boolean;
  snapTimer: number | null;
}

interface EraseAction {
  pointerId: number;
  pageIndex: number;
  /** Strokes that existed when the action started and were removed or cut. */
  removed: Map<string, Stroke>;
  /** Pieces created by cuts that are still on the page. */
  added: Map<string, Stroke>;
  lastX: number;
  lastY: number;
}

interface Selection {
  pageIndex: number;
  ids: Set<string>;
  bbox: BBox;
}

interface DragAction {
  pointerId: number;
  kind: "move" | "scale";
  startX: number;
  startY: number;
  anchorX: number;
  anchorY: number;
  startDist: number;
  transform: ScaleMove;
}

interface GestureTouch {
  x: number;
  y: number;
  startX: number;
  startY: number;
}

const GAP = 28; // page units between pages
const PAD = 40; // page units around the stack
const MIN_ZOOM = 0.2;
const MAX_ZOOM = 8;
const SNAP_HOLD_MS = 600;
const SNAP_STILL_PX = 4;
const TAP_MS = 280;
const TAP_SLOP_PX = 14;
const HISTORY_LIMIT = 200;
const HANDLE_PX = 22;

/** Clipboard shared by every notebook open in this tab. */
let clipboard: Stroke[] = [];

function isAppleTouchDevice(): boolean {
  return typeof navigator !== "undefined" && /iPad|iPhone|Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1;
}

/** Map a pen's raw pressure so ordinary handwriting sits mid-range. */
function penPressure(raw: number, last: number): number {
  if (!(raw > 0)) return last;
  return Math.min(1, Math.pow(raw, 0.65) * 1.1);
}

type PresenterLike = {
  updateInkTrailStartPoint(event: PointerEvent, style: { color: string; diameter: number }): void;
};

export class InkEngine {
  private readonly container: HTMLElement;
  private readonly bg: HTMLCanvasElement;
  private readonly wet: HTMLCanvasElement;
  private readonly bgCtx: CanvasRenderingContext2D;
  private readonly wetCtx: CanvasRenderingContext2D;
  private readonly cb: EngineCallbacks;
  private readonly resizeObserver: ResizeObserver;
  private readonly cleanup: (() => void)[] = [];

  private pages: EnginePage[] = [];
  private pageTops: number[] = [];
  private worldWidth = 816;
  private worldHeight = 0;

  private deskColor = "#e7e5e4";
  private rect: DOMRect | null = null;
  private viewW = 1;
  private viewH = 1;
  private dpr = 1;
  private cam = { x: 0, y: 0, zoom: 1 };
  private fitted = false;

  private tools: ToolSettings = { ...DEFAULT_TOOLS };
  private fingerMode: FingerMode = "auto";
  private penSeen = false;
  private lastPenUp = 0;
  private spaceHeld = false;

  private rasters = new Map<string, Raster>();
  private pdfRasters = new Map<string, PdfRaster>();
  private rasterBudget: number;
  private maxRasterPixels: number;
  private buildTimer: number | null = null;
  private frame: number | null = null;
  private stateFrame: number | null = null;
  private wetDirty: BBox | null = null; // device px

  private live: LiveStroke | null = null;
  private erase: EraseAction | null = null;
  private lasso: { pointerId: number; pageIndex: number; poly: number[] } | null = null;
  private selection: Selection | null = null;
  private drag: DragAction | null = null;
  private hidden = new Set<string>();
  /** Strokes committed but maybe not yet visible on the page layer (see commitStroke). */
  private settling: { pageIndex: number; stroke: Stroke }[] = [];

  private touches = new Map<number, GestureTouch>();
  private gesture: {
    startZoom: number;
    startCam: { x: number; y: number };
    startDist: number;
    startMid: { x: number; y: number };
    startedAt: number;
    maxTouches: number;
    moved: boolean;
  } | null = null;
  private panPointer: { id: number; x: number; y: number } | null = null;
  private velocity = { x: 0, y: 0, t: 0 };
  private momentum: number | null = null;

  private undoStack: HistoryEntry[] = [];
  private redoStack: HistoryEntry[] = [];

  private presenter: PresenterLike | null = null;
  private readonly useRawUpdate: boolean;
  private destroyed = false;

  constructor(container: HTMLElement, callbacks: EngineCallbacks) {
    this.container = container;
    this.cb = callbacks;
    const apple = isAppleTouchDevice();
    // iOS caps total canvas memory; stay well under it there.
    this.rasterBudget = apple ? 28_000_000 : 64_000_000;
    this.maxRasterPixels = apple ? 7_000_000 : 12_000_000;

    this.bg = document.createElement("canvas");
    this.wet = document.createElement("canvas");
    for (const c of [this.bg, this.wet]) {
      Object.assign(c.style, { position: "absolute", inset: "0", width: "100%", height: "100%", display: "block" });
      container.appendChild(c);
    }
    this.wet.style.touchAction = "none";
    this.bgCtx = this.bg.getContext("2d", { alpha: false }) as CanvasRenderingContext2D;
    this.wetCtx = (this.wet.getContext("2d", { desynchronized: true }) ??
      this.wet.getContext("2d")) as CanvasRenderingContext2D;

    this.useRawUpdate = typeof window !== "undefined" && "onpointerrawupdate" in window;
    this.bindInput();

    const ink = (navigator as unknown as { ink?: { requestPresenter(o: { presentationArea: Element }): Promise<PresenterLike> } }).ink;
    ink?.requestPresenter({ presentationArea: this.wet }).then(
      (p) => {
        if (!this.destroyed) this.presenter = p;
      },
      () => {},
    );

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
  }

  // ---- Lifecycle ----------------------------------------------------------------

  destroy() {
    this.destroyed = true;
    this.resizeObserver.disconnect();
    for (const fn of this.cleanup) fn();
    if (this.frame != null) cancelAnimationFrame(this.frame);
    if (this.stateFrame != null) cancelAnimationFrame(this.stateFrame);
    if (this.momentum != null) cancelAnimationFrame(this.momentum);
    if (this.buildTimer != null) clearTimeout(this.buildTimer);
    if (this.live?.snapTimer != null) clearTimeout(this.live.snapTimer);
    for (const r of this.rasters.values()) this.freeCanvas(r.canvas);
    for (const r of this.pdfRasters.values()) if (r.canvas) this.freeCanvas(r.canvas);
    this.rasters.clear();
    this.pdfRasters.clear();
    this.bg.remove();
    this.wet.remove();
  }

  private freeCanvas(c: HTMLCanvasElement) {
    // Safari releases a canvas's backing store only when it is resized to 0.
    c.width = 0;
    c.height = 0;
  }

  private resize() {
    const rect = this.container.getBoundingClientRect();
    this.rect = null;
    this.deskColor = readDeskColor(this.container);
    this.viewW = Math.max(1, rect.width);
    this.viewH = Math.max(1, rect.height);
    this.dpr = Math.min(3, window.devicePixelRatio || 1);
    for (const c of [this.bg, this.wet]) {
      c.width = Math.round(this.viewW * this.dpr);
      c.height = Math.round(this.viewH * this.dpr);
    }
    this.wetDirty = null;
    if (!this.fitted && this.pages.length) this.fitWidth();
    this.clampCamera();
    this.renderNow();
    this.redrawWet();
  }

  // ---- Document -----------------------------------------------------------------

  /** Replace the page list (structure); loaded ink of pages that remain is kept. */
  setPages(metas: PageMeta[]) {
    const old = new Map(this.pages.map((p) => [p.meta.id, p]));
    const anchorId = this.pages[this.currentPageIndex()]?.meta.id;
    const anchorOffset = anchorId ? this.cam.y - this.pageTops[this.currentPageIndex()] : 0;
    this.pages = [...metas]
      .sort((a, b) => a.position - b.position)
      .map((meta) => {
        const prev = old.get(meta.id);
        if (prev && (prev.meta.template.kind !== meta.template.kind || prev.meta.template.paper !== meta.template.paper)) {
          this.markDirty(meta.id);
        }
        return { meta, strokes: prev?.strokes ?? null };
      });
    for (const id of old.keys()) {
      if (!this.pages.some((p) => p.meta.id === id)) this.dropRaster(id);
    }
    if (this.selection && !this.pages[this.selection.pageIndex]) this.selection = null;
    this.layout();
    if (!this.fitted && this.pages.length) this.fitWidth();
    else if (anchorId) {
      const i = this.pages.findIndex((p) => p.meta.id === anchorId);
      if (i >= 0) this.cam.y = this.pageTops[i] + anchorOffset;
    }
    this.clampCamera();
    this.invalidate();
    this.emitState();
  }

  /** Install a page's ink (initial load or a newer server copy). */
  setPageInk(pageId: string, strokes: Stroke[]) {
    const page = this.pages.find((p) => p.meta.id === pageId);
    if (!page) return;
    page.strokes = new Map(strokes.map((s) => [s.id, s]));
    if (this.selection && this.pages[this.selection.pageIndex] === page) {
      for (const id of [...this.selection.ids]) if (!page.strokes.has(id)) this.selection.ids.delete(id);
      if (!this.selection.ids.size) this.selection = null;
    }
    this.markDirty(pageId);
    this.invalidate();
  }

  getPageStrokes(pageId: string): Stroke[] | null {
    const page = this.pages.find((p) => p.meta.id === pageId);
    return page?.strokes ? [...page.strokes.values()] : null;
  }

  getPages(): PageMeta[] {
    return this.pages.map((p) => p.meta);
  }

  private layout() {
    let y = 0;
    this.worldWidth = Math.max(100, ...this.pages.map((p) => p.meta.width));
    this.pageTops = this.pages.map((p) => {
      const top = y;
      y += p.meta.height + GAP;
      return top;
    });
    this.worldHeight = Math.max(0, y - GAP);
  }

  private pageX(i: number): number {
    return (this.worldWidth - this.pages[i].meta.width) / 2;
  }

  // ---- Camera -------------------------------------------------------------------

  private clampCamera() {
    const { zoom } = this.cam;
    const visW = this.viewW / zoom;
    const visH = this.viewH / zoom;
    if (this.worldWidth + PAD * 2 <= visW) this.cam.x = (this.worldWidth - visW) / 2;
    else this.cam.x = Math.min(Math.max(this.cam.x, -PAD), this.worldWidth + PAD - visW);
    const maxY = this.worldHeight + PAD - visH;
    this.cam.y = maxY < -PAD ? -PAD : Math.min(Math.max(this.cam.y, -PAD), maxY);
  }

  fitWidth() {
    if (!this.pages.length) return;
    const i = this.currentPageIndex();
    const w = this.pages[i]?.meta.width ?? this.worldWidth;
    const zoom = Math.min(2.5, Math.max(MIN_ZOOM, (this.viewW - 24) / w));
    const top = this.pageTops[i] ?? 0;
    this.cam.zoom = zoom;
    this.cam.y = this.fitted ? top - 12 / zoom : -PAD / 2;
    this.fitted = true;
    this.clampCamera();
    this.invalidate();
    this.emitState();
  }

  /** Zoom to `zoom` keeping the screen point (x, y) (default: centre) in place. */
  zoomTo(zoom: number, x = this.viewW / 2, y = this.viewH / 2) {
    const z = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
    const wx = this.cam.x + x / this.cam.zoom;
    const wy = this.cam.y + y / this.cam.zoom;
    this.cam.zoom = z;
    this.cam.x = wx - x / z;
    this.cam.y = wy - y / z;
    this.clampCamera();
    this.invalidate();
    this.emitState();
  }

  zoomBy(factor: number) {
    this.zoomTo(this.cam.zoom * factor);
  }

  scrollToPage(index: number, smooth = false) {
    const i = Math.max(0, Math.min(this.pages.length - 1, index));
    const target = this.pageTops[i] - 12 / this.cam.zoom;
    if (!smooth) {
      this.cam.y = target;
      this.clampCamera();
      this.invalidate();
      this.emitState();
      return;
    }
    const from = this.cam.y;
    const start = performance.now();
    const step = (t: number) => {
      const k = Math.min(1, (t - start) / 260);
      const e = 1 - Math.pow(1 - k, 3);
      this.cam.y = from + (target - from) * e;
      this.clampCamera();
      this.renderNow();
      this.emitState();
      if (k < 1 && !this.destroyed) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  scrollToPageId(pageId: string) {
    const i = this.pages.findIndex((p) => p.meta.id === pageId);
    if (i >= 0) this.scrollToPage(i);
  }

  scrollBy(dx: number, dy: number) {
    this.cam.x += dx / this.cam.zoom;
    this.cam.y += dy / this.cam.zoom;
    this.clampCamera();
    this.invalidate();
    this.emitState();
  }

  currentPageIndex(): number {
    if (!this.pages.length) return 0;
    const mid = this.cam.y + this.viewH / this.cam.zoom / 2;
    for (let i = 0; i < this.pages.length; i++) {
      if (mid < this.pageTops[i] + this.pages[i].meta.height + GAP / 2) return i;
    }
    return this.pages.length - 1;
  }

  private visiblePages(margin = 0): number[] {
    const top = this.cam.y - margin;
    const bottom = this.cam.y + this.viewH / this.cam.zoom + margin;
    const out: number[] = [];
    for (let i = 0; i < this.pages.length; i++) {
      const t = this.pageTops[i];
      if (t > bottom) break;
      if (t + this.pages[i].meta.height >= top) out.push(i);
    }
    return out;
  }

  /** Screen (container CSS px) to page units of page i. */
  private toPage(i: number, sx: number, sy: number): { x: number; y: number } {
    return {
      x: this.cam.x + sx / this.cam.zoom - this.pageX(i),
      y: this.cam.y + sy / this.cam.zoom - this.pageTops[i],
    };
  }

  private pageAt(sx: number, sy: number): number {
    const wx = this.cam.x + sx / this.cam.zoom;
    const wy = this.cam.y + sy / this.cam.zoom;
    for (let i = 0; i < this.pages.length; i++) {
      const t = this.pageTops[i];
      const x = this.pageX(i);
      const m = this.pages[i].meta;
      if (wy >= t && wy <= t + m.height && wx >= x && wx <= x + m.width) return i;
    }
    return -1;
  }

  /** Device-pixel transform for page i: page units -> wet/bg canvas pixels. */
  private pageTransform(i: number): [number, number, number, number, number, number] {
    const s = this.cam.zoom * this.dpr;
    return [s, 0, 0, s, (this.pageX(i) - this.cam.x) * s, (this.pageTops[i] - this.cam.y) * s];
  }

  // ---- Tools --------------------------------------------------------------------

  setTools(tools: ToolSettings) {
    const toolChanged = tools.tool !== this.tools.tool;
    this.tools = { ...tools };
    if (toolChanged && tools.tool !== "lasso") this.clearSelection();
    this.redrawWet();
  }

  setFingerMode(mode: FingerMode) {
    this.fingerMode = mode;
  }

  private fingersDraw(): boolean {
    if (this.fingerMode === "draw") return true;
    if (this.fingerMode === "scroll") return false;
    return !this.penSeen;
  }

  // ---- Rendering ------------------------------------------------------------------

  /** Schedule a page-layer repaint on the next frame. */
  invalidate() {
    if (this.frame != null || this.destroyed) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = null;
      this.renderNow();
    });
  }

  private markDirty(pageId: string) {
    const r = this.rasters.get(pageId);
    if (r) r.dirty = true;
  }

  private dropRaster(pageId: string) {
    const r = this.rasters.get(pageId);
    if (r) this.freeCanvas(r.canvas);
    this.rasters.delete(pageId);
    const p = this.pdfRasters.get(pageId);
    if (p?.canvas) this.freeCanvas(p.canvas);
    this.pdfRasters.delete(pageId);
  }

  private get interacting(): boolean {
    return this.gesture != null || this.momentum != null || this.panPointer != null;
  }

  private neededScale(): number {
    return this.cam.zoom * this.dpr;
  }

  private rasterScaleFor(page: EnginePage): number {
    const needed = Math.ceil(this.neededScale() * 4) / 4;
    const maxScale = Math.sqrt(this.maxRasterPixels / (page.meta.width * page.meta.height));
    return Math.max(0.25, Math.min(needed, Math.floor(maxScale * 4) / 4));
  }

  private renderNow() {
    if (this.destroyed) return;
    const ctx = this.bgCtx;
    const dpr = this.dpr;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = this.deskColor;
    ctx.fillRect(0, 0, this.bg.width, this.bg.height);
    const visible = this.visiblePages();
    const needed = this.neededScale();
    const now = performance.now();
    const missingInk: string[] = [];

    for (const i of visible) {
      const page = this.pages[i];
      const m = page.meta;
      const [s, , , , tx, ty] = this.pageTransform(i);
      const w = m.width * s;
      const h = m.height * s;
      // Soft drop shadow (cheap: two offset fills).
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = "rgba(0,0,0,0.06)";
      ctx.fillRect(tx - 1 * dpr, ty + 1 * dpr, w + 2 * dpr, h + 2 * dpr);
      ctx.fillStyle = "rgba(0,0,0,0.05)";
      ctx.fillRect(tx, ty + 3 * dpr, w, h + 1 * dpr);

      if (!page.strokes) missingInk.push(m.id);
      this.ensurePdf(i);

      const raster = this.rasters.get(m.id);
      // A raster is used when it is sharp enough, or while the view moves
      // (a slightly soft page beats a dropped frame). At rest a page zoomed
      // past what its raster can hold is drawn from vectors instead.
      const usable = raster && !raster.dirty && (raster.scale >= needed * 0.98 || this.interacting);
      if (raster && usable) {
        raster.lastUsed = now;
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = this.interacting ? "low" : "high";
        ctx.drawImage(raster.canvas, tx, ty, w, h);
      } else {
        this.drawPageVector(ctx, i);
        if (page.strokes) this.scheduleBuild();
      }
    }
    for (const i of this.visiblePages(1500)) {
      if (!this.pages[i].strokes && !missingInk.includes(this.pages[i].meta.id)) missingInk.push(this.pages[i].meta.id);
    }
    if (missingInk.length) this.cb.onNeedInk(missingInk);
    this.evictRasters(visible);
  }

  /** Draw page i straight from vectors, clipped to the viewport. */
  private drawPageVector(ctx: CanvasRenderingContext2D, i: number) {
    const page = this.pages[i];
    const m = page.meta;
    const t = this.pageTransform(i);
    const s = t[0];
    ctx.save();
    ctx.setTransform(...t);
    ctx.beginPath();
    ctx.rect(0, 0, m.width, m.height);
    ctx.clip();
    const clip: BBox = {
      minX: -t[4] / s,
      minY: -t[5] / s,
      maxX: (this.bg.width - t[4]) / s,
      maxY: (this.bg.height - t[5]) / s,
    };
    drawPaper(ctx, m.template, m.width, m.height, s, clip);
    const pdf = this.pdfRasters.get(m.id);
    if (pdf?.canvas) ctx.drawImage(pdf.canvas, 0, 0, m.width, m.height);
    if (page.strokes) drawStrokes(ctx, page.strokes.values(), m.template.paper, clip, this.hidden);
    ctx.restore();
  }

  private scheduleBuild() {
    if (this.buildTimer != null || this.destroyed) return;
    this.buildTimer = window.setTimeout(() => {
      this.buildTimer = null;
      if (this.live || this.erase || this.drag || this.interacting) {
        this.scheduleBuild();
        return;
      }
      if (this.buildOneRaster()) {
        this.invalidate();
        this.scheduleBuild();
      }
    }, 30);
  }

  /** Build or refresh the raster of one visible page. Returns true if it did work. */
  private buildOneRaster(): boolean {
    const needed = this.neededScale();
    const order = this.visiblePages();
    const cur = this.currentPageIndex();
    order.sort((a, b) => Math.abs(a - cur) - Math.abs(b - cur));
    for (const i of order) {
      const page = this.pages[i];
      if (!page.strokes) continue;
      const scale = this.rasterScaleFor(page);
      const r = this.rasters.get(page.meta.id);
      if (r && !r.dirty && (r.scale >= needed * 0.98 || r.scale >= scale)) continue;
      this.buildRaster(i, scale);
      return true;
    }
    return false;
  }

  private buildRaster(i: number, scale: number) {
    const page = this.pages[i];
    const m = page.meta;
    let r = this.rasters.get(m.id);
    const w = Math.max(1, Math.ceil(m.width * scale));
    const h = Math.max(1, Math.ceil(m.height * scale));
    if (!r) {
      r = { canvas: document.createElement("canvas"), scale, dirty: false, lastUsed: performance.now() };
      this.rasters.set(m.id, r);
    }
    if (r.canvas.width !== w || r.canvas.height !== h) {
      r.canvas.width = w;
      r.canvas.height = h;
    }
    const ctx = r.canvas.getContext("2d", { alpha: false }) as CanvasRenderingContext2D;
    ctx.setTransform(w / m.width, 0, 0, h / m.height, 0, 0);
    drawPaper(ctx, m.template, m.width, m.height, scale);
    const pdf = this.pdfRasters.get(m.id);
    if (pdf?.canvas) ctx.drawImage(pdf.canvas, 0, 0, m.width, m.height);
    if (page.strokes) drawStrokes(ctx, page.strokes.values(), m.template.paper, undefined, this.hidden);
    r.scale = scale;
    r.dirty = false;
    r.lastUsed = performance.now();
  }

  private evictRasters(visible: number[]) {
    const keep = new Set(visible.map((i) => this.pages[i].meta.id));
    let total = 0;
    for (const r of this.rasters.values()) total += r.canvas.width * r.canvas.height;
    if (total <= this.rasterBudget) return;
    const victims = [...this.rasters.entries()]
      .filter(([id]) => !keep.has(id))
      .sort((a, b) => a[1].lastUsed - b[1].lastUsed);
    for (const [id, r] of victims) {
      if (total <= this.rasterBudget * 0.8) break;
      total -= r.canvas.width * r.canvas.height;
      this.freeCanvas(r.canvas);
      this.rasters.delete(id);
    }
  }

  private ensurePdf(i: number) {
    const m = this.pages[i].meta;
    if (!m.pdf) return;
    const maxScale = Math.sqrt(this.maxRasterPixels / (m.width * m.height));
    const want = Math.min(Math.ceil(this.neededScale() * 2) / 2, Math.floor(maxScale * 2) / 2);
    const cur = this.pdfRasters.get(m.id);
    if (cur && (cur.pending || cur.scale >= want)) return;
    if (this.interacting && cur?.canvas) return;
    const entry: PdfRaster = { canvas: cur?.canvas ?? null, scale: cur?.scale ?? 0, pending: true };
    this.pdfRasters.set(m.id, entry);
    renderPdfPage(m.pdf.fileId, m.pdf.page, m.width, want).then(
      (canvas) => {
        if (this.destroyed || this.pdfRasters.get(m.id) !== entry) return this.freeCanvas(canvas);
        if (entry.canvas) this.freeCanvas(entry.canvas);
        entry.canvas = canvas;
        entry.scale = want;
        entry.pending = false;
        this.markDirty(m.id);
        this.invalidate();
      },
      () => {
        entry.pending = false;
        entry.scale = want; // do not retry in a loop; a reload retries
      },
    );
  }

  // ---- Wet layer ------------------------------------------------------------------

  private clearWet() {
    const ctx = this.wetCtx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (this.wetDirty && !isEmptyBBox(this.wetDirty)) {
      const d = this.wetDirty;
      ctx.clearRect(d.minX - 2, d.minY - 2, d.maxX - d.minX + 4, d.maxY - d.minY + 4);
    } else if (this.wetDirty === null) {
      ctx.clearRect(0, 0, this.wet.width, this.wet.height);
    }
    this.wetDirty = emptyBBox();
  }

  /** Grow the wet dirty rectangle by a page-unit box on page i. */
  private touchWet(i: number, b: BBox) {
    const t = this.pageTransform(i);
    const d = transformBBox(b, { sx: t[0], sy: t[3], tx: t[4], ty: t[5] });
    this.wetDirty = this.wetDirty ? unionBBox(this.wetDirty, d) : d;
  }

  /** Repaint the wet layer: settling strokes, the live stroke, the lasso, the dragged selection. */
  private redrawWet() {
    this.clearWet();
    const ctx = this.wetCtx;
    for (const { pageIndex, stroke } of this.settling) {
      if (!this.pages[pageIndex]) continue;
      ctx.setTransform(...this.pageTransform(pageIndex));
      drawStroke(ctx, stroke, this.pages[pageIndex].meta.template.paper);
      this.touchWet(pageIndex, strokeBBox(stroke));
    }
    const live = this.live;
    if (live && this.pages[live.pageIndex]) {
      ctx.setTransform(...this.pageTransform(live.pageIndex));
      drawLiveStroke(
        ctx,
        live.kind,
        live.color,
        live.width,
        live.points,
        this.pages[live.pageIndex].meta.template.paper,
        live.predicted.length ? live.predicted : undefined,
      );
      const b = pointsBBox(live.points, live.width * 1.2);
      if (live.predicted.length) {
        const pb = pointsBBox(live.predicted, live.width * 1.2);
        this.touchWet(live.pageIndex, unionBBox(b, pb));
      } else this.touchWet(live.pageIndex, b);
    }
    if (this.lasso && this.pages[this.lasso.pageIndex]) {
      const { poly, pageIndex } = this.lasso;
      const t = this.pageTransform(pageIndex);
      ctx.setTransform(...t);
      ctx.save();
      ctx.lineWidth = 1.5 / t[0];
      ctx.setLineDash([6 / t[0], 5 / t[0]]);
      ctx.strokeStyle = "#2563eb";
      ctx.fillStyle = "rgba(37,99,235,0.06)";
      ctx.beginPath();
      for (let k = 0; k < poly.length; k += 2) (k ? ctx.lineTo : ctx.moveTo).call(ctx, poly[k], poly[k + 1]);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
      const xs: number[] = [];
      for (let k = 0; k < poly.length; k += 2) xs.push(poly[k], poly[k + 1], 0);
      this.touchWet(pageIndex, pointsBBox(xs, 4 / t[0]));
    }
    if (this.drag && this.selection) {
      const sel = this.selection;
      const page = this.pages[sel.pageIndex];
      if (page?.strokes) {
        ctx.setTransform(...this.pageTransform(sel.pageIndex));
        for (const id of sel.ids) {
          const s = page.strokes.get(id);
          if (!s) continue;
          const moved = transformStroke(s, this.drag.transform);
          drawStroke(ctx, moved, page.meta.template.paper);
        }
        this.touchWet(sel.pageIndex, transformBBox(sel.bbox, this.drag.transform));
      }
    }
  }

  // ---- Input --------------------------------------------------------------------

  private bindInput() {
    const el = this.wet;
    const on = <K extends keyof HTMLElementEventMap>(
      target: HTMLElement | Window,
      type: K | string,
      fn: (e: never) => void,
      opts?: AddEventListenerOptions,
    ) => {
      target.addEventListener(type, fn as EventListener, opts);
      this.cleanup.push(() => target.removeEventListener(type, fn as EventListener, opts));
    };
    on(el, "pointerdown", (e: PointerEvent) => this.onDown(e), { passive: false });
    on(el, "pointermove", (e: PointerEvent) => this.onMove(e, false), { passive: false });
    if (this.useRawUpdate) on(el, "pointerrawupdate", (e: PointerEvent) => this.onMove(e, true));
    on(el, "pointerup", (e: PointerEvent) => this.onUp(e, false));
    on(el, "pointercancel", (e: PointerEvent) => this.onUp(e, true));
    on(el, "lostpointercapture", (e: PointerEvent) => {
      if (this.live?.pointerId === e.pointerId || this.erase?.pointerId === e.pointerId) this.onUp(e, false);
    });
    on(el, "wheel", (e: WheelEvent) => this.onWheel(e), { passive: false });
    on(el, "contextmenu", (e: Event) => e.preventDefault());
    on(el, "selectstart", (e: Event) => e.preventDefault());
    // Safari's own pinch-zoom gesture events: the engine zooms itself.
    on(el, "gesturestart", (e: Event) => e.preventDefault());
    on(el, "gesturechange", (e: Event) => e.preventDefault());
    on(el, "touchstart", (e: TouchEvent) => {
      if (e.touches.length > 1) e.preventDefault();
    }, { passive: false });
    on(window, "keydown", (e: KeyboardEvent) => {
      if (e.code === "Space" && !(e.target instanceof HTMLInputElement) && !(e.target instanceof HTMLTextAreaElement)) this.spaceHeld = true;
    });
    on(window, "keyup", (e: KeyboardEvent) => {
      if (e.code === "Space") this.spaceHeld = false;
    });
  }

  /** Re-read the desk colour (after a theme change). */
  refreshTheme() {
    this.deskColor = readDeskColor(this.container);
    this.invalidate();
  }

  /** Capture a pointer; a pointer that already ended throws, which is harmless here. */
  private capture(pointerId: number) {
    try {
      this.wet.setPointerCapture(pointerId);
    } catch {}
  }

  private local(e: PointerEvent): { x: number; y: number } {
    // Cached per press: reading layout for every 240 Hz sample is wasted work.
    const r = (this.rect ??= this.wet.getBoundingClientRect());
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  private onDown(e: PointerEvent) {
    if (this.destroyed) return;
    e.preventDefault();
    this.stopMomentum();
    this.rect = this.wet.getBoundingClientRect();
    const { x, y } = this.local(e);
    const type = e.pointerType;

    if (type === "pen") {
      if (!this.penSeen) {
        this.penSeen = true;
        this.emitState();
      }
      // The pen wins over a resting palm or a scroll in progress.
      if (this.gesture) this.endGesture(false);
      if (this.live?.pointerType === "touch") this.cancelLive();
    }

    if (type === "touch") {
      const penBusy = this.live?.pointerType === "pen" || this.erase != null || this.drag != null;
      if (penBusy) return; // palm while writing
      // A second finger right after a finger stroke began: it was a pinch.
      if (this.live && this.live.pointerType === "touch") {
        if (this.live.points.length < 30) this.cancelLive();
        else return;
      }
      if (!this.gesture && this.fingersDraw() && this.touches.size === 0 && performance.now() - this.lastPenUp > 300) {
        this.startTool(e, x, y);
        if (this.live || this.erase || this.lasso || this.drag) {
          this.touches.set(e.pointerId, { x, y, startX: x, startY: y });
          return;
        }
      }
      this.touches.set(e.pointerId, { x, y, startX: x, startY: y });
      this.capture(e.pointerId);
      this.beginGesture();
      return;
    }

    if (type === "mouse" && (e.button === 1 || e.button === 2 || this.spaceHeld)) {
      this.panPointer = { id: e.pointerId, x, y };
      this.capture(e.pointerId);
      return;
    }
    if (type === "mouse" && e.button !== 0) return;
    this.startTool(e, x, y);
  }

  private startTool(e: PointerEvent, x: number, y: number) {
    // The eraser end of a pen (Surface Pen, Wacom) erases whatever tool is on.
    const eraserEnd = e.pointerType === "pen" && (e.button === 5 || (e.buttons & 32) !== 0);
    const tool: Tool = eraserEnd ? "eraser" : this.tools.tool;

    if (this.selection && tool === "lasso") {
      const hit = this.hitSelection(x, y);
      if (hit) {
        this.beginDrag(e, x, y, hit);
        return;
      }
    }
    if (this.selection) this.clearSelection();

    const pageIndex = this.pageAt(x, y);
    if (pageIndex < 0) {
      // Off the paper: a mouse drag there scrolls.
      if (e.pointerType === "mouse") {
        this.panPointer = { id: e.pointerId, x, y };
        this.capture(e.pointerId);
      }
      return;
    }
    const page = this.pages[pageIndex];
    if (!page.strokes) return; // still loading
    this.capture(e.pointerId);
    const p = this.toPage(pageIndex, x, y);

    if (tool === "pen" || tool === "highlighter") {
      const hl = tool === "highlighter";
      const pressure = e.pointerType === "pen" ? penPressure(e.pressure, 0.5) : 0.5;
      this.live = {
        pointerId: e.pointerId,
        pointerType: e.pointerType,
        pageIndex,
        kind: hl ? "highlighter" : this.tools.penKind,
        color: hl ? this.tools.highlighterColor : this.tools.penColor,
        width: hl ? this.tools.highlighterWidth : this.tools.penWidth,
        points: [p.x, p.y, pressure],
        predicted: [],
        lastPressure: pressure,
        stillSince: performance.now(),
        stillX: x,
        stillY: y,
        snapped: false,
        snapTimer: null,
      };
      this.armSnap();
      this.redrawWet();
      return;
    }
    if (tool === "eraser") {
      this.erase = { pointerId: e.pointerId, pageIndex, removed: new Map(), added: new Map(), lastX: p.x, lastY: p.y };
      this.eraseAt(p.x, p.y);
      return;
    }
    if (tool === "lasso") {
      this.lasso = { pointerId: e.pointerId, pageIndex, poly: [p.x, p.y] };
      this.redrawWet();
    }
  }

  private onMove(e: PointerEvent, raw: boolean) {
    if (this.destroyed) return;
    const isDrawPointer = this.live?.pointerId === e.pointerId;
    // With pointerrawupdate available, the stroke follows raw updates only.
    if (isDrawPointer && this.useRawUpdate && !raw) return;
    if (!isDrawPointer && raw) return;

    if (this.live && isDrawPointer) {
      this.extendLive(e);
      return;
    }
    const { x, y } = this.local(e);
    if (this.erase?.pointerId === e.pointerId) {
      const events = e.getCoalescedEvents?.() ?? [e];
      for (const ev of events.length ? events : [e]) {
        const l = this.local(ev);
        const p = this.toPage(this.erase.pageIndex, l.x, l.y);
        this.eraseAt(p.x, p.y);
      }
      return;
    }
    if (this.lasso?.pointerId === e.pointerId) {
      const p = this.toPage(this.lasso.pageIndex, x, y);
      const poly = this.lasso.poly;
      const lx = poly[poly.length - 2];
      const ly = poly[poly.length - 1];
      if (Math.hypot(p.x - lx, p.y - ly) * this.cam.zoom > 2) {
        poly.push(p.x, p.y);
        this.redrawWet();
      }
      return;
    }
    if (this.drag?.pointerId === e.pointerId) {
      this.updateDrag(x, y);
      return;
    }
    if (this.panPointer?.id === e.pointerId) {
      const dx = x - this.panPointer.x;
      const dy = y - this.panPointer.y;
      this.panPointer.x = x;
      this.panPointer.y = y;
      this.panBy(dx, dy);
      return;
    }
    const t = this.touches.get(e.pointerId);
    if (t) {
      t.x = x;
      t.y = y;
      this.updateGesture();
    }
  }

  private extendLive(e: PointerEvent) {
    const live = this.live!;
    if (live.snapped) return;
    const events = e.getCoalescedEvents?.() ?? [];
    const list = events.length ? events : [e];
    const pts = live.points;
    let lastLocal = { x: 0, y: 0 };
    for (const ev of list) {
      const l = this.local(ev);
      lastLocal = l;
      const p = this.toPage(live.pageIndex, l.x, l.y);
      const pressure = live.pointerType === "pen" ? penPressure(ev.pressure, live.lastPressure) : 0.5;
      live.lastPressure = pressure;
      const n = pts.length;
      // Skip exact repeats (some pens report the same sample twice).
      if (pts[n - 3] === p.x && pts[n - 2] === p.y) continue;
      pts.push(p.x, p.y, pressure);
    }
    // Hold-to-snap: restart the timer whenever the pen moves.
    if (Math.hypot(lastLocal.x - live.stillX, lastLocal.y - live.stillY) > SNAP_STILL_PX) {
      live.stillX = lastLocal.x;
      live.stillY = lastLocal.y;
      live.stillSince = performance.now();
      this.armSnap();
    }
    live.predicted = this.predict(e, live);
    this.redrawWet();
    if (this.presenter && live.kind !== "highlighter") {
      try {
        this.presenter.updateInkTrailStartPoint(e, {
          color: live.color,
          diameter: Math.max(1, live.width * this.cam.zoom * (0.4 + live.lastPressure * 0.6)),
        });
      } catch {
        this.presenter = null;
      }
    }
  }

  /** Samples ahead of the pen: the browser's prediction, or a short extrapolation. */
  private predict(e: PointerEvent, live: LiveStroke): number[] {
    const out: number[] = [];
    const predicted = e.getPredictedEvents?.() ?? [];
    if (predicted.length) {
      for (const ev of predicted.slice(0, 3)) {
        const l = this.local(ev);
        const p = this.toPage(live.pageIndex, l.x, l.y);
        out.push(p.x, p.y, live.lastPressure);
      }
      return out;
    }
    const pts = live.points;
    const n = pts.length / 3;
    if (n < 4) return out;
    // Velocity over the last few samples (240 Hz pencil ~ 4 ms apart).
    const k = Math.min(4, n - 1);
    const dx = (pts[(n - 1) * 3] - pts[(n - 1 - k) * 3]) / k;
    const dy = (pts[(n - 1) * 3 + 1] - pts[(n - 1 - k) * 3 + 1]) / k;
    // Look ~3 samples ahead, capped at 10 screen px so a sudden turn barely overshoots.
    let ax = dx * 3;
    let ay = dy * 3;
    const len = Math.hypot(ax, ay) * this.cam.zoom;
    if (len > 10) {
      ax *= 10 / len;
      ay *= 10 / len;
    }
    if (len < 0.5) return out;
    out.push(pts[(n - 1) * 3] + ax, pts[(n - 1) * 3 + 1] + ay, live.lastPressure);
    return out;
  }

  private armSnap() {
    const live = this.live;
    if (!live) return;
    if (live.snapTimer != null) clearTimeout(live.snapTimer);
    live.snapTimer = window.setTimeout(() => {
      if (this.live !== live || live.snapped) return;
      const shape = recognizeShape(live.points);
      if (!shape) return;
      live.points = shape.points;
      live.predicted = [];
      live.snapped = true;
      this.redrawWet();
    }, SNAP_HOLD_MS);
  }

  private onUp(e: PointerEvent, cancelled: boolean) {
    if (this.live?.pointerId === e.pointerId) {
      if (cancelled && this.live.pointerType === "touch") this.cancelLive();
      else this.commitLive();
      if (e.pointerType === "pen") this.lastPenUp = performance.now();
      this.touches.delete(e.pointerId);
      return;
    }
    if (this.erase?.pointerId === e.pointerId) {
      this.finishErase();
      if (e.pointerType === "pen") this.lastPenUp = performance.now();
      this.touches.delete(e.pointerId);
      return;
    }
    if (this.lasso?.pointerId === e.pointerId) {
      this.finishLasso();
      this.touches.delete(e.pointerId);
      return;
    }
    if (this.drag?.pointerId === e.pointerId) {
      this.finishDrag(cancelled);
      this.touches.delete(e.pointerId);
      return;
    }
    if (this.panPointer?.id === e.pointerId) {
      this.panPointer = null;
      this.invalidate();
      return;
    }
    if (this.touches.has(e.pointerId)) {
      const t = this.touches.get(e.pointerId)!;
      t.x = this.local(e).x;
      t.y = this.local(e).y;
      if (this.touches.size === 1 && this.gesture) this.endGesture(!cancelled);
      this.touches.delete(e.pointerId);
      if (this.touches.size >= 1 && this.gesture) this.beginGesture(true);
    }
  }

  private onWheel(e: WheelEvent) {
    e.preventDefault();
    this.stopMomentum();
    this.rect = this.wet.getBoundingClientRect();
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? this.viewH : 1;
    const { x, y } = this.local(e as unknown as PointerEvent);
    if (e.ctrlKey || e.metaKey) {
      // Trackpad pinch arrives as ctrl+wheel.
      this.zoomTo(this.cam.zoom * Math.exp((-e.deltaY * unit) / 300), x, y);
      return;
    }
    const dx = e.shiftKey && !e.deltaX ? e.deltaY : e.deltaX;
    const dy = e.shiftKey && !e.deltaX ? 0 : e.deltaY;
    this.scrollBy(dx * unit, dy * unit);
  }

  // ---- Gestures (touch scroll, pinch zoom, tap shortcuts) ---------------------------

  private beginGesture(rebase = false) {
    const pts = [...this.touches.values()];
    if (!pts.length) return;
    const mid = { x: pts.reduce((a, p) => a + p.x, 0) / pts.length, y: pts.reduce((a, p) => a + p.y, 0) / pts.length };
    const dist = pts.length > 1 ? Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) : 0;
    const prev = this.gesture;
    this.gesture = {
      startZoom: this.cam.zoom,
      startCam: { x: this.cam.x, y: this.cam.y },
      startDist: dist,
      startMid: mid,
      startedAt: rebase && prev ? prev.startedAt : performance.now(),
      maxTouches: Math.max(prev && rebase ? prev.maxTouches : 0, pts.length),
      moved: rebase && prev ? prev.moved : false,
    };
    if (!rebase) {
      // A new finger joining a gesture keeps the tap count.
      if (prev) this.gesture.maxTouches = Math.max(prev.maxTouches, pts.length);
    }
    this.velocity = { x: 0, y: 0, t: performance.now() };
  }

  private updateGesture() {
    const g = this.gesture;
    if (!g) return;
    const pts = [...this.touches.values()];
    if (pts.length > g.maxTouches) g.maxTouches = pts.length;
    for (const p of pts) if (Math.hypot(p.x - p.startX, p.y - p.startY) > TAP_SLOP_PX) g.moved = true;
    const mid = { x: pts.reduce((a, p) => a + p.x, 0) / pts.length, y: pts.reduce((a, p) => a + p.y, 0) / pts.length };
    let zoom = g.startZoom;
    if (pts.length > 1 && g.startDist > 0) {
      const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, g.startZoom * (dist / g.startDist)));
    }
    // Keep the world point under the starting midpoint under the fingers.
    const wx = g.startCam.x + g.startMid.x / g.startZoom;
    const wy = g.startCam.y + g.startMid.y / g.startZoom;
    const prevX = this.cam.x;
    const prevY = this.cam.y;
    this.cam.zoom = zoom;
    this.cam.x = wx - mid.x / zoom;
    this.cam.y = wy - mid.y / zoom;
    this.clampCamera();
    const now = performance.now();
    const dt = Math.max(1, now - this.velocity.t);
    // Smoothed velocity in screen px per ms (for momentum after a flick).
    this.velocity = {
      x: this.velocity.x * 0.6 + (((this.cam.x - prevX) * zoom) / dt) * 0.4,
      y: this.velocity.y * 0.6 + (((this.cam.y - prevY) * zoom) / dt) * 0.4,
      t: now,
    };
    this.invalidate();
    this.emitState();
  }

  private endGesture(allowTap: boolean) {
    const g = this.gesture;
    this.gesture = null;
    if (!g) return;
    const quick = performance.now() - g.startedAt < TAP_MS;
    if (allowTap && quick && !g.moved && g.maxTouches >= 2) {
      if (g.maxTouches === 2) this.undo();
      else this.redo();
      return;
    }
    const speed = Math.hypot(this.velocity.x, this.velocity.y);
    if (allowTap && speed > 0.25 && performance.now() - this.velocity.t < 80) this.startMomentum();
    else this.invalidate();
  }

  private panBy(dx: number, dy: number) {
    this.cam.x -= dx / this.cam.zoom;
    this.cam.y -= dy / this.cam.zoom;
    this.clampCamera();
    this.invalidate();
    this.emitState();
  }

  private startMomentum() {
    let last = performance.now();
    let vx = this.velocity.x;
    let vy = this.velocity.y;
    const step = (t: number) => {
      const dt = Math.min(40, t - last);
      last = t;
      const decay = Math.pow(0.996, dt);
      vx *= decay;
      vy *= decay;
      const beforeX = this.cam.x;
      const beforeY = this.cam.y;
      this.cam.x += (vx * dt) / this.cam.zoom;
      this.cam.y += (vy * dt) / this.cam.zoom;
      this.clampCamera();
      this.renderNow();
      this.emitState();
      const stuck = beforeX === this.cam.x && beforeY === this.cam.y;
      if (Math.hypot(vx, vy) < 0.02 || stuck) {
        this.momentum = null;
        this.invalidate();
        return;
      }
      this.momentum = requestAnimationFrame(step);
    };
    this.momentum = requestAnimationFrame(step);
  }

  private stopMomentum() {
    if (this.momentum != null) {
      cancelAnimationFrame(this.momentum);
      this.momentum = null;
      this.invalidate();
    }
  }

  // ---- Strokes ------------------------------------------------------------------

  private cancelLive() {
    if (this.live?.snapTimer != null) clearTimeout(this.live.snapTimer);
    this.live = null;
    this.redrawWet();
  }

  private commitLive() {
    const live = this.live;
    if (!live) return;
    if (live.snapTimer != null) clearTimeout(live.snapTimer);
    this.live = null;
    const page = this.pages[live.pageIndex];
    if (!page?.strokes || live.points.length < 3) {
      this.redrawWet();
      return;
    }
    const stroke = normalizeStroke({
      id: newId(),
      kind: live.kind,
      color: live.color,
      width: live.width,
      points: live.points.slice(0, 20_000 * 3),
    });
    page.strokes.set(stroke.id, stroke);
    this.pushHistory({ pageId: page.meta.id, before: [], after: [stroke] });
    this.cb.onOps([putOp(page.meta.id, stroke)]);

    // Paint it into the page raster right away (no full rebuild) ...
    const r = this.rasters.get(page.meta.id);
    if (r && !r.dirty) {
      const ctx = r.canvas.getContext("2d") as CanvasRenderingContext2D;
      ctx.setTransform(r.canvas.width / page.meta.width, 0, 0, r.canvas.height / page.meta.height, 0, 0);
      if (stroke.kind === "highlighter") r.dirty = true; // highlighters sit under the pens
      else drawStroke(ctx, stroke, page.meta.template.paper);
    }
    // ... and keep it on the wet layer until the page layer has presented it,
    // so the stroke never blinks out between the two canvases.
    const entry = { pageIndex: live.pageIndex, stroke };
    this.settling.push(entry);
    this.renderNow();
    this.redrawWet();
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        this.settling = this.settling.filter((s) => s !== entry);
        this.redrawWet();
      }),
    );
  }

  private eraseAt(x: number, y: number) {
    const act = this.erase!;
    const page = this.pages[act.pageIndex];
    if (!page?.strokes) return;
    const r = this.tools.eraserSize / 2 / Math.max(0.5, Math.min(2, this.cam.zoom)) * 1.0;
    // Walk the segment from the last position so a fast flick erases a line.
    const steps = Math.max(1, Math.ceil(Math.hypot(x - act.lastX, y - act.lastY) / Math.max(1, r / 2)));
    let changed = false;
    for (let k = 1; k <= steps; k++) {
      const cx = act.lastX + ((x - act.lastX) * k) / steps;
      const cy = act.lastY + ((y - act.lastY) * k) / steps;
      const box: BBox = { minX: cx - r, minY: cy - r, maxX: cx + r, maxY: cy + r };
      for (const s of [...page.strokes.values()]) {
        if (!bboxIntersects(strokeBBox(s), { minX: box.minX - s.width, minY: box.minY - s.width, maxX: box.maxX + s.width, maxY: box.maxY + s.width })) continue;
        if (this.tools.eraserMode === "stroke") {
          if (!strokeHitsCircle(s, cx, cy, r)) continue;
          page.strokes.delete(s.id);
          if (act.added.has(s.id)) act.added.delete(s.id);
          else act.removed.set(s.id, s);
          changed = true;
        } else {
          const pieces = eraseFromStroke(s, cx, cy, r);
          if (!pieces) continue;
          page.strokes.delete(s.id);
          if (act.added.has(s.id)) act.added.delete(s.id);
          else act.removed.set(s.id, s);
          for (const piece of pieces) {
            const n = normalizeStroke(piece);
            page.strokes.set(n.id, n);
            act.added.set(n.id, n);
          }
          changed = true;
        }
      }
    }
    act.lastX = x;
    act.lastY = y;
    if (changed) {
      this.markDirty(page.meta.id);
      this.renderNow();
    }
    // Eraser outline on the wet layer.
    this.redrawWet();
    const ctx = this.wetCtx;
    ctx.setTransform(...this.pageTransform(act.pageIndex));
    ctx.save();
    ctx.lineWidth = 1 / this.cam.zoom;
    ctx.strokeStyle = "rgba(100,116,139,0.9)";
    ctx.fillStyle = "rgba(148,163,184,0.15)";
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
    this.touchWet(act.pageIndex, { minX: x - r - 2, minY: y - r - 2, maxX: x + r + 2, maxY: y + r + 2 });
  }

  private finishErase() {
    const act = this.erase;
    this.erase = null;
    this.redrawWet();
    if (!act || (!act.removed.size && !act.added.size)) return;
    const page = this.pages[act.pageIndex];
    const before = [...act.removed.values()];
    const after = [...act.added.values()];
    this.pushHistory({ pageId: page.meta.id, before, after });
    this.cb.onOps(diffOps(page.meta.id, before, after));
    this.scheduleBuild();
  }

  // ---- History ------------------------------------------------------------------

  private pushHistory(entry: HistoryEntry) {
    this.undoStack.push(entry);
    if (this.undoStack.length > HISTORY_LIMIT) this.undoStack.shift();
    this.redoStack = [];
    this.emitState();
  }

  private applyEntry(entry: HistoryEntry, from: Stroke[], to: Stroke[]) {
    const page = this.pages.find((p) => p.meta.id === entry.pageId);
    if (!page?.strokes) return false;
    const toIds = new Set(to.map((s) => s.id));
    for (const s of from) if (!toIds.has(s.id)) page.strokes.delete(s.id);
    for (const s of to) page.strokes.set(s.id, s);
    this.cb.onOps(diffOps(entry.pageId, from, to));
    this.markDirty(entry.pageId);
    this.clearSelection();
    this.invalidate();
    return true;
  }

  undo() {
    const entry = this.undoStack.pop();
    if (!entry) return;
    if (this.applyEntry(entry, entry.after, entry.before)) this.redoStack.push(entry);
    this.revealPage(entry.pageId);
    this.emitState();
  }

  redo() {
    const entry = this.redoStack.pop();
    if (!entry) return;
    if (this.applyEntry(entry, entry.before, entry.after)) this.undoStack.push(entry);
    this.revealPage(entry.pageId);
    this.emitState();
  }

  /** Scroll so an undone change is visible when it happened off screen. */
  private revealPage(pageId: string) {
    const i = this.pages.findIndex((p) => p.meta.id === pageId);
    if (i >= 0 && !this.visiblePages().includes(i)) this.scrollToPage(i, true);
  }

  // ---- Lasso and selection ----------------------------------------------------------

  private finishLasso() {
    const lasso = this.lasso;
    this.lasso = null;
    this.redrawWet();
    if (!lasso) return;
    const page = this.pages[lasso.pageIndex];
    if (!page?.strokes) return;
    const picked = lassoSelect(page.strokes.values(), lasso.poly);
    if (!picked.length) {
      this.emitState();
      return;
    }
    let bbox = emptyBBox();
    for (const s of picked) bbox = unionBBox(bbox, strokeBBox(s));
    this.selection = { pageIndex: lasso.pageIndex, ids: new Set(picked.map((s) => s.id)), bbox };
    this.emitState();
  }

  clearSelection() {
    if (!this.selection) return;
    this.selection = null;
    this.emitState();
  }

  private selectionScreenBox(): { left: number; top: number; width: number; height: number } | null {
    const sel = this.selection;
    if (!sel) return null;
    const t = this.pageTransform(sel.pageIndex);
    const b = this.drag ? transformBBox(sel.bbox, this.drag.transform) : sel.bbox;
    const left = (b.minX * t[0] + t[4]) / this.dpr;
    const top = (b.minY * t[3] + t[5]) / this.dpr;
    return {
      left,
      top,
      width: ((b.maxX - b.minX) * t[0]) / this.dpr,
      height: ((b.maxY - b.minY) * t[3]) / this.dpr,
    };
  }

  /** What a press at (x, y) grabs: a corner handle (scale), the box (move), or nothing. */
  private hitSelection(x: number, y: number): { kind: "move" | "scale"; anchorX: number; anchorY: number } | null {
    const box = this.selectionScreenBox();
    const sel = this.selection;
    if (!box || !sel) return null;
    const corners = [
      { x: box.left, y: box.top, ax: sel.bbox.maxX, ay: sel.bbox.maxY },
      { x: box.left + box.width, y: box.top, ax: sel.bbox.minX, ay: sel.bbox.maxY },
      { x: box.left, y: box.top + box.height, ax: sel.bbox.maxX, ay: sel.bbox.minY },
      { x: box.left + box.width, y: box.top + box.height, ax: sel.bbox.minX, ay: sel.bbox.minY },
    ];
    for (const c of corners) {
      if (Math.hypot(x - c.x, y - c.y) <= HANDLE_PX) return { kind: "scale", anchorX: c.ax, anchorY: c.ay };
    }
    const pad = 8;
    if (x >= box.left - pad && x <= box.left + box.width + pad && y >= box.top - pad && y <= box.top + box.height + pad) {
      return { kind: "move", anchorX: 0, anchorY: 0 };
    }
    return null;
  }

  private beginDrag(e: PointerEvent, x: number, y: number, hit: { kind: "move" | "scale"; anchorX: number; anchorY: number }) {
    const sel = this.selection!;
    const p = this.toPage(sel.pageIndex, x, y);
    this.capture(e.pointerId);
    this.drag = {
      pointerId: e.pointerId,
      kind: hit.kind,
      startX: p.x,
      startY: p.y,
      anchorX: hit.anchorX,
      anchorY: hit.anchorY,
      startDist: Math.max(1, Math.hypot(p.x - hit.anchorX, p.y - hit.anchorY)),
      transform: { sx: 1, sy: 1, tx: 0, ty: 0 },
    };
    this.hidden = new Set(sel.ids);
    this.markDirty(this.pages[sel.pageIndex].meta.id);
    this.renderNow();
    this.redrawWet();
  }

  private updateDrag(x: number, y: number) {
    const d = this.drag!;
    const sel = this.selection!;
    const p = this.toPage(sel.pageIndex, x, y);
    if (d.kind === "move") {
      d.transform = { sx: 1, sy: 1, tx: p.x - d.startX, ty: p.y - d.startY };
    } else {
      const dist = Math.hypot(p.x - d.anchorX, p.y - d.anchorY);
      const s = Math.min(10, Math.max(0.1, dist / d.startDist));
      d.transform = scaleAbout(d.anchorX, d.anchorY, s);
    }
    this.redrawWet();
    this.emitState();
  }

  private finishDrag(cancelled: boolean) {
    const d = this.drag;
    const sel = this.selection;
    this.drag = null;
    this.hidden = new Set();
    if (!d || !sel) return;
    const page = this.pages[sel.pageIndex];
    const t = d.transform;
    const moved = !cancelled && (t.sx !== 1 || t.sy !== 1 || Math.abs(t.tx) > 0.01 || Math.abs(t.ty) > 0.01);
    if (moved && page.strokes) {
      const before: Stroke[] = [];
      const after: Stroke[] = [];
      for (const id of sel.ids) {
        const s = page.strokes.get(id);
        if (!s) continue;
        const n = normalizeStroke(transformStroke(s, t));
        before.push(s);
        after.push(n);
        page.strokes.set(id, n);
      }
      sel.bbox = transformBBox(sel.bbox, t);
      this.pushHistory({ pageId: page.meta.id, before, after });
      this.cb.onOps(after.map((s) => putOp(page.meta.id, s)));
    }
    this.markDirty(page.meta.id);
    this.renderNow();
    this.redrawWet();
    this.emitState();
  }

  private selectedStrokes(): { page: EnginePage; strokes: Stroke[] } | null {
    const sel = this.selection;
    if (!sel) return null;
    const page = this.pages[sel.pageIndex];
    if (!page?.strokes) return null;
    return { page, strokes: [...sel.ids].map((id) => page.strokes!.get(id)).filter((s): s is Stroke => !!s) };
  }

  deleteSelection() {
    const got = this.selectedStrokes();
    if (!got) return;
    for (const s of got.strokes) got.page.strokes!.delete(s.id);
    this.pushHistory({ pageId: got.page.meta.id, before: got.strokes, after: [] });
    this.cb.onOps(got.strokes.map((s) => ({ t: "ink.del" as const, page: got.page.meta.id, id: s.id })));
    this.selection = null;
    this.markDirty(got.page.meta.id);
    this.invalidate();
    this.emitState();
  }

  recolorSelection(color: string) {
    const got = this.selectedStrokes();
    if (!got) return;
    const after = got.strokes.map((s) => ({ ...s, color }));
    for (const s of after) got.page.strokes!.set(s.id, s);
    this.pushHistory({ pageId: got.page.meta.id, before: got.strokes, after });
    this.cb.onOps(after.map((s) => putOp(got.page.meta.id, s)));
    this.markDirty(got.page.meta.id);
    this.invalidate();
  }

  copySelection(cut = false) {
    const got = this.selectedStrokes();
    if (!got) return;
    clipboard = got.strokes.map((s) => ({ ...s, points: s.points.slice() }));
    if (cut) this.deleteSelection();
    this.emitState();
  }

  duplicateSelection() {
    const got = this.selectedStrokes();
    if (!got) return;
    this.placeStrokes(this.selection!.pageIndex, got.strokes, { sx: 1, sy: 1, tx: 24, ty: 24 });
  }

  /** Paste the clipboard into the page in view (same spot, or centred when that is off the page). */
  paste() {
    if (!clipboard.length || !this.pages.length) return;
    const i = this.selection?.pageIndex ?? this.currentPageIndex();
    const page = this.pages[i];
    let b = emptyBBox();
    for (const s of clipboard) b = unionBBox(b, strokeBBox(s));
    const onPage = b.minX >= 0 && b.minY >= 0 && b.maxX <= page.meta.width && b.maxY <= page.meta.height;
    const center = this.toPage(i, this.viewW / 2, this.viewH / 2);
    const m: ScaleMove = onPage
      ? { sx: 1, sy: 1, tx: 16, ty: 16 }
      : { sx: 1, sy: 1, tx: center.x - (b.minX + b.maxX) / 2, ty: center.y - (b.minY + b.maxY) / 2 };
    this.placeStrokes(i, clipboard, m);
  }

  private placeStrokes(pageIndex: number, strokes: Stroke[], m: ScaleMove) {
    const page = this.pages[pageIndex];
    if (!page?.strokes) return;
    const added = strokes.map((s) => normalizeStroke(transformStroke(s, m, newId())));
    for (const s of added) page.strokes!.set(s.id, s);
    this.pushHistory({ pageId: page.meta.id, before: [], after: added });
    this.cb.onOps(added.map((s) => putOp(page.meta.id, s)));
    let bbox = emptyBBox();
    for (const s of added) bbox = unionBBox(bbox, strokeBBox(s));
    this.selection = { pageIndex, ids: new Set(added.map((s) => s.id)), bbox };
    this.markDirty(page.meta.id);
    this.invalidate();
    this.emitState();
  }

  // ---- Pages --------------------------------------------------------------------

  /** Insert a page after index `after` (-1: at the start). Returns its id. */
  addPage(after: number, size: { width: number; height: number }, template: PageTemplate): string {
    const prev = this.pages[after]?.meta.position;
    const next = this.pages[after + 1]?.meta.position;
    const id = newId();
    const meta: PageMeta = {
      id,
      position: positionBetween(prev, next),
      template,
      width: size.width,
      height: size.height,
      pdf: null,
      inkVersion: 0,
      strokeCount: 0,
    };
    // Update the page list first, then report: listeners read getPages().
    this.setPages([...this.getPages(), meta]);
    const page = this.pages.find((p) => p.meta.id === id);
    if (page) page.strokes = new Map();
    this.cb.onOps([{ t: "page.add", id, position: meta.position, template, width: meta.width, height: meta.height, pdf: null }]);
    this.scrollToPage(after + 1, true);
    return id;
  }

  deletePage(pageId: string) {
    if (this.pages.length <= 1) return;
    this.undoStack = this.undoStack.filter((e) => e.pageId !== pageId);
    this.redoStack = this.redoStack.filter((e) => e.pageId !== pageId);
    this.setPages(this.getPages().filter((p) => p.id !== pageId));
    this.cb.onOps([{ t: "page.del", id: pageId }]);
  }

  movePage(pageId: string, toIndex: number) {
    const others = this.getPages().filter((p) => p.id !== pageId);
    const me = this.getPages().find((p) => p.id === pageId);
    if (!me) return;
    const i = Math.max(0, Math.min(others.length, toIndex));
    const position = positionBetween(others[i - 1]?.position, others[i]?.position);
    this.setPages([...others, { ...me, position }]);
    this.cb.onOps([{ t: "page.move", id: pageId, position }]);
  }

  setPageTemplate(pageId: string, template: PageTemplate) {
    const me = this.getPages().find((p) => p.id === pageId);
    if (!me) return;
    this.setPages(this.getPages().map((p) => (p.id === pageId ? { ...p, template } : p)));
    this.cb.onOps([{ t: "page.template", id: pageId, template }]);
  }

  // ---- Offscreen renders (thumbnails, recognition) ------------------------------------

  /** Draw a page into `canvas` at `cssWidth` (thumbnails). */
  renderThumbnail(pageId: string, canvas: HTMLCanvasElement, cssWidth: number) {
    const page = this.pages.find((p) => p.meta.id === pageId);
    if (!page) return;
    const m = page.meta;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const scale = (cssWidth / m.width) * dpr;
    const w = Math.round(m.width * scale);
    const h = Math.round(m.height * scale);
    if (canvas.width !== w) canvas.width = w;
    if (canvas.height !== h) canvas.height = h;
    const ctx = canvas.getContext("2d") as CanvasRenderingContext2D;
    const raster = this.rasters.get(m.id);
    if (raster && !raster.dirty) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(raster.canvas, 0, 0, w, h);
      return;
    }
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    drawPaper(ctx, m.template, m.width, m.height, scale);
    const pdf = this.pdfRasters.get(m.id);
    if (pdf?.canvas) ctx.drawImage(pdf.canvas, 0, 0, m.width, m.height);
    if (page.strokes) drawStrokes(ctx, page.strokes.values(), m.template.paper);
  }

  /**
   * The page's handwriting as a JPEG for recognition: dark ink on white, no
   * template lines and no PDF (its text is extracted separately), cropped to
   * the ink. Null when the page has no ink.
   */
  async renderInkImage(pageId: string, maxSide = 1600): Promise<Blob | null> {
    const page = this.pages.find((p) => p.meta.id === pageId);
    if (!page?.strokes?.size) return null;
    const strokes = [...page.strokes.values()].filter((s) => s.kind !== "highlighter");
    if (!strokes.length) return null;
    let b = emptyBBox();
    for (const s of strokes) b = unionBBox(b, strokeBBox(s));
    const pad = 16;
    b = { minX: Math.max(0, b.minX - pad), minY: Math.max(0, b.minY - pad), maxX: Math.min(page.meta.width, b.maxX + pad), maxY: Math.min(page.meta.height, b.maxY + pad) };
    const bw = Math.max(1, b.maxX - b.minX);
    const bh = Math.max(1, b.maxY - b.minY);
    const scale = Math.min(2, maxSide / Math.max(bw, bh));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bw * scale));
    canvas.height = Math.max(1, Math.round(bh * scale));
    const ctx = canvas.getContext("2d") as CanvasRenderingContext2D;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(scale, 0, 0, scale, -b.minX * scale, -b.minY * scale);
    for (const s of strokes) drawStroke(ctx, { ...s, color: darkInk(s.color) }, "white");
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
    this.freeCanvas(canvas);
    return blob;
  }

  // ---- UI state -----------------------------------------------------------------

  private emitState() {
    if (this.stateFrame != null || this.destroyed) return;
    this.stateFrame = requestAnimationFrame(() => {
      this.stateFrame = null;
      const box = this.selectionScreenBox();
      this.cb.onState({
        zoom: this.cam.zoom,
        pageIndex: this.currentPageIndex(),
        pageCount: this.pages.length,
        canUndo: this.undoStack.length > 0,
        canRedo: this.redoStack.length > 0,
        selection:
          this.selection && box
            ? { pageId: this.pages[this.selection.pageIndex]?.meta.id ?? "", count: this.selection.ids.size, box }
            : null,
        penSeen: this.penSeen,
        hasClipboard: clipboard.length > 0,
      });
    });
  }
}

function readDeskColor(el: HTMLElement): string {
  return getComputedStyle(el).getPropertyValue("--notebook-desk").trim() || "#e7e5e4";
}

// ---- Helpers ----------------------------------------------------------------------

function putOp(pageId: string, s: Stroke): Op {
  return { t: "ink.put", page: pageId, s: toBase64(encodeStroke(s)) };
}

/** Ops turning `from` strokes into `to` strokes on one page. */
function diffOps(pageId: string, from: Stroke[], to: Stroke[]): Op[] {
  const toIds = new Set(to.map((s) => s.id));
  const ops: Op[] = [];
  for (const s of from) if (!toIds.has(s.id)) ops.push({ t: "ink.del", page: pageId, id: s.id });
  for (const s of to) ops.push(putOp(pageId, s));
  return ops;
}

/** Light inks (yellow, white on dark paper) recognised as dark on white. */
function darkInk(color: string): string {
  const m = /^#([0-9a-f]{6})$/i.exec(color);
  if (!m) return "#000000";
  const n = parseInt(m[1], 16);
  const lum = 0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255);
  return lum > 150 ? "#000000" : color;
}
