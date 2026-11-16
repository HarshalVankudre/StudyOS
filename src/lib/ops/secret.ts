import { createHash, createHmac, timingSafeEqual } from "node:crypto";

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

/**
 * MAINTENANCE_SECRET as the scheduler presents it, or null when not set.
 * Trimmed because a secret stored from a file often ends in a newline, while
 * bearerToken trims the header: untrimmed, every job call would be refused.
 */
export function maintenanceSecret(env: Record<string, string | undefined> = process.env): string | null {
  return env.MAINTENANCE_SECRET?.trim() || null;
}

/**
 * A signing key for one purpose, derived from CLERK_SECRET_KEY: the one
 * server secret every app deployment must have (lib/ops/env.ts), so a feature
 * that signs links needs no secret of its own. HMAC-SHA256 of the label under
 * the Clerk key; a distinct label per purpose keeps one feature's signatures
 * from ever passing as another's (or as anything Clerk signs). Null when the
 * secret is not set (nothing can then be signed or verified). Rotating the
 * Clerk key invalidates everything signed with a derived key.
 */
export function derivedServerKey(label: string, env: Record<string, string | undefined> = process.env): Buffer | null {
  const secret = env.CLERK_SECRET_KEY?.trim();
  if (!secret) return null;
  return createHmac("sha256", secret).update(`studyos:${label}`).digest();
}

/** The token from `Authorization: Bearer <token>`, or null. */
export function bearerToken(req: Request): string | null {
  const header = req.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match ? match[1] : null;
}
