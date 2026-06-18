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
};

export default nextConfig;
