/**
 * Runtime feature flags.
 *
 * `AGENT_SANDBOX` gates routing agent tasks to the isolated OS sandbox. It is
 * OFF by default; only heavy/tool-using tasks should ever be routed there, and
 * not until the sandbox infrastructure (zero-role SA, VPC egress jail, verified
 * metadata block) is provisioned and proven.
 */
function envFlag(name: string): boolean {
  const value = process.env[name];
  return value === "1" || value === "true";
}

export function agentSandboxEnabled(): boolean {
  return envFlag("AGENT_SANDBOX");
}

/** Stage-1 tool-loop agent. Off = legacy two-call planner/editor. */
export function isAuthenticAgentEnabled(): boolean {
  return envFlag("AUTHENTIC_AGENT");
}
