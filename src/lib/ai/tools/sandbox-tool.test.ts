// src/lib/ai/tools/sandbox-tool.test.ts
import { describe, expect, it } from "vitest";
import { createSandboxTool, RENDER_UNAVAILABLE } from "./sandbox-tool";
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
  run: ["pdflatex -interaction=nonstopmode -halt-on-error -no-shell-escape main.tex", "pdftoppm -png main.pdf out/page"],
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

describe("run_in_sandbox: renders counted toward the agent turn's cap", () => {
  it("tallies a delivered render under its task, once, and nothing for a failed one", async () => {
    const { takeSandboxCreditsCharged } = await import("./sandbox-tool");
    const charge = { settle: async () => {}, release: async () => {} };
    const quota = { reserve: async () => ({ ok: true as const, charge }) };
    const ok = deps();
    await createSandboxTool({ ...ok, enabled: true, quota }).handler(baseInput, { taskId: "t_tally", ownerId: "u" });
    const failed = deps({ exitCode: 1, logTail: "error", artifacts: [] });
    await createSandboxTool({ ...failed, enabled: true, quota }).handler(baseInput, { taskId: "t_tally", ownerId: "u" });
    expect(takeSandboxCreditsCharged("t_tally")).toBe(2);
    expect(takeSandboxCreditsCharged("t_tally")).toBe(0);
  });
});

describe("run_in_sandbox: offline only, and failures that say what to do", () => {
  function counting() {
    const calls = { reserve: 0, settle: 0, release: 0 };
    return {
      calls,
      quota: {
        reserve: async () => {
          calls.reserve += 1;
          return {
            ok: true as const,
            charge: { settle: async () => void (calls.settle += 1), release: async () => void (calls.release += 1) },
          };
        },
      },
    };
  }
  const ok = { exitCode: 0, logTail: "", artifacts: [{ path: "out/a.png", bytes: new Uint8Array([1]) }] };

  it.each([
    ["apt-get install -y texlive"],
    ["pip install matplotlib"],
    ["python3 -m pip install numpy"],
    ["npm install -g @mermaid-js/mermaid-cli"],
    ["tectonic main.tex"],
    ["tlmgr install siunitx"],
    ["curl -O https://example.com/x.sty"],
  ])("refuses %s before reserving anything or starting a sandbox", async (command) => {
    const { createAsset } = deps();
    let ran = false;
    const runner = { run: async () => ((ran = true), ok) };
    const q = counting();
    const tool = createSandboxTool({ runner, createAsset, enabled: true, quota: q.quota });
    await expect(
      Promise.resolve(tool.handler({ ...baseInput, setup: [command] }, { taskId: "t", ownerId: "u" })),
    ).rejects.toThrow(/no network and nothing can be installed.*Nothing was charged/);
    expect(q.calls.reserve).toBe(0);
    expect(ran).toBe(false);
  });

  it("does not refuse the offline toolchain's own commands", async () => {
    const { createAsset } = deps();
    const q = counting();
    const tool = createSandboxTool({ runner: { run: async () => ok }, createAsset, enabled: true, quota: q.quota });
    const input = {
      ...baseInput,
      run: ["python3 plot.py", "dot -Tpng -Gdpi=200 graph.dot -o out/a.png", "xelatex -no-shell-escape cjk.tex"],
      outputs: ["out/a.png"],
    };
    await tool.handler(input, { taskId: "t", ownerId: "u" });
    expect(q.calls).toEqual({ reserve: 1, settle: 1, release: 1 });
  });

  it("while the image lacks the toolchain, refuses before reserving, with a message the agent can pass on", async () => {
    const { createAsset } = deps();
    const q = counting();
    const runner = { available: () => false, run: async () => ok };
    const tool = createSandboxTool({ runner, createAsset, enabled: true, quota: q.quota });
    await expect(Promise.resolve(tool.handler(baseInput, { taskId: "t", ownerId: "u" }))).rejects.toThrow(RENDER_UNAVAILABLE);
    expect(q.calls.reserve).toBe(0);
  });

  it("meeting an outdated image mid-run gives the credits back and says rendering is unavailable", async () => {
    const { createAsset } = deps();
    const q = counting();
    const outdated = Object.assign(new Error("old image"), { name: "SandboxImageOutdatedError" });
    const runner = { run: async () => { throw outdated; } };
    const tool = createSandboxTool({ runner, createAsset, enabled: true, quota: q.quota });
    await expect(Promise.resolve(tool.handler(baseInput, { taskId: "t", ownerId: "u" }))).rejects.toThrow(RENDER_UNAVAILABLE);
    expect(q.calls).toEqual({ reserve: 1, settle: 0, release: 1 });
  });

  it("a render that failed returns its log and a note: not charged, fix once or tell the student", async () => {
    const { createAsset } = deps();
    const q = counting();
    const runner = { run: async () => ({ exitCode: 1, logTail: "! Undefined control sequence.", artifacts: [] }) };
    const tool = createSandboxTool({ runner, createAsset, enabled: true, quota: q.quota });
    const out = (await tool.handler(baseInput, { taskId: "t", ownerId: "u" })) as { note?: string; logTail: string };
    expect(out.logTail).toContain("Undefined control sequence");
    expect(out.note).toMatch(/failed \(exit code 1\) and was not charged/);
    expect(out.note).toMatch(/tell the student/);
    expect(q.calls.settle).toBe(0);
  });
});
