import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tsconfigPaths(), react()],
  resolve: {
    alias: {
      // Next.js's `server-only` guard has no importable build outside the RSC
      // graph; stub it so server modules can be unit-tested.
      "server-only": fileURLToPath(
        new URL("./src/test/server-only-stub.ts", import.meta.url),
      ),
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    clearMocks: true,
    restoreMocks: true,
    // Never descend into git worktrees (e.g. .worktrees/*): they carry their own
    // copies of these test files, which would run as duplicates.
    exclude: ["**/node_modules/**", "**/.worktrees/**", "**/dist/**"],
  },
});
