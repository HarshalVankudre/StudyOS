/**
 * Notebook change ops (pure; shared by the browser and the server).
 *
 * The client sends batches of ops to POST /api/notebooks/:id/ops. Every op is
 * idempotent, so a batch that is retried after a lost reply changes nothing
 * the second time:
 *
 *   ink.put      add a stroke, or replace the stroke with the same id
 *                (a lasso move/resize/recolor rewrites the stroke in place)
 *   ink.del      remove a stroke (missing: nothing happens)
 *   page.add     add a page (an id that exists: nothing happens)
 *   page.del     remove a page and its ink (missing: nothing happens)
 *   page.move    give a page a new order key
 *   page.template change a page's paper template
 *
 * Ops on different strokes commute; ops on the same stroke resolve to the
 * last one the server applied (last writer wins). Ink ops naming a page that
 * does not exist (deleted on another device) are dropped.
 */
import { z } from "zod";
import { CodecError, decodeStroke, fromBase64, joinPage, recordId, splitPage } from "./codec";
import {
  ID_PATTERN,
  MAX_PAGE_INK_BYTES,
  MAX_PAGE_SIDE,
  MAX_PAGE_STROKES,
  MIN_PAGE_SIDE,
  PAPER_COLORS,
  TEMPLATE_KINDS,
} from "./model";

const id = z.string().regex(ID_PATTERN);
const template = z.object({ kind: z.enum(TEMPLATE_KINDS), paper: z.enum(PAPER_COLORS) });
const side = z.number().int().min(MIN_PAGE_SIDE).max(MAX_PAGE_SIDE);
const position = z.number().finite();

export const opSchema = z.discriminatedUnion("t", [
  // `s`: base64 of one stroke record (codec.encodeStroke).
  z.object({ t: z.literal("ink.put"), page: id, s: z.string().min(8).max(400_000) }),
  z.object({ t: z.literal("ink.del"), page: id, id }),
  z.object({
    t: z.literal("page.add"),
    id,
    position,
    template,
    width: side,
    height: side,
    pdf: z.object({ fileId: id, page: z.number().int().min(1).max(10_000) }).nullable().optional(),
  }),
  z.object({ t: z.literal("page.del"), id }),
  z.object({ t: z.literal("page.move"), id, position }),
  z.object({ t: z.literal("page.template"), id, template }),
]);

export type Op = z.infer<typeof opSchema>;
export type InkOp = Extract<Op, { t: "ink.put" | "ink.del" }>;
export type PageOp = Exclude<Op, InkOp>;

/** Ops per request. A long offline session is sent in several batches. */
export const MAX_OPS_PER_BATCH = 500;
/** Request body cap for an ops batch. */
export const MAX_OPS_BODY_BYTES = 4 * 1024 * 1024;

export const batchSchema = z.object({
  ops: z.array(opSchema).min(1).max(MAX_OPS_PER_BATCH),
});

export function isInkOp(op: Op): op is InkOp {
  return op.t === "ink.put" || op.t === "ink.del";
}

export class InkLimitError extends Error {
  constructor(readonly code: "too_many_strokes" | "too_large") {
    super(code);
    this.name = "InkLimitError";
  }
}

/**
 * Apply ink ops for one page to its stored blob. Returns the new blob and
 * stroke count, or null when nothing changed. Each `put` record is decoded
 * once to validate it (a malformed record throws CodecError, and the caller
 * refuses the batch); stored records are only re-framed.
 */
export function applyInkOps(
  blob: Uint8Array,
  ops: readonly InkOp[],
): { blob: Uint8Array; strokeCount: number } | null {
  const records = new Map<string, Uint8Array>();
  for (const rec of splitPage(blob)) records.set(recordId(rec), rec);
  let changed = false;
  for (const op of ops) {
    if (op.t === "ink.del") {
      if (records.delete(op.id)) changed = true;
      continue;
    }
    const rec = fromBase64(op.s);
    const stroke = decodeStroke(rec); // validates; throws CodecError
    // Map.set keeps an existing key's position: a replaced stroke keeps its
    // place in the drawing order, a new one goes on top.
    records.set(stroke.id, rec);
    changed = true;
  }
  if (!changed) return null;
  if (records.size > MAX_PAGE_STROKES) throw new InkLimitError("too_many_strokes");
  const next = joinPage(records.values());
  if (next.length > MAX_PAGE_INK_BYTES) throw new InkLimitError("too_large");
  return { blob: next, strokeCount: records.size };
}

export { CodecError };
