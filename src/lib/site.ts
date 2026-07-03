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
