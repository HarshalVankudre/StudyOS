import "server-only";
import { Daytona } from "@daytona/sdk";
import type { SandboxArtifact, SandboxRunResult, SandboxRunSpec, SandboxRunner } from "./runner";

const LOG_TAIL_MAX = 4_000;
/** Ceiling for a single shell command, whatever the spec asks for. */
export const PER_COMMAND_TIMEOUT_SEC = 120;
/** Budget for sandbox creation (snapshot start). */
export const CREATE_TIMEOUT_SEC = 60;
/** Budget for each file upload/download. */
export const FILE_TIMEOUT_SEC = 30;
/** Budget for the delete call itself. */
export const DELETE_TIMEOUT_SEC = 30;

/** The slice of the Daytona SDK this runner uses (lets tests pass a fake). */
export interface DaytonaSandboxLike {
  process: {
    executeCommand(
      command: string,
      cwd?: string,
      env?: Record<string, string>,
      timeout?: number,
    ): Promise<{ exitCode?: number; result?: string }>;
  };
  fs: {
    uploadFile(file: Buffer, remotePath: string, timeout?: number): Promise<void>;
    downloadFile(remotePath: string, timeout?: number): Promise<Buffer>;
  };
  delete(timeout?: number): Promise<void>;
}

export interface DaytonaClientLike {
  create(
    params: {
      snapshot?: string;
      ephemeral?: boolean;
      autoStopInterval?: number;
      networkBlockAll?: boolean;
      networkAllowList?: string;
    },
    options?: { timeout?: number },
  ): Promise<DaytonaSandboxLike>;
}

const CIDR = /^(\d{1,3})(\.\d{1,3}){3}\/(\d|[12]\d|3[0-2])$/;

/**
 * Network policy for a sandbox. Default: ALL network blocked. The render
 * toolchain is preinstalled in the snapshot, so a typical render needs none.
 * STUDYOS_SANDBOX_NETWORK_ALLOWLIST (comma-separated IPv4 CIDRs) opens only
 * those ranges, e.g. for a package mirror; invalid entries are ignored.
 */
export function sandboxNetworkPolicy(
  allowlist = process.env.STUDYOS_SANDBOX_NETWORK_ALLOWLIST,
): { networkBlockAll: true } | { networkBlockAll: false; networkAllowList: string } {
  const cidrs = (allowlist ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => CIDR.test(s) && s.split(/[./]/).slice(0, 4).every((o) => Number(o) <= 255));
  if (cidrs.length === 0) return { networkBlockAll: true };
  return { networkBlockAll: false, networkAllowList: cidrs.join(",") };
}

export class SandboxTimeoutError extends Error {}

/**
 * Real SandboxRunner backed by Daytona. Ephemeral per call: create → write only
 * the agent-authored inputs (never workspace data or secrets) → run → download
 * declared outputs → destroy.
 *
 * Hardening: network blocked by default (see sandboxNetworkPolicy); every
 * command has its own timeout and all commands share the spec's total budget;
 * an overall wall-clock deadline and the caller's AbortSignal end the run; and
 * the sandbox is deleted on every exit path, including a create that finishes
 * after the run was already abandoned.
 */
export class DaytonaSandboxRunner implements SandboxRunner {
  private client: DaytonaClientLike;

  constructor(client?: DaytonaClientLike) {
    this.client =
      client ??
      (new Daytona({ apiKey: process.env.DAYTONA_API_KEY }) as unknown as DaytonaClientLike);
  }

  async run(spec: SandboxRunSpec, signal?: AbortSignal): Promise<SandboxRunResult> {
    if (signal?.aborted) throw new Error("aborted");

    const commandBudgetMs = spec.timeoutSec * 1000;
    // Whole run: create + uploads + commands + downloads.
    const wallClockMs = commandBudgetMs + (CREATE_TIMEOUT_SEC + 2 * FILE_TIMEOUT_SEC) * 1000;

    let abandoned = false;
    const state: { sandbox: DaytonaSandboxLike | null } = { sandbox: null };
    const destroy = async (sb: DaytonaSandboxLike) => {
      await sb.delete(DELETE_TIMEOUT_SEC).catch(() => {}); // ephemeral + auto-stop is the backstop
    };

    let timer: ReturnType<typeof setTimeout> | undefined;
    let onAbort: (() => void) | undefined;
    const stop = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new SandboxTimeoutError(`sandbox run exceeded ${Math.round(wallClockMs / 1000)}s`)),
        wallClockMs,
      );
      onAbort = () => reject(new Error("aborted"));
      signal?.addEventListener("abort", onAbort, { once: true });
    });
    stop.catch(() => {}); // handled by the race below

    const work = async (): Promise<SandboxRunResult> => {
      const created = this.client.create(
        {
          snapshot: process.env.STUDYOS_SANDBOX_SNAPSHOT, // prebuilt image w/ toolchains
          ephemeral: true,
          autoStopInterval: Math.max(1, Math.ceil(wallClockMs / 60_000)),
          ...sandboxNetworkPolicy(),
        },
        { timeout: CREATE_TIMEOUT_SEC },
      );
      // If the run is abandoned while creation is in flight, delete the sandbox
      // as soon as it exists.
      void created.then((sb) => {
        if (abandoned) void destroy(sb);
      }, () => {});
      const sb = await created;
      state.sandbox = sb;
      if (abandoned) throw new Error("aborted");

      const deadline = Date.now() + commandBudgetMs;
      const commandTimeout = () => {
        const remainingSec = Math.floor((deadline - Date.now()) / 1000);
        if (remainingSec < 1) throw new SandboxTimeoutError("sandbox command budget exhausted");
        return Math.min(PER_COMMAND_TIMEOUT_SEC, remainingSec);
      };
      const check = () => {
        if (abandoned || signal?.aborted) throw new Error("aborted");
      };

      let log = "";
      let exitCode = 0;
      const artifacts: SandboxArtifact[] = [];
      // Paths are relative to the sandbox user's home dir, which is writable and
      // is also the default cwd for executeCommand. An absolute "/work" is NOT
      // writable by the non-root sandbox user (mkdir → permission denied).
      await sb.process.executeCommand("mkdir -p out", undefined, undefined, commandTimeout());
      for (const file of spec.inputs) {
        check();
        await sb.fs.uploadFile(Buffer.from(file.content), file.path, FILE_TIMEOUT_SEC);
      }
      for (const cmd of [...spec.setup, ...spec.run]) {
        check();
        const res = await sb.process.executeCommand(cmd, undefined, undefined, commandTimeout());
        log += `$ ${cmd}\n${res.result ?? ""}\n`;
        exitCode = res.exitCode ?? 0;
        if (exitCode !== 0) break; // stop on first failure; report it
      }
      if (exitCode === 0) {
        for (const out of spec.outputs) {
          check();
          // downloadFile returns Promise<Buffer>; copy into a plain Uint8Array.
          const data = await sb.fs.downloadFile(out, FILE_TIMEOUT_SEC);
          artifacts.push({ path: out, bytes: new Uint8Array(data) });
        }
      }
      return { exitCode, logTail: log.slice(-LOG_TAIL_MAX), artifacts };
    };

    try {
      const running = work();
      running.catch(() => {}); // a run that lost the race must not surface as unhandled
      return await Promise.race([running, stop]);
    } finally {
      abandoned = true;
      clearTimeout(timer);
      if (onAbort) signal?.removeEventListener("abort", onAbort);
      if (state.sandbox) await destroy(state.sandbox);
    }
  }
}
