import { describe, expect, it } from "vitest";
import { blockSchema, MAX_COMPONENT_SOURCE } from "@/lib/workspace/schema";

describe("react_artifact block", () => {
  const valid = {
    id: "b1",
    type: "react_artifact",
    title: "Grades",
    source: "function App(){return null}",
  };

  it("accepts a valid react_artifact block", () => {
    expect(blockSchema.safeParse(valid).success).toBe(true);
  });

  it("strips unknown keys", () => {
    const parsed = blockSchema.parse({ ...valid, evil: "x" });
    expect("evil" in parsed).toBe(false);
  });

  it("requires source and rejects oversized source", () => {
    const noSource: Record<string, unknown> = { ...valid };
    delete noSource.source;
    expect(blockSchema.safeParse(noSource).success).toBe(false);
    expect(
      blockSchema.safeParse({ ...valid, source: "x".repeat(MAX_COMPONENT_SOURCE + 1) }).success,
    ).toBe(false);
  });
});
