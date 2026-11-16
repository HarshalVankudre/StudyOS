/**
 * Binary ink codec (pure; runs in the browser and on the server).
 *
 * A page's ink is a blob of stroke records:
 *
 *   blob   = MAGIC(2) VERSION(1) { varint(recordLength) record }*
 *   record = idLength(u8) id(ascii) kind(u8) r g b (u8 x3) width(u16 LE, 1/100 unit)
 *            varint(pointCount) { zigzag-varint(dx) zigzag-varint(dy) pressure(u8) }*
 *
 * x and y are quantised to 1/16 page unit and delta-encoded, so a typical
 * sample takes 3 to 4 bytes (JSON would take ~25). Records are
 * length-prefixed so the server can merge ops by stroke id without decoding
 * the points (splitPage / recordId), while every record it accepts from a
 * client is fully validated once (decodeStroke).
 */
import {
  ID_PATTERN,
  MAX_STROKE_POINTS,
  MAX_STROKE_WIDTH,
  MIN_STROKE_WIDTH,
  STROKE_KINDS,
  type Stroke,
} from "./model";

const MAGIC0 = 0x53; // "S"
const MAGIC1 = 0x4e; // "N"
const VERSION = 1;
const Q = 16; // quantisation steps per page unit
/** Coordinates beyond this (page units) are refused: no page is this big. */
const MAX_COORD = 100_000;

export class CodecError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CodecError";
  }
}

// ---- Growable byte writer -----------------------------------------------------

class Writer {
  buf: Uint8Array;
  len = 0;
  constructor(size = 256) {
    this.buf = new Uint8Array(size);
  }
  ensure(n: number) {
    if (this.len + n <= this.buf.length) return;
    let size = this.buf.length * 2;
    while (size < this.len + n) size *= 2;
    const next = new Uint8Array(size);
    next.set(this.buf.subarray(0, this.len));
    this.buf = next;
  }
  u8(v: number) {
    this.ensure(1);
    this.buf[this.len++] = v & 0xff;
  }
  u16(v: number) {
    this.ensure(2);
    this.buf[this.len++] = v & 0xff;
    this.buf[this.len++] = (v >>> 8) & 0xff;
  }
  varint(v: number) {
    // Unsigned, up to 2^35 (plenty for lengths and zigzagged deltas).
    this.ensure(5);
    while (v >= 0x80) {
      this.buf[this.len++] = (v & 0x7f) | 0x80;
      v = Math.floor(v / 128);
    }
    this.buf[this.len++] = v;
  }
  bytes(b: Uint8Array) {
    this.ensure(b.length);
    this.buf.set(b, this.len);
    this.len += b.length;
  }
  done(): Uint8Array {
    return this.buf.slice(0, this.len);
  }
}

class Reader {
  pos: number;
  constructor(
    readonly buf: Uint8Array,
    start = 0,
    readonly end = buf.length,
  ) {
    this.pos = start;
  }
  u8(): number {
    if (this.pos >= this.end) throw new CodecError("unexpected end");
    return this.buf[this.pos++];
  }
  u16(): number {
    const lo = this.u8();
    return lo | (this.u8() << 8);
  }
  varint(): number {
    let result = 0;
    let mul = 1;
    for (let i = 0; i < 5; i++) {
      const b = this.u8();
      result += (b & 0x7f) * mul;
      if (b < 0x80) return result;
      mul *= 128;
    }
    throw new CodecError("varint too long");
  }
}

const zigzag = (n: number) => (n >= 0 ? n * 2 : -n * 2 - 1);
const unzigzag = (n: number) => (n % 2 === 0 ? n / 2 : -(n + 1) / 2);

