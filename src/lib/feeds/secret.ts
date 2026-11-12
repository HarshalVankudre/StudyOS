/**
 * Sealing calendar feed links at rest (server-only).
 *
 * A feed link grants read access to the student's calendar, so the stored
 * copy is encrypted with AES-256-GCM under FEED_URL_KEY when that variable is
 * set (production should set it; the startup check warns otherwise). Without
 * a key the link is stored merely encoded (marked "p1:") so local development
 * works; that is NOT encryption, only protection from casual grepping.
 *
 * The link is only ever unsealed right before a fetch, inside the server.
 */
import "server-only";

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const SEALED = "g1:";
const ENCODED = "p1:";

function key(): Buffer | null {
  const raw = process.env.FEED_URL_KEY?.trim();
  if (!raw) return null;
  // Any high-entropy string works; derive a fixed-size key from it.
  return createHash("sha256").update(`studyos-feed-url:${raw}`).digest();
}

export function sealFeedUrl(url: string): string {
  const k = key();
  if (!k) return ENCODED + Buffer.from(url, "utf8").toString("base64url");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", k, iv);
  const body = Buffer.concat([cipher.update(url, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${SEALED}${iv.toString("base64url")}.${tag.toString("base64url")}.${body.toString("base64url")}`;
}

/** The link, or null when it cannot be opened (key changed or missing). */
export function openFeedUrl(sealed: string): string | null {
  try {
    if (sealed.startsWith(ENCODED)) return Buffer.from(sealed.slice(ENCODED.length), "base64url").toString("utf8");
    if (!sealed.startsWith(SEALED)) return null;
    const k = key();
    if (!k) return null;
    const [iv, tag, body] = sealed.slice(SEALED.length).split(".");
    const decipher = createDecipheriv("aes-256-gcm", k, Buffer.from(iv, "base64url"));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(body, "base64url")), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}

/** Fingerprint of a normalized link, to notice the same link connected twice. */
export function feedUrlHash(url: string): string {
  return createHash("sha256").update(url).digest("hex");
}
