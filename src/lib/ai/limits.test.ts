import { describe, expect, it } from "vitest";
import {
  AGENT_LIMITS,
  AgentResultTooLargeError,
  assertResultWithinLimits,
} from "./limits";
import { agentOpSchema, agentOpsSchema } from "./agent-ops";

describe("agent result limits", () => {
  it("rejects a result over the byte cap, before parsing", () => {
    const huge = "x".repeat(AGENT_LIMITS.maxResultBytes + 1);
    expect(() => assertResultWithinLimits(huge)).toThrow(
      AgentResultTooLargeError,
    );
  });

  it("accepts a normal-sized result", () => {
    expect(() =>
      assertResultWithinLimits(JSON.stringify({ ops: [{ op: "noop" }] })),
    ).not.toThrow();
  });

  it("rejects an op list longer than maxOps", () => {
    const ops = Array.from({ length: AGENT_LIMITS.maxOps + 1 }, () => ({
      op: "delete_row" as const,
      databaseId: "db",
      rowId: "r",
    }));
    expect(agentOpsSchema.safeParse(ops).success).toBe(false);
    expect(agentOpsSchema.safeParse(ops.slice(0, AGENT_LIMITS.maxOps)).success).toBe(
      true,
    );
  });

  it("rejects a string field longer than maxOpString", () => {
    const op = {
      op: "delete_row",
      databaseId: "x".repeat(AGENT_LIMITS.maxOpString + 1),
      rowId: "r",
    };
    expect(agentOpSchema.safeParse(op).success).toBe(false);
  });

  it("rejects an inline array longer than maxArray", () => {
    const blocks = Array.from({ length: AGENT_LIMITS.maxArray + 1 }, (_, i) => ({
      id: `b${i}`,
      type: "divider" as const,
    }));
    const op = { op: "set_page_blocks", pageId: "p", blocks };
    expect(agentOpSchema.safeParse(op).success).toBe(false);
  });
});
