/** A spec the trusted server hands to an isolated sandbox. */
export interface SandboxRunSpec {
  inputs: { path: string; content: string }[];
  setup: string[];
  run: string[];
  /** Declared output files to return; each MUST live under `out/`. */
  outputs: string[];
  timeoutSec: number;
}

export interface SandboxArtifact {
  path: string;
  bytes: Uint8Array;
}

export interface SandboxRunResult {
  exitCode: number;
  logTail: string;
  artifacts: SandboxArtifact[];
}

export interface SandboxRunner {
  run(spec: SandboxRunSpec, signal?: AbortSignal): Promise<SandboxRunResult>;
  /**
   * False when renders cannot work right now (the sandbox image lacks the
   * offline toolchain): the tool then refuses before reserving anything.
   */
  available?(): boolean;
}

/** Thrown by a runner whose sandbox image lacks the offline render toolchain. */
export function isImageOutdatedError(error: unknown): boolean {
  return error instanceof Error && error.name === "SandboxImageOutdatedError";
}
