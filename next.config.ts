import type { NextConfig } from "next";

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
    ];
  },
};

export default nextConfig;
