import { defineConfig } from "@playwright/test";

/**
 * Browser E2E — most importantly the /embed/react security keystone
 * (e2e/embed-security.e2e.ts), which verifies real-browser containment that
 * jsdom cannot: opaque-origin isolation + CSP network lockdown.
 *
 * Files end in .e2e.ts so Vitest's *.test/spec globs never pick them up.
 */
export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.e2e.ts",
  timeout: 90_000,
  retries: 1,
  use: {
    baseURL: "http://localhost:3100",
  },
  webServer: {
    command: "npx next dev -p 3100",
    url: "http://localhost:3100/embed/react",
    reuseExistingServer: true,
    timeout: 180_000,
  },
});
