/**
 * Canonical public URL of this deployment.
 *
 * Used for SEO surfaces (metadataBase, robots, sitemap) and anywhere a link
 * must be absolute outside a request context (emails, ICS feeds). Inside a
 * request, prefer deriving from the request's `host` header (see
 * billing-actions.ts) so links match the domain the user is on.
 */
const FALLBACK_URL = "https://studyos-e5jjkd6x5a-uk.a.run.app";

export function siteUrl(): string {
  const raw =
    process.env.APP_URL ??
    process.env.NEXT_PUBLIC_APP_URL ??
    FALLBACK_URL;
  // Normalize: no trailing slash.
  return raw.endsWith("/") ? raw.slice(0, -1) : raw;
}

/**
 * Every origin this deployment is configured to be reached at: the app's
 * canonical URL (APP_URL / NEXT_PUBLIC_APP_URL, else the fallback) and, on
 * the website deployment, the app's own host (STUDYOS_APP_ORIGIN). A link to
 * one of these is a link into StudyOS itself. Values that are not http(s)
 * URLs are skipped.
 */
export function ownOrigins(env: Record<string, string | undefined> = process.env): string[] {
  const origins = new Set<string>();
  for (const raw of [env.APP_URL, env.NEXT_PUBLIC_APP_URL, env.STUDYOS_APP_ORIGIN, FALLBACK_URL]) {
    const value = raw?.trim();
    if (!value) continue;
    try {
      const url = new URL(value);
      if (url.protocol === "https:" || url.protocol === "http:") origins.add(url.origin);
    } catch {
      // Not a URL: nothing to match links against.
    }
  }
  return [...origins];
}

/**
 * The one public support address, shown on the landing, pricing and legal
 * pages. Set STUDYOS_SUPPORT_EMAIL to a shared inbox; the fallback is the
 * owner's address from before the setting existed.
 */
export const FALLBACK_SUPPORT_EMAIL = "harshalvankudre@gmail.com";

const EMAIL = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/;

/** A plausible single address (no display name), at most 254 characters. */
export function isPlausibleEmail(value: string | undefined): value is string {
  return Boolean(value && value.length <= 254 && EMAIL.test(value));
}

export function supportEmail(env: Record<string, string | undefined> = process.env): string {
  const raw = env.STUDYOS_SUPPORT_EMAIL?.trim();
  return isPlausibleEmail(raw) ? raw : FALLBACK_SUPPORT_EMAIL;
}
