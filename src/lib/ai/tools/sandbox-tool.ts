// src/lib/ai/tools/sandbox-tool.ts
import { z } from "zod";
import type { SandboxRunner, SandboxRunSpec } from "@/lib/ai/sandbox/runner";
import type { CreateAssetFn } from "@/lib/assets/service";
import { mimeForOutputPath } from "@/lib/assets/mime";
import { SANDBOX_RUN_CREDITS } from "@/lib/credits-info";
import type { ToolContext, ToolDefinition } from "./registry";

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

/**
 * Credits charged for renders, per agent task, so the turn's own charge can
 * keep the whole turn within the plan's per-message cap (lib/ai/
 * agent-charging.ts). The turn and its tool calls run in one process.
 */
const chargedByTask = new Map<string, number>();

/** The credits this task's renders were charged, once (the entry is removed). */
export function takeSandboxCreditsCharged(taskId: string): number {
  const charged = chargedByTask.get(taskId) ?? 0;
  chargedByTask.delete(taskId);
  return charged;
}

/** A run's reserved credits: charge them (the run delivered) or give them back. */
export interface SandboxCharge {
  settle: () => Promise<void>;
  release: () => Promise<void>;
}

/**
 * The cost guard: `reserve` runs before a run and either reserves the run's
 * credits (and a daily-quota slot) or refuses, saying why.
 */
export interface SandboxQuota {
  reserve: (
    ownerId: string,
  ) => Promise<{ ok: true; charge: SandboxCharge } | { ok: false; reason: "credits" | "quota" }>;
}

export function createSandboxTool(deps: {
  runner: SandboxRunner;
  createAsset: CreateAssetFn;
  enabled: boolean;
  /**
   * Optional cost guard (see SandboxQuota): the credits are reserved BEFORE
   * the run, so parallel runs cannot all start on the same credits, then
   * settled when the run delivered an image and released otherwise.
   */
  quota?: SandboxQuota;
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

      let charge: SandboxCharge | null = null;
      if (deps.quota) {
        const reserved = await deps.quota.reserve(ctx.ownerId);
        if (!reserved.ok) {
          throw new Error(
            reserved.reason === "credits"
              ? "Not enough credits to render — let the user know instead of retrying."
              : "Daily rendering limit reached — this resets tomorrow. Let the user know instead of retrying.",
          );
        }
        charge = reserved.charge;
      }
      try {
        return await runAndStore(input, ctx, ctx.ownerId, charge);
      } finally {
        // A run that was not charged (it threw, or delivered nothing) gives
        // its credits back. A no-op after a settle.
        await charge?.release().catch(() => {});
      }
    },
    toProgress: (_input, output) => ({
      title: output.artifacts.length
        ? `Rendered ${output.artifacts.length} visual(s)`
        : "Ran a sandbox render",
    }),
  };

  async function runAndStore(
    input: z.infer<typeof sandboxInput>,
    ctx: ToolContext,
    ownerId: string,
    charge: SandboxCharge | null,
  ): Promise<z.infer<typeof sandboxOutput>> {
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
        ownerId,
        bytes: artifact.bytes,
        mime,
        filename,
        sourceRunId: ctx.taskId,
      });
      artifacts.push(handle);
    }

    // Charge only a run that delivered at least one image. A run that throws
    // (timeout, infra error), exits without writing its outputs, or produced
    // nothing usable is not billed: we don't charge for failed renders. The
    // daily quota was already consumed by the reservation, which bounds how
    // many failed runs anyone can provoke.
    if (artifacts.length > 0 && charge) {
      // Charged even when this settle fails: the hold records the charge
      // first and the credits layer completes it later (lib/credits.ts).
      await charge.settle().catch(() => {});
      chargedByTask.set(ctx.taskId, (chargedByTask.get(ctx.taskId) ?? 0) + SANDBOX_RUN_CREDITS);
    }

    return { artifacts, logTail: result.logTail, exitCode: result.exitCode };
  }
}
