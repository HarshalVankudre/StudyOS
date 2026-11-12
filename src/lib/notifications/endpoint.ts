/**
 * Push subscriptions as received from the browser: validation, the endpoint
 * allowlist, hashing and a short device label.
 *
 * The server POSTs to whatever endpoint a subscription names, so an arbitrary
 * URL would let anyone make StudyOS send requests into other networks (SSRF).
 * Only https endpoints on the push services browsers actually use are
 * accepted: Google (Chrome, Edge on Android, Opera, Samsung), Mozilla
 * (Firefox), Apple (Safari on macOS and iOS home-screen apps) and Microsoft
 * (Edge on Windows).
 *
 * The endpoint is a capability URL: never log it, never echo it back.
 */
import { createHash } from "node:crypto";
import { z } from "zod";
import { fromB64url, isP256PublicKey } from "./webpush";

const PUSH_HOST_SUFFIXES = [
  "fcm.googleapis.com",
  "push.services.mozilla.com",
  "push.apple.com",
  "notify.windows.com",
] as const;

export function isAllowedPushEndpoint(endpoint: string): boolean {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443")) {
    return false;
  }
  const host = url.hostname.toLowerCase();
  return PUSH_HOST_SUFFIXES.some((suffix) => host === suffix || host.endsWith(`.${suffix}`));
}

export function endpointHash(endpoint: string): string {
  return createHash("sha256").update(endpoint).digest("hex");
}

const b64 = z.string().regex(/^[A-Za-z0-9_-]+=*$/).max(200);

/** The JSON a browser's PushSubscription serializes to. */
export const subscriptionInputSchema = z.object({
  endpoint: z.string().min(1).max(2_000),
  keys: z.object({ p256dh: b64, auth: b64 }),
});

export type SubscriptionInput = z.infer<typeof subscriptionInputSchema>;

export type SubscriptionCheck =
  | { ok: true; endpoint: string; p256dh: string; auth: string }
  | { ok: false; reason: "invalid" | "endpoint_not_allowed" };

export function checkSubscription(value: unknown): SubscriptionCheck {
  const parsed = subscriptionInputSchema.safeParse(value);
  if (!parsed.success) return { ok: false, reason: "invalid" };
  const { endpoint, keys } = parsed.data;
  if (!isAllowedPushEndpoint(endpoint)) return { ok: false, reason: "endpoint_not_allowed" };
  if (!isP256PublicKey(fromB64url(keys.p256dh))) return { ok: false, reason: "invalid" };
  if (fromB64url(keys.auth).length !== 16) return { ok: false, reason: "invalid" };
  return { ok: true, endpoint, p256dh: keys.p256dh, auth: keys.auth };
}

/** "iPhone", "Android", "Chrome · Windows", … from a user agent (no version, no detail). */
export function deviceLabel(userAgent: string | null | undefined): string {
  const ua = userAgent ?? "";
  const os = /iPhone|iPod/.test(ua)
    ? "iPhone"
    : /iPad/.test(ua)
      ? "iPad"
      : /Android/.test(ua)
        ? "Android"
        : /Windows/.test(ua)
          ? "Windows"
          : /Mac OS X|Macintosh/.test(ua)
            ? "Mac"
            : /CrOS/.test(ua)
              ? "ChromeOS"
              : /Linux/.test(ua)
                ? "Linux"
                : "";
  if (os === "iPhone" || os === "iPad") return os;
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /Firefox\//.test(ua)
      ? "Firefox"
      : /OPR\//.test(ua)
        ? "Opera"
        : /SamsungBrowser\//.test(ua)
          ? "Samsung Internet"
          : /Chrome\//.test(ua)
            ? "Chrome"
            : /Safari\//.test(ua)
              ? "Safari"
              : "";
  return [browser, os].filter(Boolean).join(" · ").slice(0, 60);
}
