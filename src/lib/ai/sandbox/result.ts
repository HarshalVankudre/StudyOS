/**
 * Inbound sandbox boundary: turn an isolated task's UNTRUSTED output into a
 * bounded, validated AgentOp[] before it can reach the trusted apply path.
 *
 * This is the red-team's gate: cap the raw blob's bytes BEFORE parsing, then
 * validate against the same op-count/string/array-bounded schema the in-process
 * agent uses. The result is only ever a list of typed ops — never a workspace
 * blob, an ownerId, or a "validation passed" claim — which the trusted server
 * then replays against the freshly reloaded owned workspace.
 */
import { agentOpsSchema, type AgentOp } from "@/lib/ai/agent-ops";
import { assertResultWithinLimits } from "@/lib/ai/limits";

export class SandboxResultError extends Error {}

export function parseSandboxResult(rawBlob: string): AgentOp[] {
  // Byte cap first — reject an oversized blob before it is parsed or cloned.
  assertResultWithinLimits(rawBlob);

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBlob);
  } catch {
    throw new SandboxResultError("sandbox result was not valid JSON");
  }

  const ops = (parsed as { ops?: unknown })?.ops;
  const result = agentOpsSchema.safeParse(ops);
  if (!result.success) {
    throw new SandboxResultError("sandbox result ops failed validation");
  }
  return result.data;
}
