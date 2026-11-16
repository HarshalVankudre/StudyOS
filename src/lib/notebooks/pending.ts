/**
 * Replaying unconfirmed local changes on top of a server copy (pure).
 *
 * When a newer copy of a notebook or page arrives from the server (another
 * device changed it), the device's own changes that the server has not
 * confirmed yet are applied on top, in order, so they stay visible and are
 * sent as usual. Ops are idempotent, so replaying one the server already has
 * changes nothing.
 */
import { decodeStroke, fromBase64 } from "./codec";
import type { PageMeta, Stroke } from "./model";
import type { Op } from "./ops";

/** A page's strokes with the pending ink ops for that page applied. */
export function withPendingInk(pageId: string, server: readonly Stroke[], pending: readonly Op[]): Stroke[] {
  const map = new Map(server.map((s) => [s.id, s]));
  for (const op of pending) {
    if (op.t === "ink.del" && op.page === pageId) map.delete(op.id);
    else if (op.t === "ink.put" && op.page === pageId) {
      try {
        const s = decodeStroke(fromBase64(op.s));
        map.set(s.id, s);
      } catch {
        // A record this device made is always valid; skip anything else.
      }
    }
  }
  return [...map.values()];
}

/** The page list with pending page ops applied. */
export function withPendingPages(server: readonly PageMeta[], pending: readonly Op[]): PageMeta[] {
  const pages = new Map(server.map((p) => [p.id, { ...p }]));
  for (const op of pending) {
    switch (op.t) {
      case "page.add":
        if (!pages.has(op.id)) {
          pages.set(op.id, {
            id: op.id,
            position: op.position,
            template: op.template,
            width: op.width,
            height: op.height,
            pdf: op.pdf ?? null,
            inkVersion: 0,
            strokeCount: 0,
          });
        }
        break;
      case "page.del":
        pages.delete(op.id);
        break;
      case "page.move": {
        const p = pages.get(op.id);
        if (p) p.position = op.position;
        break;
      }
      case "page.template": {
        const p = pages.get(op.id);
        if (p) p.template = op.template;
        break;
      }
    }
  }
  return [...pages.values()].sort((a, b) => a.position - b.position);
}

/** Pages that pending ops touch (their ink must not be replaced blindly). */
export function pagesWithPendingInk(pending: readonly Op[]): Set<string> {
  const out = new Set<string>();
  for (const op of pending) if (op.t === "ink.put" || op.t === "ink.del") out.add(op.page);
  return out;
}

/**
 * Split ops into batches no larger than `maxOps` ops and roughly `maxBytes`
 * of JSON, in order.
 */
export function batchOps(ops: readonly Op[], maxOps: number, maxBytes: number): Op[][] {
  const out: Op[][] = [];
  let cur: Op[] = [];
  let bytes = 0;
  for (const op of ops) {
    const size = op.t === "ink.put" ? op.s.length + 64 : 160;
    if (cur.length && (cur.length >= maxOps || bytes + size > maxBytes)) {
      out.push(cur);
      cur = [];
      bytes = 0;
    }
    cur.push(op);
    bytes += size;
  }
  if (cur.length) out.push(cur);
  return out;
}
