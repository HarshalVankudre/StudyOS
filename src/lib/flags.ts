/**
 * Runtime feature flags.
 *
 * `AGENT_SANDBOX` turns on the render sandbox tool (Daytona, network blocked).
 * Off unless set; the public deployment sets it (cloudbuild.yaml). Its
 * containment, limits and residual risk: infra/sandbox/README.md.
 */
function envFlag(name: string): boolean {
  const value = process.env[name];
  return value === "1" || value === "true";
}

export function agentSandboxEnabled(): boolean {
  return envFlag("AGENT_SANDBOX");
}
