/**
 * One codebase, two deployments.
 *
 *   - The APP deployment (our own server) serves everything: the signed-in
 *     app, every API and AI route, sign-in, and the public pages too. It has
 *     the database next to it and no limit on how long a request may run.
 *   - The WEBSITE deployment (Vercel) serves only the public pages: landing,
 *     pricing, terms, privacy, the legal notice, and their share images
 *     (/opengraph-image, /twitter-image, /pricing/opengraph-image, ...), which
 *     link previews fetch from the page's own host. It has no database and no
 *     AI key.
 *
 * The website deployment is told where the app lives with STUDYOS_APP_ORIGIN
 * (for example https://app.studyos.example). Every path that needs the
 * database, a session or a model is then redirected there, so "Start free",
 * "Sign in", "Open app" and the landing page's prompt form all keep working
 * as plain relative links: /generate?prompt=... on the website becomes the
 * same path and query on the app's host.
 *
 * Pure (no Next.js imports): next.config.ts and lib/ops/env.ts both use it.
 */

/** Paths only the app deployment can serve. Next.js `source` patterns. */
export const APP_ONLY_SOURCES = [
  "/app",
  "/app/:path*",
  "/generate",
  "/sign-in",
  "/sign-in/:path*",
  "/sign-up",
  "/sign-up/:path*",
  "/api/:path*",
  "/embed/:path*",
  // Shared pages (/s/<token>) and their images read the database: public,
  // but served by the app (signed-out visitors included).
  "/s/:path*",
  // Invite links (/r/<code>): the invite cookie must be set on the app's own
  // origin, where sign-up and the app read it (lib/referral).
  "/r/:path*",
  // The withdrawal function and cancellation button (lib/contract-notices):
  // public and linked from every page's footer, but they store the notice.
  "/withdraw",
  "/cancel",
] as const;

export interface SiteRedirect {
  source: string;
  destination: string;
  permanent: false;
}

/**
 * The app's origin from STUDYOS_APP_ORIGIN, or null when it is not set (this
 * is the app deployment, or local development). Throws on a value that is set
 * but is not a bare http(s) origin: a typo here would silently send every
 * visitor to the wrong place.
 */
export function parseAppOrigin(raw: string | undefined): string | null {
  const value = raw?.trim();
  if (!value) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("STUDYOS_APP_ORIGIN is not a URL (expected e.g. https://app.example.com)");
  }
  const bare = url.pathname === "/" && !url.search && !url.hash && !url.username && !url.password;
  if ((url.protocol !== "https:" && url.protocol !== "http:") || !bare) {
    throw new Error("STUDYOS_APP_ORIGIN must be an origin only, e.g. https://app.example.com (no path or query)");
  }
  return url.origin;
}

/**
 * Redirects for the website deployment: temporary (browsers cache a permanent
 * redirect for good, and the app's address may still change), same path, and
 * Next.js carries the query string over. Empty for the app deployment.
 */
export function websiteRedirects(appOrigin: string | null): SiteRedirect[] {
  if (!appOrigin) return [];
  return APP_ONLY_SOURCES.map((source) => ({
    source,
    destination: `${appOrigin}${source}`,
    permanent: false,
  }));
}
