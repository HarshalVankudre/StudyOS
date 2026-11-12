// src/lib/ai/tools/sandbox-tool.ts
import { z } from "zod";
import { isImageOutdatedError, type SandboxRunner, type SandboxRunSpec } from "@/lib/ai/sandbox/runner";
import { networkCommand, RENDER_COMMANDS } from "@/lib/ai/sandbox/toolchain";
import type { CreateAssetFn } from "@/lib/assets/service";
import { mimeForOutputPath } from "@/lib/assets/mime";
import { RENDER_CREDITS as SANDBOX_RUN_CREDITS } from "@/lib/price-list";
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
  /** For a run that delivered no image: what to do next (it was not charged). */
  note: z.string().optional(),
});

/** Said to the agent when rendering cannot work right now (nothing was charged). */
export const RENDER_UNAVAILABLE =
  "Rendering is unavailable right now (the render tools are being updated). Nothing was charged. Do not retry: tell the student the visual couldn't be rendered and give the content another way (an equation as $…$ math in a text block, a plot as a short table or description).";

/** A run that needs the network or an install: refused before anything is reserved. */
function networkRefusal(command: string): string {
  return `The render sandbox has no network and nothing can be installed, so "${command.slice(0, 80)}" cannot run. Nothing was charged. Use only the preinstalled offline tools (${RENDER_COMMANDS.join(", ")}, Python matplotlib/numpy, TeX Live) and try once more, or give the content another way.`;
}

/** A finished run that produced no image (not charged). */
function failedRenderNote(exitCode: number): string {
  return `The render ${exitCode !== 0 ? `failed (exit code ${exitCode})` : "produced no usable image"} and was not charged. Read the log once and fix a mistake in your own source; if it fails again, do not retry: tell the student the visual couldn't be rendered and give the content another way.`;
}

/**
 * Credits charged for renders, per agent task, so the turn's own charge can
 * keep the whole turn within the plan's per-message cap (lib/ai/
 * agent-charging.ts). The turn and its tool calls run in one process.
 *
 * Once the turn is settled its tally is closed with the room left under the
 * cap. A render that finishes after that (the turn was cancelled while it
 * ran) is charged only if it still fits; otherwise its reserved credits are
 * given back, so a late render can never push the turn past the cap.
 */
interface RenderTally {
  charged: number;
  /** Set once the turn is settled: credits renders may still be charged. */
  room?: number;
  closedAt?: number;
}
const tallies = new Map<string, RenderTally>();
/** Closed tallies are kept this long for late renders (longer than any run). */
const CLOSED_TALLY_TTL_MS = 10 * 60 * 1000;

/** The credits this task's renders were charged so far. */
export function takeSandboxCreditsCharged(taskId: string): number {
  const tally = tallies.get(taskId);
  if (!tally || tally.room !== undefined) return 0;
  tallies.delete(taskId);
  return tally.charged;
}

/**
 * Close a settled turn's tally: renders finishing later may be charged at
 * most `room` credits in all (Infinity when the turn has no cap).
 */
export function closeSandboxTally(taskId: string, room: number): void {
  const now = Date.now();
  for (const [id, t] of tallies) {
    if (t.closedAt !== undefined && now - t.closedAt > CLOSED_TALLY_TTL_MS) tallies.delete(id);
  }
  if (room === Infinity) {
    tallies.delete(taskId);
    return;
  }
  tallies.set(taskId, { charged: 0, room: Math.max(0, room), closedAt: now });
}

/**
 * Whether a render that delivered may be charged, recording it if so.
 * Synchronous, so two renders finishing together cannot both take the room.
 */
function claimRenderCharge(taskId: string): boolean {
  const tally = tallies.get(taskId) ?? { charged: 0 };
  if (tally.room !== undefined) {
    if (tally.room < SANDBOX_RUN_CREDITS) return false;
    tally.room -= SANDBOX_RUN_CREDITS;
    return true;
  }
  tally.charged += SANDBOX_RUN_CREDITS;
  tallies.set(taskId, tally);
  return true;
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
      "Run a render toolchain in an isolated, network-blocked sandbox to produce IMAGE artifacts (PNG/SVG): compile LaTeX, plot with matplotlib, draw a Graphviz diagram. Only the preinstalled offline tools exist (" +
      RENDER_COMMANDS.join(", ") +
      "); nothing can be downloaded or installed. Write source via `inputs`, `run` the commands that write files under out/, and list those files in `outputs` (`setup` is for preparatory commands, never installs). Returns asset handles; then add a media block per artifact with set_page_blocks referencing the assetId. Never returns file bytes. A failed render is not charged.",
    input: sandboxInput,
    output: sandboxOutput,
    limits: { timeoutMs: (TIMEOUT_MAX + 20) * 1000 },
    networkPermission: "allowlisted", // calls the Daytona API host (fixed config, not model-controlled)
    enabled: deps.enabled,
    handler: async (input, ctx) => {
      if (!ctx.ownerId) throw new Error("run_in_sandbox requires an owner");
      // Refused before any credits or quota are reserved, or a sandbox
      // started: what cannot work offline, and an image without the tools.
      const blocked = networkCommand([...input.setup, ...input.run]);
      if (blocked) throw new Error(networkRefusal(blocked));
      if (deps.runner.available && !deps.runner.available()) throw new Error(RENDER_UNAVAILABLE);

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
      } catch (error) {
        // An image without the offline toolchain: one clear log line was
        // written by the runner; the agent gets something it can act on.
        if (isImageOutdatedError(error)) throw new Error(RENDER_UNAVAILABLE);
        throw error;
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
    // A render finishing after its turn was settled is charged only within
    // the room left under the turn's cap; otherwise the caller's finally
    // releases the reservation.
    if (artifacts.length > 0 && charge && claimRenderCharge(ctx.taskId)) {
      // Charged even when this settle fails: the hold records the charge
      // first and the credits layer completes it later (lib/credits.ts).
      await charge.settle().catch(() => {});
    }

    return {
      artifacts,
      logTail: result.logTail,
      exitCode: result.exitCode,
      ...(artifacts.length === 0 ? { note: failedRenderNote(result.exitCode) } : {}),
    };
  }
}
