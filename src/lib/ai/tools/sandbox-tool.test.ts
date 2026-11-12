// src/lib/ai/tools/sandbox-tool.test.ts
import { describe, expect, it } from "vitest";
import { createSandboxTool } from "./sandbox-tool";
import { FakeSandboxRunner } from "@/lib/ai/sandbox/runner.fake";
import type { CreateAssetFn } from "@/lib/assets/service";

function deps(result = {
  exitCode: 0,
  logTail: "ok",
  artifacts: [{ path: "out/page-1.png", bytes: new Uint8Array([1, 2]) }],
}) {
  const created: { ownerId: string; mime: string; filename: string; sourceRunId: string | undefined }[] = [];
  const createAsset: CreateAssetFn = async (input) => {
    created.push({ ownerId: input.ownerId, mime: input.mime, filename: input.filename, sourceRunId: input.sourceRunId });
    return { assetId: `asset_${created.length}`, mime: input.mime, filename: input.filename };
  };
  const runner = new FakeSandboxRunner(result);
  return { runner, createAsset, created };
}

const baseInput = {
  inputs: [{ path: "main.tex", content: "\\documentclass{article}" }],
  setup: [],
  run: ["tectonic main.tex", "pdftoppm -png main.pdf out/page"],
  outputs: ["out/page-1.png"],
  timeoutSec: 60,
};

