/**
 * Content-Security-Policy for app pages (every path but /embed/*, which sets
 * its own stricter nonce policy). Pure and dependency-free: next.config.ts
 * imports it at build time, so it must not use "@/..." imports.
 *
 * Only directives that cannot break Clerk, Stripe redirects, KaTeX, Mermaid,
 * Next's inline scripts, the service worker or the manifest. No script-src,
 * style-src or default-src: Clerk loads its script from its frontend API and
 * Next inlines scripts and styles, and a nonce policy for every page would
 * make every page dynamic.
 *
 * - frame-src: iframes, and any navigation an embedded frame makes of itself,
 *   may only load our own origin (/embed/react) plus the hosts Clerk's own CSP
 *   helper allows (Cloudflare Turnstile, Stripe.js frames). A react_artifact
 *   can therefore not navigate its iframe to an external page.
 * - img-src: our origin, inline data:/blob: URLs, Clerk's avatar host, and the
 *   assets bucket by path (/api/asset/:id 302-redirects to a signed
 *   storage.googleapis.com URL; CSP ignores paths after a redirect, so the
 *   signed URL matches while a direct link to another bucket does not).
 *   Without a bucket at build time no storage host is allowed at all (it used
 *   to widen to the whole host); the startup check refuses to run a build
 *   whose bucket differs from the one in use (lib/ops/env.ts).
 * - connect-src: fetch, XHR, WebSocket and EventSource may reach our origin
 *   (API routes, server actions, Next's dev socket), Clerk's frontend API
 *   (from the publishable key, or the proxy URL), Clerk's telemetry and
 *   image hosts, and Stripe's API (as in Clerk's helper, for its billing
 *   components). Closes fetch()-based exfiltration from injected script.
 *   Left out only when the frontend API cannot be known at build time, so a
 *   build without the Clerk key never locks sign-in out.
 * - form-action: forms post to our origin; a native form post of a server
 *   action may be answered with a redirect to Stripe Checkout or the billing
 *   portal, and browsers check form-action on that redirect too.
 * - worker-src 'self' blob: the service worker (/sw.js) and Clerk's workers.
 * - manifest-src 'self': /manifest.webmanifest.
 * - frame-ancestors 'self' (as X-Frame-Options SAMEORIGIN), object-src
 *   'none', base-uri 'self'.
 */

const BUCKET_NAME = /^[a-z0-9][a-z0-9._-]{1,220}$/;
const HOST_NAME = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;

export function isValidBucketName(name: string | undefined): name is string {
  return Boolean(name && BUCKET_NAME.test(name));
}

/**
 * Clerk's frontend API origin from a publishable key: "pk_test_" or
 * "pk_live_" followed by base64 of "<host>$". Null when it is not one.
 */
export function clerkFrontendApiOrigin(publishableKey: string | undefined): string | null {
  const match = /^pk_(test|live)_([A-Za-z0-9+/=_-]+)$/.exec(publishableKey?.trim() ?? "");
  if (!match) return null;
  let decoded: string;
  try {
    decoded = Buffer.from(match[2].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
  } catch {
    return null;
  }
  if (!decoded.endsWith("$")) return null;
  const host = decoded.slice(0, -1).toLowerCase();
  return HOST_NAME.test(host) ? `https://${host}` : null;
}

function proxyOrigin(proxyUrl: string | undefined): string | null {
  if (!proxyUrl?.trim()) return null;
  try {
    const url = new URL(proxyUrl.trim());
    return url.protocol === "https:" && HOST_NAME.test(url.hostname) ? url.origin : null;
  } catch {
    return null; // A relative proxy path is our own origin: 'self' covers it.
  }
}

export interface AppCspInput {
  /** ASSETS_BUCKET at build time. */
  assetsBucket?: string;
  /** NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY (inlined at build time). */
  clerkPublishableKey?: string;
  /** NEXT_PUBLIC_CLERK_PROXY_URL, when Clerk runs behind a proxy. */
  clerkProxyUrl?: string;
}

export const STRIPE_REDIRECT_ORIGINS = ["https://checkout.stripe.com", "https://billing.stripe.com"] as const;

export function buildAppCsp(input: AppCspInput): string {
  const bucket = input.assetsBucket?.trim();
  const img = ["'self'", "data:", "blob:", "https://img.clerk.com"];
  if (isValidBucketName(bucket)) img.push(`https://storage.googleapis.com/${bucket}/`);

  const clerk = [clerkFrontendApiOrigin(input.clerkPublishableKey), proxyOrigin(input.clerkProxyUrl)].filter(
    (o): o is string => Boolean(o),
  );
  const connect = clerk.length
    ? [
        "'self'",
        ...new Set(clerk),
        "https://clerk-telemetry.com",
        "https://*.clerk-telemetry.com",
        "https://img.clerk.com",
        "https://api.stripe.com",
      ]
    : null;

  return [
    "frame-src 'self' https://challenges.cloudflare.com https://js.stripe.com https://*.js.stripe.com https://hooks.stripe.com",
    `img-src ${img.join(" ")}`,
    ...(connect ? [`connect-src ${connect.join(" ")}`] : []),
    `form-action 'self' ${STRIPE_REDIRECT_ORIGINS.join(" ")}`,
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    "frame-ancestors 'self'",
    "object-src 'none'",
    "base-uri 'self'",
  ].join("; ");
}
