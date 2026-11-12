#!/usr/bin/env node
/**
 * Build the StudyOS render image (infra/sandbox/Dockerfile) on Daytona and
 * register it as a snapshot. Run it from the repository root, with the
 * owner's Daytona key in the environment:
 *
 *   DAYTONA_API_KEY=... node infra/sandbox/build-snapshot.mjs [name] [--replace]
 *
 *   name       snapshot name (default: studyos-render, the name cloudbuild.yaml
 *              sets as STUDYOS_SANDBOX_SNAPSHOT)
 *   --replace  delete an existing snapshot of that name first. Without it, an
 *              existing name is an error: build under a new name (for example
 *              studyos-render-v2), then point STUDYOS_SANDBOX_SNAPSHOT at it
 *              on the Cloud Run service. That is the switch with no gap: with
 *              --replace, renders are refused (cleanly, free) between the
 *              delete and the end of the build.
 *
 * Daytona builds the image itself (no local Docker needed) and streams the
 * build log here. The Dockerfile ends with a smoke test that compiles LaTeX
 * (pdflatex, xelatex with CJK and Arabic), plots with matplotlib and draws a
 * Graphviz graph as the sandbox user; a build that cannot render fails.
 *
 * The app checks the version marker the image writes
 * (/etc/studyos-render-image, see src/lib/ai/sandbox/toolchain.ts): until a
 * snapshot built from this file is in place, renders are refused with one
 * clear log line and cost nothing.
 *
 * This calls only Daytona. It never runs in CI or in the app.
 */
import { Daytona, Image } from "@daytona/sdk";
import { fileURLToPath } from "node:url";
import path from "node:path";

const args = process.argv.slice(2);
const replace = args.includes("--replace");
const name = args.find((a) => !a.startsWith("--")) ?? "studyos-render";

if (!process.env.DAYTONA_API_KEY) {
  console.error("Set DAYTONA_API_KEY (the owner's Daytona API key) first.");
  process.exit(1);
}

const dockerfile = path.join(path.dirname(fileURLToPath(import.meta.url)), "Dockerfile");
const daytona = new Daytona({ apiKey: process.env.DAYTONA_API_KEY });

const existing = await daytona.snapshot.get(name).catch(() => null);
if (existing) {
  if (!replace) {
    console.error(
      `A snapshot named "${name}" already exists. Re-run with --replace to rebuild it in place, ` +
        `or give a new name and set STUDYOS_SANDBOX_SNAPSHOT to it.`,
    );
    process.exit(1);
  }
  console.log(`Deleting the existing snapshot "${name}"…`);
  await daytona.snapshot.delete(existing);
}

console.log(`Building "${name}" from ${dockerfile} on Daytona (this takes a while: TeX Live is large)…`);
const snapshot = await daytona.snapshot.create(
  {
    name,
    image: Image.fromDockerfile(dockerfile),
    // A render is one short compile: 1 vCPU and 2 GiB are plenty. The image
    // is about 3 GB, so it needs more than the default disk.
    resources: { cpu: 1, memory: 2, disk: 6 },
  },
  { onLogs: (line) => process.stdout.write(line.endsWith("\n") ? line : `${line}\n`) },
);
console.log(`Snapshot "${snapshot.name}" is ${snapshot.state}.`);
console.log(`Make sure the Cloud Run service has STUDYOS_SANDBOX_SNAPSHOT=${name}.`);
