/**
 * Errors of the notebooks API and how every route answers them.
 *
 * The store throws NotebookError with the `{ code }` the client sees and the
 * HTTP status; the codec and ink-limit errors of the shared ops module are
 * mapped here too, so every route answers the same failure the same way:
 *
 *   not_authenticated 401 | not_found 404 | invalid 400/409 | too_large 413 |
 *   unsupported 415 | unreadable 422 | limit 422 | too_many_strokes 422 |
 *   rate_limited 429 | busy 429/503 | unavailable 502/503/500
 *
 * Someone else's notebook, page, folder or file is always `not_found`, never
 * a 403: an answer never reveals that a row exists.
 */
import "server-only";

import { reportError } from "@/lib/ops/report-error";
import { CodecError, InkLimitError } from "../ops";

export type NotebookErrorCode =
  | "not_authenticated"
  | "not_found"
  | "invalid"
  | "too_large"
  | "limit"
  | "too_many_strokes"
  | "rate_limited"
  | "unavailable"
  | "unsupported"
  | "unreadable"
  | "busy";

export class NotebookError extends Error {
  constructor(
    readonly code: NotebookErrorCode,
    readonly status: number,
    /** Extra fields of the JSON answer (e.g. which limit). */
    readonly extra: Record<string, unknown> = {},
  ) {
    super(code);
    this.name = "NotebookError";
  }
}

export function errorResponse(code: NotebookErrorCode, status: number, extra: Record<string, unknown> = {}): Response {
  return Response.json({ code, ...extra }, { status, headers: { "Cache-Control": "no-store" } });
}

/** Prisma: the transaction could not start in time, or timed out (lock contention). */
function isBusy(error: unknown): boolean {
  const code = typeof error === "object" && error !== null ? (error as { code?: unknown }).code : undefined;
  return code === "P2028" || code === "P2034";
}

/**
 * The answer for an error thrown while handling a notebooks request. Known
 * errors keep their code; anything else is reported and answered with a
 * generic 500 `unavailable`.
 */
export function toErrorResponse(error: unknown, context: { route: string; method: string; userId?: string }): Response {
  if (error instanceof NotebookError) return errorResponse(error.code, error.status, error.extra);
  // A malformed stroke record in an ops batch: the client sent bytes the
  // codec refuses. The whole batch is refused (nothing was written).
  if (error instanceof CodecError) return errorResponse("invalid", 400);
  if (error instanceof InkLimitError) return errorResponse(error.code, 422);
  if (isBusy(error)) return errorResponse("busy", 503);
  reportError(error, { source: "api", ...context });
  return errorResponse("unavailable", 500);
}
