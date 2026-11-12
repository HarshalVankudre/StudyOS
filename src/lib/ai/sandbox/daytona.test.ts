import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@daytona/sdk", () => ({
  Daytona: class {
    constructor() {
      throw new Error("the real Daytona client must not be built in tests");
    }
  },
}));
const reported = vi.hoisted(() => vi.fn());
vi.mock("@/lib/ops/report-error", () => ({ reportError: reported }));

import {
  CREATE_TIMEOUT_SEC,
  DaytonaSandboxRunner,
  OUTDATED_IMAGE_RECHECK_MS,
  PER_COMMAND_TIMEOUT_SEC,
  resetSandboxImageCheck,
  SandboxImageOutdatedError,
  SandboxTimeoutError,
  sandboxNetworkPolicy,
  type DaytonaClientLike,
  type DaytonaSandboxLike,
} from "./daytona";
import type { SandboxRunSpec } from "./runner";
import { PREPARE_COMMAND, RENDER_IMAGE_VERSION } from "./toolchain";

/** What an image with the current offline toolchain answers to the first command. */
const CURRENT_IMAGE = { exitCode: 0, result: `studyos-render-image ${RENDER_IMAGE_VERSION}\n` };

const SPEC: SandboxRunSpec = {
  inputs: [{ path: "main.tex", content: "x" }],
  setup: [],
  run: ["pdflatex main.tex", "pdftoppm -png main.pdf out/page"],
  outputs: ["out/page-1.png"],
  timeoutSec: 90,
};

function fakeSandbox(overrides: Partial<{ exec: DaytonaSandboxLike["process"]["executeCommand"] }> = {}) {
  const sandbox = {
    process: {
      executeCommand: vi.fn(
        overrides.exec ??
          (async (cmd: string) => (cmd === PREPARE_COMMAND ? CURRENT_IMAGE : { exitCode: 0, result: "ok" })),
      ),
    },
    fs: {
      uploadFile: vi.fn(async () => {}),
      downloadFile: vi.fn(async () => Buffer.from([1, 2, 3])),
    },
    delete: vi.fn(async () => {}),
  };
  return sandbox;
}

function fakeClient(sandbox: DaytonaSandboxLike | Promise<DaytonaSandboxLike>) {
  const create = vi.fn(async () => sandbox);
  return { client: { create } as unknown as DaytonaClientLike, create };
}

afterEach(() => {
  vi.useRealTimers();
  resetSandboxImageCheck();
  reported.mockReset();
  delete process.env.STUDYOS_SANDBOX_NETWORK_ALLOWLIST;
});

describe("sandboxNetworkPolicy", () => {
  it("blocks all network by default", () => {
    expect(sandboxNetworkPolicy(undefined)).toEqual({ networkBlockAll: true });
    expect(sandboxNetworkPolicy("")).toEqual({ networkBlockAll: true });
  });

  it("opens only valid CIDRs from the allowlist", () => {
    expect(sandboxNetworkPolicy("140.82.112.0/20, nonsense, 999.1.1.1/8, 10.0.0.0/33")).toEqual({
      networkBlockAll: false,
      networkAllowList: "140.82.112.0/20",
    });
    expect(sandboxNetworkPolicy("bad")).toEqual({ networkBlockAll: true });
  });
});

