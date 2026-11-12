/**
 * Request guards for the /api/materials routes (server-only): capped JSON
 * bodies, cheap per-user limits for the read and delete routes, and caps on
 * concurrent heavy work (text extraction, study-kit runs) per user and per
 * server instance. The expensive actions are also rate-limited per user in
 * the database (lib/usage-limits: material_upload, study_kit), which holds
 * across instances; these in-memory guards bound what one instance does at
 * once.
 */
import "server-only";
import { createMemoryRateLimiter } from "@/lib/ops/memory-rate-limit";

export type BodyResult = { ok: true; value: unknown } | { ok: false; status: 400 | 413 };

/**
 * Read a JSON body of at most `maxBytes`, refusing a larger declared length
 * before reading and stopping mid-stream when an undeclared body runs over.
 */
export async function readJsonBody(request: Request, maxBytes: number): Promise<BodyResult> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > maxBytes) return { ok: false, status: 413 };
  if (!request.body) return { ok: false, status: 400 };
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel().catch(() => {});
        return { ok: false, status: 413 };
      }
      chunks.push(value);
    }
  } catch {
    return { ok: false, status: 400 };
  }
  const bytes = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, at);
    at += chunk.byteLength;
  }
  try {
    return { ok: true, value: JSON.parse(new TextDecoder().decode(bytes)) };
  } catch {
    return { ok: false, status: 400 };
  }
}

/** Listing materials and opening citations: generous for a person, a wall for a loop. */
export const allowMaterialRead = createMemoryRateLimiter({ limit: 120, windowMs: 60_000 });
/** Deleting materials and cancelling runs. */
export const allowMaterialWrite = createMemoryRateLimiter({ limit: 60, windowMs: 60_000 });

type HeavyKind = "extract" | "kit";

const HEAVY_LIMITS: Record<HeavyKind, { perUser: number; perInstance: number }> = {
  // PDF parsing is CPU and memory bound: few at a time.
  extract: { perUser: 2, perInstance: 4 },
  // A run holds one material in memory and up to 5 model calls in flight.
  kit: { perUser: 2, perInstance: 12 },
};

const running: Record<HeavyKind, { total: number; byUser: Map<string, number> }> = {
  extract: { total: 0, byUser: new Map() },
  kit: { total: 0, byUser: new Map() },
};

/**
 * Take a slot for heavy work, or null when the user (or this instance) is
 * already at its cap. Call the returned release exactly once when done.
 */
export function acquireHeavySlot(kind: HeavyKind, userId: string): (() => void) | null {
  const state = running[kind];
  const limits = HEAVY_LIMITS[kind];
  const mine = state.byUser.get(userId) ?? 0;
  if (mine >= limits.perUser || state.total >= limits.perInstance) return null;
  state.byUser.set(userId, mine + 1);
  state.total += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    state.total = Math.max(0, state.total - 1);
    const left = (state.byUser.get(userId) ?? 1) - 1;
    if (left <= 0) state.byUser.delete(userId);
    else state.byUser.set(userId, left);
  };
}
