import { describe, expect, it } from "vitest";
import { parseAgentPlan, parseAgentStep } from "./agent-protocol";

describe("agent protocol", () => {
  it("parses an execute plan", () => {
    const p = parseAgentPlan('{"action":"execute","skillId":"precise-edit","summary":"Rename page","affectedAreaIds":["p1"]}');
    expect(p.action).toBe("execute");
  });
  it("parses a reply plan", () => {
    const p = parseAgentPlan('{"action":"reply","reply":"Hello"}');
    expect(p.action === "reply" && p.reply).toBe("Hello");
  });
  it("parses a tool step (fenced)", () => {
    const s = parseAgentStep('```json\n{"action":"tool","tool":"find_entities","input":{"query":"x"}}\n```');
    expect(s.action === "tool" && s.tool).toBe("find_entities");
  });
  it("parses a final step", () => {
    const s = parseAgentStep('{"action":"final","reply":"Done."}');
    expect(s.action).toBe("final");
  });
  it("throws on malformed json", () => {
    expect(() => parseAgentStep("not json")).toThrow();
  });
});
