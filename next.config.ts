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
 * /embed/* is excluded: /embed/react sets its own stricter nonce CSP.
 */
const APP_CSP = [
  "frame-src 'self' https://challenges.cloudflare.com https://js.stripe.com https://*.js.stripe.com https://hooks.stripe.com",
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
  },
  // Pin the workspace root to this folder so Next ignores stray lockfiles
  // elsewhere on the machine (silences the inferred-root warning).
  turbopack: {
    root: __dirname,
  },
  // PDF.js (inside unpdf, used by the syllabus import) is loaded by Node at
  // runtime rather than bundled; output tracing still ships it in standalone.
  serverExternalPackages: ["unpdf"],
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
