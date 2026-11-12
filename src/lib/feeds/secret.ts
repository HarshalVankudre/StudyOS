/**
 * Sealing calendar feed links at rest (server-only).
 *
 * A feed link grants read access to the student's calendar, so the stored
 * copy is encrypted with AES-256-GCM under FEED_URL_KEY. The key is optional
 * for starting the server: in production without it, connecting a calendar
 * link is switched off (`feedLinksAvailable()` is false, the connect action
 * refuses with "links_unavailable", the startup log warns) and sealing refuses
 * to run, so no link is ever stored unencrypted there. Only outside
 * production, without a key, is the link stored merely encoded (marked
 * "p1:") so local development works; that is NOT encryption. A "p1:" value found once a key is set is still opened, and
 * `needsReseal` tells the caller to store it again sealed.
 *
 * The link is only ever unsealed right before a fetch, inside the server.
 */
import "server-only";

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const SEALED = "g1:";
const ENCODED = "p1:";
const IV_BYTES = 12;
/** GCM tag length is pinned: a shortened tag would make forgery far easier. */
const TAG_BYTES = 16;

export class FeedKeyMissingError extends Error {
  constructor() {
    super("FEED_URL_KEY is required in production to store calendar feed links");
    this.name = "FeedKeyMissingError";
  }
}

function key(): Buffer | null {
  const raw = process.env.FEED_URL_KEY?.trim();
  if (!raw) return null;
  // Any high-entropy string works; derive a fixed-size key from it.
  return createHash("sha256").update(`studyos-feed-url:${raw}`).digest();
}

/**
 * Whether calendar links can be connected (stored for syncing) right now:
 * always outside production, and in production only with FEED_URL_KEY set.
 */
export function feedLinksAvailable(): boolean {
  return key() !== null || process.env.NODE_ENV !== "production";
}

/** Seal a link for storage. Throws FeedKeyMissingError in production without a key. */
export function sealFeedUrl(url: string): string {
  const k = key();
  if (!k) {
    if (process.env.NODE_ENV === "production") throw new FeedKeyMissingError();
    return ENCODED + Buffer.from(url, "utf8").toString("base64url");
  }
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", k, iv, { authTagLength: TAG_BYTES });
  const body = Buffer.concat([cipher.update(url, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${SEALED}${iv.toString("base64url")}.${tag.toString("base64url")}.${body.toString("base64url")}`;
}

/** The link, or null when it cannot be opened (key changed or missing, tampered). */
export function openFeedUrl(sealed: string): string | null {
  try {
    if (sealed.startsWith(ENCODED)) return Buffer.from(sealed.slice(ENCODED.length), "base64url").toString("utf8");
    if (!sealed.startsWith(SEALED)) return null;
    const k = key();
    if (!k) return null;
    const parts = sealed.slice(SEALED.length).split(".");
    if (parts.length !== 3) return null;
    const iv = Buffer.from(parts[0], "base64url");
    const tag = Buffer.from(parts[1], "base64url");
    if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) return null;
    const decipher = createDecipheriv("aes-256-gcm", k, iv, { authTagLength: TAG_BYTES });
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(Buffer.from(parts[2], "base64url")), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}

/** True when a stored value is only encoded and a key is now available to seal it. */
export function needsReseal(stored: string): boolean {
  return stored.startsWith(ENCODED) && key() !== null;
}

/** Fingerprint of a normalized link, to notice the same link connected twice. */
export function feedUrlHash(url: string): string {
  return createHash("sha256").update(url).digest("hex");
}
