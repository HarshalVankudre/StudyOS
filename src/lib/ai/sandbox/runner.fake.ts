import type { SandboxRunner, SandboxRunResult, SandboxRunSpec } from "./runner";

/** Deterministic SandboxRunner for tests — records the spec, returns a result. */
export class FakeSandboxRunner implements SandboxRunner {
  lastSpec?: SandboxRunSpec;
  constructor(private result: SandboxRunResult) {}
  async run(spec: SandboxRunSpec): Promise<SandboxRunResult> {
    this.lastSpec = spec;
    return this.result;
  }
}
