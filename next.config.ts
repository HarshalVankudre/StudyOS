import type { NextConfig } from "next";

import { buildAppCsp, isValidBucketName } from "./src/lib/ops/csp";

/**
 * Content-Security-Policy for app pages: see src/lib/ops/csp.ts for every
 * directive and why each source is there. Headers are fixed at build time,
 * so the assets bucket and Clerk's key must be known here (both are Docker
 * build arguments). /embed/* is excluded: /embed/react sets its own nonce CSP.
 */
const ASSETS_BUCKET = process.env.ASSETS_BUCKET?.trim() || undefined;
if (ASSETS_BUCKET && !isValidBucketName(ASSETS_BUCKET)) {
  // A malformed name would silently drop the bucket from img-src.
  throw new Error("ASSETS_BUCKET is not a valid bucket name");
}

const APP_CSP = buildAppCsp({
  assetsBucket: ASSETS_BUCKET,
  clerkPublishableKey: process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
  clerkProxyUrl: process.env.NEXT_PUBLIC_CLERK_PROXY_URL,
});

const nextConfig: NextConfig = {
  // The bucket the CSP above was built for, so the startup check can refuse a
  // build whose img-src does not match the bucket in use (lib/ops/env.ts).
  env: { STUDYOS_BUILD_ASSETS_BUCKET: ASSETS_BUCKET ?? "" },
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
