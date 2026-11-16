/**
 * Push configuration from the environment. Push exists only when a complete,
 * valid VAPID key pair and subject are set; otherwise every push surface
 * hides itself. Email is the other channel (lib/email/config); with neither,
 * the notification settings are hidden and the dispatch does nothing.
 */
import { emailConfigured } from "@/lib/email/config";
import { fromB64url, isP256PublicKey, vapidKeysMatch, type VapidKeys } from "./webpush";

type Env = Record<string, string | undefined>;

/**
 * Test emails a student may send per day ("Send a test email"), on top of
 * the per-instance limit of a few per ten minutes: each one goes out from our
 * sending domain, so a script must not be able to use the button to burn its
 * reputation. Counted as UsageEvent rows of TEST_EMAIL_KIND (lib/usage-limits
 * claimWithinLimit), aged out by lib/ops/retention.
 */
export const TEST_EMAILS_PER_DAY = 5;
export const TEST_EMAIL_KIND = "notification_test_email";

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

/** Any channel is set up (push, or email: lib/email/config): the settings section shows. */
export function notificationsConfigured(env: Env = process.env): boolean {
  return pushConfigured(env) || emailConfigured(env);
}

/** The public key the browser subscribes with (safe to show). */
export function vapidPublicKey(env: Env = process.env): string | null {
  return vapidConfig(env)?.publicKey ?? null;
}
