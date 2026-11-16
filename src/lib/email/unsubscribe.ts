/**
 * The one-click unsubscribe link in every reminder email (RFC 8058):
 *
 *   https://<app>/api/notifications/unsubscribe?t=<token>
 *
 * The token is `<user id, base64url>.<HMAC-SHA256, base64url>`. It names the
 * student (their opaque Clerk id, never an address) and proves StudyOS wrote
 * it; it does not expire, since the link in an old email must keep working.
 * All it can do is turn email reminders off for that one student.
 *
 * Keys. New links are signed with a key derived from UNSUBSCRIBE_SECRET when
 * it is set, else from CLERK_SECRET_KEY (lib/ops/secret.ts derivedServerKey),
 * each for this purpose only. A link is accepted when it verifies under any
 * of UNSUBSCRIBE_SECRET, UNSUBSCRIBE_SECRET_PREVIOUS and the Clerk-derived
 * key, so rotating either secret never breaks links already sent:
 *
 *   - setting UNSUBSCRIBE_SECRET for the first time: old links (Clerk key)
 *     still work while the Clerk key stays the same;
 *   - rotating UNSUBSCRIBE_SECRET: move the old value to
 *     UNSUBSCRIBE_SECRET_PREVIOUS (keep it for as long as old emails matter);
 *   - rotating CLERK_SECRET_KEY: with UNSUBSCRIBE_SECRET set, nothing changes.
 *
 * A link that verifies under none of them gets a page telling the student to
 * switch email off in Settings instead.
 *
 * The link is built on the APP's origin (unsubscribeOrigin): mail apps post
 * one-click unsubscribes without following redirects, so it must not point
 * at the website deployment, which redirects /api/* to the app.
 */
import "server-only";

import { createHmac } from "node:crypto";
import { derivedServerKey, secretsMatch } from "@/lib/ops/secret";
import { parseAppOrigin } from "@/lib/ops/site-split";
import { siteUrl } from "@/lib/site";

type Env = Record<string, string | undefined>;

const PURPOSE = "email-unsubscribe:v1";
export const UNSUBSCRIBE_PATH = "/api/notifications/unsubscribe";
const TOKEN_SHAPE = /^([A-Za-z0-9_-]{1,200})\.([A-Za-z0-9_-]{43})$/;

/** A key for this purpose from an own secret (the same derivation as derivedServerKey). */
function keyFrom(secret: string): Buffer {
  return createHmac("sha256", secret).update(`studyos:${PURPOSE}`).digest();
}

/** The key new links are signed with, or null when no secret is set. */
export function unsubscribeKey(env: Env = process.env): Buffer | null {
  const own = env.UNSUBSCRIBE_SECRET?.trim();
  return own ? keyFrom(own) : derivedServerKey(PURPOSE, env);
}

/** Every key a link may have been signed with, newest first (see the module comment). */
export function unsubscribeKeys(env: Env = process.env): Buffer[] {
  const keys: Buffer[] = [];
  for (const name of ["UNSUBSCRIBE_SECRET", "UNSUBSCRIBE_SECRET_PREVIOUS"] as const) {
    const secret = env[name]?.trim();
    if (secret) keys.push(keyFrom(secret));
  }
  const clerk = derivedServerKey(PURPOSE, env);
  if (clerk) keys.push(clerk);
  return keys;
}

function signature(key: Buffer, userId: string): string {
  return createHmac("sha256", key).update(`${PURPOSE}\n${userId}`).digest("base64url");
}

export function signUnsubscribeToken(userId: string, key: Buffer): string {
  return `${Buffer.from(userId, "utf8").toString("base64url")}.${signature(key, userId)}`;
}

/** The student a token was made for, or null (malformed, tampered, signed with none of the keys). */
export function verifyUnsubscribeToken(
  token: string | null | undefined,
  keys: Buffer | readonly Buffer[] | null,
): string | null {
  const candidates = keys === null ? [] : Buffer.isBuffer(keys) ? [keys] : keys;
  if (candidates.length === 0 || typeof token !== "string") return null;
  const match = TOKEN_SHAPE.exec(token);
  if (!match) return null;
  const userId = Buffer.from(match[1], "base64url").toString("utf8");
  // Decoding is lenient; only a value that encodes back to the same text is ours.
  if (!userId || Buffer.from(userId, "utf8").toString("base64url") !== match[1]) return null;
  // Every key is tried (no early exit), so timing does not tell which one matched.
  let valid = false;
  for (const key of candidates) valid = secretsMatch(match[2], signature(key, userId)) || valid;
  return valid ? userId : null;
}

/**
 * The origin unsubscribe links (and the other links of an email) are built
 * on: the app deployment's own origin. On the website deployment
 * (STUDYOS_APP_ORIGIN set, lib/ops/site-split.ts) APP_URL is the website,
 * whose /api/* only redirects, so the app origin is used instead.
 */
export function unsubscribeOrigin(env: Env = process.env): string {
  try {
    const app = parseAppOrigin(env.STUDYOS_APP_ORIGIN);
    if (app) return app;
  } catch {
    // A malformed STUDYOS_APP_ORIGIN is reported by the startup check.
  }
  const raw = (env.APP_URL ?? env.NEXT_PUBLIC_APP_URL)?.trim();
  return raw ? raw.replace(/\/+$/, "") : siteUrl();
}

/** The absolute unsubscribe link for a student. */
export function unsubscribeUrl(origin: string, userId: string, key: Buffer): string {
  return `${origin}${UNSUBSCRIBE_PATH}?t=${signUnsubscribeToken(userId, key)}`;
}
