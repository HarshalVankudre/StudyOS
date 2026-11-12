// Bundle the startup configuration check (src/lib/ops/check-env-cli.ts) into
// .next/standalone/check-env.cjs, a dependency-free script the container runs
// before `node server.js` (see the Dockerfile CMD). Runs after `next build`,
// which recreates .next/standalone; the runner image copies that folder, so
// the script ships next to server.js without its own COPY line.
import { build } from "esbuild";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const outDir = `${root}.next/standalone`;
if (!existsSync(outDir)) {
  console.error(`build-env-check: ${outDir} does not exist (is output: "standalone" set?)`);
  process.exit(1);
}

await build({
  stdin: {
    contents: [
      'import { runEnvironmentCheck } from "./src/lib/ops/check-env-cli";',
      "process.exitCode = runEnvironmentCheck();",
    ].join("\n"),
    resolveDir: root,
    sourcefile: "check-env-entry.ts",
    loader: "ts",
  },
  // Resolves the "@/..." imports through tsconfig.json paths.
  tsconfig: `${root}tsconfig.json`,
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node22",
  outfile: `${outDir}/check-env.cjs`,
  legalComments: "none",
  logLevel: "warning",
});
console.log("built .next/standalone/check-env.cjs");
