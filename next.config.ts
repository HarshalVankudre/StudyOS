import type { NextConfig } from "next";

import { buildAppCsp, isValidBucketName } from "./src/lib/ops/csp";
import { parseAppOrigin, websiteRedirects } from "./src/lib/ops/site-split";

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

// Set only on the website deployment (public pages on Vercel): where the app
// itself lives. Every app-only path is then redirected there; see
// src/lib/ops/site-split.ts. A malformed value fails the build.
const APP_ORIGIN = parseAppOrigin(process.env.STUDYOS_APP_ORIGIN);

// One id per build (a Docker build argument, the Cloud Build id). With it,
// Next.js notices a browser tab that still runs the previous build and
// reloads it on its next navigation instead of mixing two versions; the
// editor handles the tab that never navigates (it stops saving, keeps the
// edits in its local draft and asks for a reload, see workspace-sync.ts).
const DEPLOYMENT_VERSION = process.env.DEPLOYMENT_VERSION?.trim() || undefined;

const nextConfig: NextConfig = {
  ...(DEPLOYMENT_VERSION ? { deploymentId: DEPLOYMENT_VERSION } : {}),
  // The bucket the CSP above was built for, so the startup check can refuse a
  // build whose img-src does not match the bucket in use (lib/ops/env.ts).
  env: { STUDYOS_BUILD_ASSETS_BUCKET: ASSETS_BUCKET ?? "" },
  // No "X-Powered-By: Next.js" header: it tells attackers what to probe for.
  poweredByHeader: false,
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
    "/api/notebooks/import-pdf": ["./src/lib/import/extract-core.mjs", "./src/lib/import/extract-child.mjs"],
    // Brackets escaped: keys are picomatch globs, where [id] is a character class.
    "/api/notebooks/\\[id\\]/pdf": ["./src/lib/import/extract-core.mjs", "./src/lib/import/extract-child.mjs"],
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
    // The proxy buffers request bodies and silently cuts them off at this
    // size (10 MB by default), so it must fit the largest upload: a PDF
    // imported into a notebook, up to 30 MB plus multipart overhead
    // (MAX_PDF_BYTES, lib/notebooks/model.ts), ahead of a Notion export
    // (25 MB, /api/import/notion); the syllabus and material uploads stay at
    // 10 MB. Every route still caps its own body (lib/import/upload-body.ts).
    proxyClientMaxBodySize: "31mb",
    serverActions: {
      // Autosave sends the whole workspace document. Workspaces may be up to
      // 2 MB (MAX_WORKSPACE_BYTES, the same cap as agent results), so leave
      // headroom for the action's argument encoding. The store enforces the
      // 2 MB cap itself and the editor warns before sending anything larger.
      bodySizeLimit: "3mb",
    },
  },
  async redirects() {
    return websiteRedirects(APP_ORIGIN);
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
        // Not on /embed/* (its own nonce CSP) nor on a shared page's images
        // (/s/<token>/asset/<id>: the route sends "sandbox; default-src
        // 'none'", and Next.js drops a route's header when a config rule
        // already set it).
        source: "/:path((?!embed(?:/|$)|s/[^/]+/asset/).*)",
        headers: [{ key: "Content-Security-Policy", value: APP_CSP }],
      },
    ];
  },
};

export default nextConfig;
