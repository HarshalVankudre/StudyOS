/**
 * Push configuration from the environment. Notifications exist only when a
 * complete, valid VAPID key pair and subject are set; otherwise every
 * notification surface hides itself and the dispatch does nothing.
 */
import { fromB64url, isP256PublicKey, vapidKeysMatch, type VapidKeys } from "./webpush";

type Env = Record<string, string | undefined>;

let cache: { signature: string; value: VapidKeys | null } | null = null;

/** The VAPID keys, or null when push is not (correctly) configured. */
export function vapidConfig(env: Env = process.env): VapidKeys | null {
  const publicKey = env.VAPID_PUBLIC_KEY?.trim() ?? "";
  const privateKey = env.VAPID_PRIVATE_KEY?.trim() ?? "";
  const subject = env.VAPID_SUBJECT?.trim() ?? "";
  const signature = `${publicKey}|${privateKey}|${subject}`;
  if (cache?.signature === signature) return cache.value;

  let value: VapidKeys | null = null;
  if (
    publicKey &&
    privateKey &&
    validSubject(subject) &&
    isP256PublicKey(fromB64url(publicKey)) &&
    vapidKeysMatch(publicKey, privateKey)
  ) {
    value = { publicKey, privateKey, subject };
  }
  cache = { signature, value };
  return value;
}

/** Push services (Apple's in particular) require a mailto: or https: contact. */
export function validSubject(subject: string): boolean {
  if (/^mailto:[^@\s]+@[^@\s]+$/.test(subject)) return true;
  try {
    const url = new URL(subject);
    return url.protocol === "https:" && url.hostname !== "localhost";
  } catch {
    return false;
  }
}

export function pushConfigured(env: Env = process.env): boolean {
  return vapidConfig(env) !== null;
}

/** The public key the browser subscribes with (safe to show). */
export function vapidPublicKey(env: Env = process.env): string | null {
  return vapidConfig(env)?.publicKey ?? null;
}