function parseColor(color: string): [number, number, number] {
  const m = /^#([0-9a-f]{6})$/i.exec(color);
  if (!m) return [0, 0, 0];
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

const hex2 = (n: number) => n.toString(16).padStart(2, "0");

// ---- Strokes ------------------------------------------------------------------

/** Encode one stroke as a record (no length prefix). */
export function encodeStroke(stroke: Stroke): Uint8Array {
  const w = new Writer(16 + stroke.points.length * 2);
  const id = stroke.id;
  w.u8(id.length);
  for (let i = 0; i < id.length; i++) w.u8(id.charCodeAt(i));
  w.u8(Math.max(0, STROKE_KINDS.indexOf(stroke.kind)));
  const [r, g, b] = parseColor(stroke.color);
  w.u8(r);
  w.u8(g);
  w.u8(b);
  const width = Math.min(MAX_STROKE_WIDTH, Math.max(MIN_STROKE_WIDTH, stroke.width));
  w.u16(Math.round(width * 100));
  const n = Math.floor(stroke.points.length / 3);
  w.varint(n);
  let px = 0;
  let py = 0;
  for (let i = 0; i < n; i++) {
    const qx = Math.round(stroke.points[i * 3] * Q);
    const qy = Math.round(stroke.points[i * 3 + 1] * Q);
    const p = stroke.points[i * 3 + 2];
    w.varint(zigzag(qx - px));
    w.varint(zigzag(qy - py));
    w.u8(Math.round(Math.min(1, Math.max(0, Number.isFinite(p) ? p : 0.5)) * 255));
    px = qx;
    py = qy;
  }
  return w.done();
}

/** Decode and validate one record. Throws CodecError on anything malformed. */
export function decodeStroke(record: Uint8Array, start = 0, end = record.length): Stroke {
  const r = new Reader(record, start, end);
  const idLen = r.u8();
  let id = "";
  for (let i = 0; i < idLen; i++) id += String.fromCharCode(r.u8());
  if (!ID_PATTERN.test(id)) throw new CodecError("bad stroke id");
  const kindIndex = r.u8();
  const kind = STROKE_KINDS[kindIndex];
  if (!kind) throw new CodecError("bad stroke kind");
  const color = `#${hex2(r.u8())}${hex2(r.u8())}${hex2(r.u8())}`;
  const width = r.u16() / 100;
  if (width < MIN_STROKE_WIDTH || width > MAX_STROKE_WIDTH) throw new CodecError("bad stroke width");
  const n = r.varint();
  if (n < 1 || n > MAX_STROKE_POINTS) throw new CodecError("bad point count");
  const points = new Array<number>(n * 3);
  let qx = 0;
  let qy = 0;
  for (let i = 0; i < n; i++) {
    qx += unzigzag(r.varint());
    qy += unzigzag(r.varint());
    points[i * 3] = qx / Q;
    points[i * 3 + 1] = qy / Q;
    points[i * 3 + 2] = r.u8() / 255;
    if (Math.abs(qx) > MAX_COORD * Q || Math.abs(qy) > MAX_COORD * Q) throw new CodecError("coordinate out of range");
  }
  if (r.pos !== end) throw new CodecError("trailing bytes in stroke");
  return { id, kind, color, width, points };
}

/** The stroke id of a record without decoding its points. */
export function recordId(record: Uint8Array): string {
  const len = record[0] ?? 0;
  let id = "";
  for (let i = 1; i <= len && i < record.length; i++) id += String.fromCharCode(record[i]);
  return id;
}

/**
 * The stroke as it will read back after a round trip (coordinates
 * quantised). Apply to a stroke before keeping it locally, so this device and
 * the server hold exactly the same numbers.
 */
export function normalizeStroke(stroke: Stroke): Stroke {
  return decodeStroke(encodeStroke(stroke));
}

// ---- Pages --------------------------------------------------------------------

export const EMPTY_PAGE: Uint8Array = new Uint8Array([MAGIC0, MAGIC1, VERSION]);

/** Join records into a page blob. */
export function joinPage(records: Iterable<Uint8Array>): Uint8Array {
  const w = new Writer(1024);
  w.u8(MAGIC0);
  w.u8(MAGIC1);
  w.u8(VERSION);
  for (const rec of records) {
    w.varint(rec.length);
    w.bytes(rec);
  }
  return w.done();
}

/** Split a page blob into its records (framing only; points are not decoded). */
export function splitPage(blob: Uint8Array): Uint8Array[] {
  if (blob.length === 0) return [];
  if (blob.length < 3 || blob[0] !== MAGIC0 || blob[1] !== MAGIC1) throw new CodecError("not an ink blob");
  if (blob[2] !== VERSION) throw new CodecError("unsupported ink version");
  const r = new Reader(blob, 3);
  const out: Uint8Array[] = [];
  while (r.pos < blob.length) {
    const len = r.varint();
    if (len < 1 || r.pos + len > blob.length) throw new CodecError("bad record length");
    out.push(blob.subarray(r.pos, r.pos + len));
    r.pos += len;
  }
  return out;
}

export function encodePage(strokes: Iterable<Stroke>): Uint8Array {
  const records: Uint8Array[] = [];
  for (const s of strokes) records.push(encodeStroke(s));
  return joinPage(records);
}

export function decodePage(blob: Uint8Array): Stroke[] {
  return splitPage(blob).map((rec) => decodeStroke(rec));
}

// ---- Base64 (both runtimes; no Buffer) ------------------------------------------

export function toBase64(bytes: Uint8Array): string {
  let s = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    s += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + CHUNK)));
  }
  return btoa(s);
}

export function fromBase64(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}