describe("DaytonaSandboxRunner", () => {
  it("creates a network-blocked ephemeral sandbox, applies timeouts, and deletes it", async () => {
    const sb = fakeSandbox();
    const { client, create } = fakeClient(sb);
    const result = await new DaytonaSandboxRunner(client).run(SPEC);

    expect(result.exitCode).toBe(0);
    expect(result.artifacts).toEqual([{ path: "out/page-1.png", bytes: new Uint8Array([1, 2, 3]) }]);
    const [params, options] = create.mock.calls[0] as unknown as [Record<string, unknown>, { timeout: number }];
    expect(params).toMatchObject({ ephemeral: true, networkBlockAll: true });
    expect(params).not.toHaveProperty("networkAllowList");
    expect(options.timeout).toBe(CREATE_TIMEOUT_SEC);
    // Every command carries a timeout no larger than the per-command ceiling or the total budget.
    for (const call of sb.process.executeCommand.mock.calls) {
      const timeout = (call as unknown[])[3] as number;
      expect(timeout).toBeGreaterThan(0);
      expect(timeout).toBeLessThanOrEqual(Math.min(PER_COMMAND_TIMEOUT_SEC, SPEC.timeoutSec));
    }
    expect(sb.delete).toHaveBeenCalledTimes(1);
  });

  it("passes the configured allowlist instead of blocking everything", async () => {
    process.env.STUDYOS_SANDBOX_NETWORK_ALLOWLIST = "151.101.0.0/16";
    const sb = fakeSandbox();
    const { client, create } = fakeClient(sb);
    await new DaytonaSandboxRunner(client).run(SPEC);
    expect((create.mock.calls[0] as unknown[])[0]).toMatchObject({
      networkBlockAll: false,
      networkAllowList: "151.101.0.0/16",
    });
  });

  it("stops at the first failing command, skips downloads, and still deletes", async () => {
    const sb = fakeSandbox({
      exec: async (cmd) =>
        cmd === PREPARE_COMMAND ? CURRENT_IMAGE : cmd.startsWith("pdflatex") ? { exitCode: 1, result: "error" } : { exitCode: 0 },
    });
    const result = await new DaytonaSandboxRunner(fakeClient(sb).client).run(SPEC);
    expect(result.exitCode).toBe(1);
    expect(sb.fs.downloadFile).not.toHaveBeenCalled();
    expect(sb.delete).toHaveBeenCalledTimes(1);
  });

  it("deletes the sandbox when a step throws", async () => {
    const sb = fakeSandbox();
    sb.fs.uploadFile.mockRejectedValue(new Error("upload failed"));
    await expect(new DaytonaSandboxRunner(fakeClient(sb).client).run(SPEC)).rejects.toThrow("upload failed");
    expect(sb.delete).toHaveBeenCalledTimes(1);
  });

  it("aborts a hung command on the caller's signal and deletes the sandbox", async () => {
    const sb = fakeSandbox({ exec: (cmd) => (cmd === PREPARE_COMMAND ? Promise.resolve(CURRENT_IMAGE) : new Promise(() => {})) });
    const controller = new AbortController();
    const run = new DaytonaSandboxRunner(fakeClient(sb).client).run(SPEC, controller.signal);
    await vi.waitFor(() => expect(sb.process.executeCommand).toHaveBeenCalledTimes(2));
    controller.abort();
    await expect(run).rejects.toThrow("aborted");
    expect(sb.delete).toHaveBeenCalledTimes(1);
  });

  it("enforces the total wall-clock budget", async () => {
    vi.useFakeTimers();
    const sb = fakeSandbox({ exec: (cmd) => (cmd === PREPARE_COMMAND ? Promise.resolve(CURRENT_IMAGE) : new Promise(() => {})) });
    const run = new DaytonaSandboxRunner(fakeClient(sb).client).run({ ...SPEC, timeoutSec: 10 });
    const settled = expect(run).rejects.toBeInstanceOf(SandboxTimeoutError);
    await vi.advanceTimersByTimeAsync(10_000 + 200_000);
    await settled;
    expect(sb.delete).toHaveBeenCalledTimes(1);
  });

  it("deletes a sandbox whose creation finishes after the run was abandoned", async () => {
    const sb = fakeSandbox();
    let resolveCreate!: (s: DaytonaSandboxLike) => void;
    const pending = new Promise<DaytonaSandboxLike>((r) => (resolveCreate = r));
    const client = { create: vi.fn(() => pending) } as unknown as DaytonaClientLike;
    const controller = new AbortController();
    const run = new DaytonaSandboxRunner(client).run(SPEC, controller.signal);
    controller.abort();
    await expect(run).rejects.toThrow("aborted");
    expect(sb.delete).not.toHaveBeenCalled();
    resolveCreate(sb);
    await vi.waitFor(() => expect(sb.delete).toHaveBeenCalledTimes(1));
    expect(sb.process.executeCommand).not.toHaveBeenCalled();
  });

  it("refuses an image without the offline toolchain before any agent command, logs once, then stops starting sandboxes", async () => {
    const old = fakeSandbox({ exec: async () => ({ exitCode: 0, result: "" }) }); // no version marker
    const { client, create } = fakeClient(old);
    const runner = new DaytonaSandboxRunner(client);
    expect(runner.available()).toBe(true);
    await expect(runner.run(SPEC)).rejects.toBeInstanceOf(SandboxImageOutdatedError);
    // Only the prepare command ran; nothing the agent wrote, no downloads; deleted.
    expect(old.process.executeCommand).toHaveBeenCalledTimes(1);
    expect(old.process.executeCommand.mock.calls[0][0]).toBe(PREPARE_COMMAND);
    expect(old.fs.uploadFile).not.toHaveBeenCalled();
    expect(old.delete).toHaveBeenCalledTimes(1);
    // One clear log line for the owner, naming the fix.
    expect(reported).toHaveBeenCalledTimes(1);
    const [error, context] = reported.mock.calls[0];
    expect(String((error as Error).message)).toMatch(/render toolchain none, needs v\d+.*build-snapshot\.mjs/);
    expect(context).toMatchObject({ source: "sandbox" });
    // Renders stay off for a while: no sandbox is created for them.
    expect(runner.available()).toBe(false);
    await expect(runner.run(SPEC)).rejects.toBeInstanceOf(SandboxImageOutdatedError);
    expect(create).toHaveBeenCalledTimes(1);
    expect(reported).toHaveBeenCalledTimes(1);
  });

  it("rechecks the image later, so a rebuilt snapshot is picked up without a redeploy", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const old = fakeSandbox({ exec: async () => ({ exitCode: 0, result: "studyos-render-image 1" }) });
    await expect(new DaytonaSandboxRunner(fakeClient(old).client).run(SPEC)).rejects.toBeInstanceOf(SandboxImageOutdatedError);
    vi.setSystemTime(Date.now() + OUTDATED_IMAGE_RECHECK_MS + 1);
    const rebuilt = new DaytonaSandboxRunner(fakeClient(fakeSandbox()).client);
    expect(rebuilt.available()).toBe(true);
    expect((await rebuilt.run(SPEC)).exitCode).toBe(0);
  });
});
