// Bundle the sandboxed-iframe runtime into public/embed/runtime.js (no UMD needed for React 19).
import { build } from "esbuild";
import { mkdirSync } from "node:fs";

mkdirSync("public/embed", { recursive: true });
await build({
  entryPoints: ["src/embed/runtime/index.tsx"],
  bundle: true,
  minify: true,
  format: "iife",
  target: "es2020",
  outfile: "public/embed/runtime.js",
  define: { "process.env.NODE_ENV": '"production"' },
  legalComments: "none",
});
console.log("built public/embed/runtime.js");
