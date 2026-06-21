// src/lib/ai/tools/sandbox-tool.ts
import { z } from "zod";
import type { SandboxRunner, SandboxRunSpec } from "@/lib/ai/sandbox/runner";
import type { CreateAssetFn } from "@/lib/assets/service";
import { mimeForOutputPath } from "@/lib/assets/mime";
import type { ToolDefinition } from "./registry";

const MAX_CMDS = 20;
const MAX_FILES = 5;
const MAX_OUTPUTS = 5;
const MAX_CONTENT = 200_000; // per input file
const TIMEOUT_MAX = 180;

/** An output path must be a normal file under out/ — no traversal, no absolutes. */
const outputPath = z
  .string()
  .min(1)
  .max(200)
  .refine((p) => p.startsWith("out/") && !p.includes("..") && !p.startsWith("/"), {
    message: "outputs must live under out/ with no traversal",
  });

const inputFile = z.object({
  path: z.string().min(1).max(200).refine((p) => !p.includes("..") && !p.startsWith("/"), {
    message: "input path must be relative with no traversal",
  }),
  content: z.string().max(MAX_CONTENT),
});

const sandboxInput = z.object({
  inputs: z.array(inputFile).max(MAX_FILES).default([]),
  setup: z.array(z.string().max(500)).max(MAX_CMDS).default([]),
  run: z.array(z.string().max(500)).min(1).max(MAX_CMDS),
  outputs: z.array(outputPath).min(1).max(MAX_OUTPUTS),
  timeoutSec: z.number().int().min(5).max(TIMEOUT_MAX).default(120),
});

const sandboxOutput = z.object({
  artifacts: z.array(
    z.object({ assetId: z.string(), mime: z.string(), filename: z.string() }),
  ),
  logTail: z.string(),
  exitCode: z.number().int(),
});

export function createSandboxTool(deps: {
  runner: SandboxRunner;
  createAsset: CreateAssetFn;
  enabled: boolean;
}): ToolDefinition<typeof sandboxInput, typeof sandboxOutput> {
  return {
    id: "run_in_sandbox",
    description:
      "Run a render toolchain in an isolated sandbox to produce IMAGE artifacts (PNG/SVG) — e.g. compile LaTeX or a diagram. Write source via `inputs`, optionally `setup` installs, `run` the commands that write files under out/, and list those files in `outputs`. Returns asset handles; then add a media block per artifact with set_page_blocks referencing the assetId. Never returns file bytes.",
    input: sandboxInput,
    output: sandboxOutput,
    limits: { timeoutMs: (TIMEOUT_MAX + 20) * 1000 },
    networkPermission: "allowlisted", // calls the Daytona API host (fixed config, not model-controlled)
    enabled: deps.enabled,
    handler: async (input, ctx) => {
      if (!ctx.ownerId) throw new Error("run_in_sandbox requires an owner");

      const spec: SandboxRunSpec = {
        inputs: input.inputs,
        setup: input.setup,
        run: input.run,
        outputs: input.outputs,
        timeoutSec: input.timeoutSec,
      };
      const result = await deps.runner.run(spec, ctx.signal);

      const artifacts: { assetId: string; mime: string; filename: string }[] = [];
      for (const artifact of result.artifacts) {
        const mime = mimeForOutputPath(artifact.path);
        if (!mime) continue; // skip anything not an allowed image
        const filename = artifact.path.split("/").pop() ?? artifact.path;
        const handle = await deps.createAsset({
          ownerId: ctx.ownerId,
          bytes: artifact.bytes,
          mime,
          filename,
          sourceRunId: ctx.taskId,
        });
        artifacts.push(handle);
      }

      return { artifacts, logTail: result.logTail, exitCode: result.exitCode };
    },
    toProgress: (_input, output) => ({
      title: output.artifacts.length
        ? `Rendered ${output.artifacts.length} visual(s)`
        : "Ran a sandbox render",
    }),
  };
}
