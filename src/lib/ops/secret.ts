import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Constant-time check of a presented secret. Both sides are hashed first so
 * the comparison runs on equal-length buffers and leaks neither content nor
 * length through timing.
 */
export function secretsMatch(presented: string, expected: string): boolean {
  const a = createHash("sha256").update(presented).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b) && presented.length === expected.length;
}

/** The token from `Authorization: Bearer <token>`, or null. */
export function bearerToken(req: Request): string | null {
  const header = req.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match ? match[1] : null;
}