describe("run_in_sandbox tool", () => {
  it("runs, stores each artifact as an owner-scoped asset, returns handles", async () => {
    const { runner, createAsset, created } = deps();
    const tool = createSandboxTool({ runner, createAsset, enabled: true });

    const out = (await tool.handler(baseInput, { taskId: "task_9", ownerId: "user_1" })) as {
      artifacts: { assetId: string; mime: string }[];
      exitCode: number;
      logTail: string;
    };

    expect(out.artifacts).toEqual([{ assetId: "asset_1", mime: "image/png", filename: "page-1.png" }]);
    expect(out.exitCode).toBe(0);
    expect(created[0]).toEqual({ ownerId: "user_1", mime: "image/png", filename: "page-1.png", sourceRunId: "task_9" });
    // the runner received a spec whose outputs are under out/
    expect(runner.lastSpec?.outputs).toEqual(["out/page-1.png"]);
  });

  it("rejects an output path that escapes out/ at the input boundary", () => {
    const { runner, createAsset } = deps();
    const tool = createSandboxTool({ runner, createAsset, enabled: true });
    expect(tool.input.safeParse({ ...baseInput, outputs: ["../etc/passwd"] }).success).toBe(false);
    expect(tool.input.safeParse({ ...baseInput, outputs: ["out/../x.png"] }).success).toBe(false);
  });

  it("throws when ownerId is missing (never produce an unowned asset)", async () => {
    const { runner, createAsset } = deps();
    const tool = createSandboxTool({ runner, createAsset, enabled: true });
    await expect(
      Promise.resolve(tool.handler(baseInput, { taskId: "t" })),
    ).rejects.toThrow();
  });

  it("skips an artifact whose extension is not an allowed image", async () => {
    const { runner, createAsset, created } = deps({
      exitCode: 0,
      logTail: "ok",
      artifacts: [{ path: "out/report.pdf", bytes: new Uint8Array([1]) }],
    });
    const tool = createSandboxTool({ runner, createAsset, enabled: true });
    const out = (await tool.handler(
      { ...baseInput, outputs: ["out/report.pdf"] },
      { taskId: "t", ownerId: "u" },
    )) as { artifacts: unknown[] };
    expect(out.artifacts).toHaveLength(0);
    expect(created).toHaveLength(0);
  });

  describe("charging", () => {
    function quota() {
      const settled: string[] = [];
      const released: string[] = [];
      const reserved: string[] = [];
      return {
        settled,
        released,
        reserved,
        quota: {
          reserve: async (ownerId: string) => {
            reserved.push(ownerId);
            let done = false;
            return {
              ok: true as const,
              charge: {
                settle: async () => {
                  done = true;
                  settled.push(ownerId);
                },
                release: async () => {
                  // Like releaseCreditHold: a no-op after a settle.
                  if (!done) released.push(ownerId);
                },
              },
            };
          },
        },
      };
    }

    it("reserves the credits before the run starts, and refuses without them", async () => {
      const { createAsset } = deps();
      const order: string[] = [];
      const runner = {
        run: async () => {
          order.push("run");
          return { exitCode: 0, logTail: "", artifacts: [{ path: "out/a.png", bytes: new Uint8Array([1]) }] };
        },
      };
      const q = quota();
      const reserve = q.quota.reserve;
      const tool = createSandboxTool({
        runner,
        createAsset,
        enabled: true,
        quota: { reserve: async (u: string) => (order.push("reserve"), reserve(u)) },
      });
      await tool.handler(baseInput, { taskId: "t", ownerId: "u" });
      expect(order).toEqual(["reserve", "run"]);

      const broke = createSandboxTool({
        runner,
        createAsset,
        enabled: true,
        quota: { reserve: async () => ({ ok: false as const, reason: "credits" as const }) },
      });
      await expect(Promise.resolve(broke.handler(baseInput, { taskId: "t", ownerId: "u" }))).rejects.toThrow(
        /Not enough credits/,
      );
      const capped = createSandboxTool({
        runner,
        createAsset,
        enabled: true,
        quota: { reserve: async () => ({ ok: false as const, reason: "quota" as const }) },
      });
      await expect(Promise.resolve(capped.handler(baseInput, { taskId: "t", ownerId: "u" }))).rejects.toThrow(
        /Daily rendering limit/,
      );
      expect(order).toEqual(["reserve", "run"]); // neither refused run started
    });

    it("charges a run that delivered an image", async () => {
      const { runner, createAsset } = deps();
      const q = quota();
      const tool = createSandboxTool({ runner, createAsset, enabled: true, quota: q.quota });
      await tool.handler(baseInput, { taskId: "t", ownerId: "u" });
      expect(q.settled).toEqual(["u"]);
      expect(q.released).toEqual([]);
    });

    it("does not charge a run that failed and produced nothing", async () => {
      const { runner, createAsset } = deps({ exitCode: 1, logTail: "error", artifacts: [] });
      const q = quota();
      const tool = createSandboxTool({ runner, createAsset, enabled: true, quota: q.quota });
      const out = (await tool.handler(baseInput, { taskId: "t", ownerId: "u" })) as { exitCode: number };
      expect(out.exitCode).toBe(1);
      expect(q.settled).toEqual([]);
      // The reserved credits go back.
      expect(q.released).toEqual(["u"]);
    });

    it("does not charge a run whose only output is not an allowed image", async () => {
      const { runner, createAsset } = deps({
        exitCode: 0,
        logTail: "ok",
        artifacts: [{ path: "out/report.pdf", bytes: new Uint8Array([1]) }],
      });
      const q = quota();
      const tool = createSandboxTool({ runner, createAsset, enabled: true, quota: q.quota });
      await tool.handler({ ...baseInput, outputs: ["out/report.pdf"] }, { taskId: "t", ownerId: "u" });
      expect(q.settled).toEqual([]);
      // The reserved credits go back.
      expect(q.released).toEqual(["u"]);
    });

    it("does not charge a run that threw", async () => {
      const { createAsset } = deps();
      const q = quota();
      const runner = { run: async () => { throw new Error("timeout"); } };
      const tool = createSandboxTool({ runner, createAsset, enabled: true, quota: q.quota });
      await expect(
        Promise.resolve(tool.handler(baseInput, { taskId: "t", ownerId: "u" })),
      ).rejects.toThrow("timeout");
      expect(q.settled).toEqual([]);
      // The reserved credits go back.
      expect(q.released).toEqual(["u"]);
    });
  });
});
