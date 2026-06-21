import "server-only";
import { Daytona } from "@daytona/sdk";
import type { SandboxArtifact, SandboxRunResult, SandboxRunSpec, SandboxRunner } from "./runner";

const LOG_TAIL_MAX = 4_000;

/**
 * Real SandboxRunner backed by Daytona. Ephemeral per call: create → write only
 * the agent-authored inputs (never workspace data or secrets) → run → download
 * declared outputs → destroy. Egress is Daytona's network; the container holds
 * nothing sensitive.
 */
export class DaytonaSandboxRunner implements SandboxRunner {
  private client = new Daytona({ apiKey: process.env.DAYTONA_API_KEY });

  async run(spec: SandboxRunSpec, signal?: AbortSignal): Promise<SandboxRunResult> {
    // ephemeral + auto-stop is the crash backstop: a leaked container still dies.
    const sandbox = await this.client.create({
      snapshot: process.env.STUDYOS_SANDBOX_SNAPSHOT, // prebuilt image w/ toolchains
      ephemeral: true,
      autoStopInterval: Math.max(1, Math.ceil(spec.timeoutSec / 60)),
    });

    let log = "";
    let exitCode = 0;
    const artifacts: SandboxArtifact[] = [];
    try {
      await sandbox.process.executeCommand("mkdir -p /work/out");
      for (const file of spec.inputs) {
        await sandbox.fs.uploadFile(Buffer.from(file.content), `/work/${file.path}`);
      }
      for (const cmd of [...spec.setup, ...spec.run]) {
        if (signal?.aborted) throw new Error("aborted");
        const res = await sandbox.process.executeCommand(`cd /work && ${cmd}`);
        log += `$ ${cmd}\n${res.result ?? ""}\n`;
        exitCode = res.exitCode ?? 0;
        if (exitCode !== 0) break; // stop on first failure; report it
      }
      if (exitCode === 0) {
        for (const out of spec.outputs) {
          // downloadFile returns Promise<Buffer>; Buffer extends Uint8Array in Node,
          // so new Uint8Array(data) copies into a plain Uint8Array to satisfy SandboxArtifact.
          const data = await sandbox.fs.downloadFile(`/work/${out}`);
          artifacts.push({ path: out, bytes: new Uint8Array(data) });
        }
      }
    } finally {
      await sandbox.delete().catch(() => {}); // best-effort; auto-stop is the backstop
    }

    return { exitCode, logTail: log.slice(-LOG_TAIL_MAX), artifacts };
  }
}
