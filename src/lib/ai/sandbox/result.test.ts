import { describe, expect, it } from "vitest";
import { AGENT_LIMITS } from "@/lib/ai/limits";
import { SandboxResultError, parseSandboxResult } from "./result";

describe("sandbox result intake", () => {
  it("accepts a valid bounded op list", () => {
    const blob = JSON.stringify({
      ops: [{ op: "delete_row", databaseId: "db", rowId: "r" }],
    });
    expect(parseSandboxResult(blob)).toEqual([
      { op: "delete_row", databaseId: "db", rowId: "r" },
    ]);
  });

  it("rejects an oversized blob before parsing", () => {
    const blob = "x".repeat(AGENT_LIMITS.maxResultBytes + 1);
    expect(() => parseSandboxResult(blob)).toThrow(); // AgentResultTooLargeError
  });

  it("rejects non-JSON", () => {
    expect(() => parseSandboxResult("not json")).toThrow(SandboxResultError);
  });

  it("rejects a missing or invalid ops field", () => {
    expect(() => parseSandboxResult(JSON.stringify({}))).toThrow(
      SandboxResultError,
    );
    expect(() =>
      parseSandboxResult(JSON.stringify({ ops: [{ op: "nope" }] })),
    ).toThrow(SandboxResultError);
  });

  it("rejects an op list longer than the cap", () => {
    const ops = Array.from({ length: AGENT_LIMITS.maxOps + 1 }, () => ({
      op: "delete_row",
      databaseId: "db",
      rowId: "r",
    }));
    expect(() => parseSandboxResult(JSON.stringify({ ops }))).toThrow(
      SandboxResultError,
    );
  });
});
