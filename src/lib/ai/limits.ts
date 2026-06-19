/**
 * Hard caps on agent results, enforced at every trust boundary.
 *
 * The agent's output — whether from the in-process editor model today or an
 * isolated sandbox later — is UNTRUSTED. Before the trusted, secret-holding
 * server downloads, parses, clones, stringifies, and persists it, bound its
 * size so a malicious or runaway result cannot exhaust memory/DB. These caps
 * are deliberately generous for real edits and tiny relative to an attack.
 */
export const AGENT_LIMITS = {
  /** Maximum number of patch operations in one result. */
  maxOps: 200,
  /** Maximum length of a single string field in a patch operation. */
  maxOpString: 20_000,
  /** Maximum length of an inline array in a patch operation (e.g. page blocks). */
  maxArray: 2_000,
  /** Maximum serialized byte size of a whole agent result, checked before parse. */
  maxResultBytes: 2_000_000,
} as const;

export class AgentResultTooLargeError extends Error {
  constructor(bytes: number) {
    super(
      `Agent result is ${bytes} bytes, over the ${AGENT_LIMITS.maxResultBytes}-byte limit`,
    );
    this.name = "AgentResultTooLargeError";
  }
}

/**
 * Throw if a raw result (a JSON string, or a value to be serialized) exceeds the
 * byte cap. Call this BEFORE JSON.parse / schema validation / apply so an
 * oversized blob is rejected before it can be cloned or written.
 */
export function assertResultWithinLimits(input: string | unknown): void {
  const text = typeof input === "string" ? input : JSON.stringify(input ?? "");
  const bytes = new TextEncoder().encode(text).length;
  if (bytes > AGENT_LIMITS.maxResultBytes) {
    throw new AgentResultTooLargeError(bytes);
  }
}
