import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("workspace version schema", () => {
  it("declares monotonic workspace versions and immutable changes", () => {
    const schema = readFileSync("prisma/schema.prisma", "utf8");

    expect(schema).toContain("version   Int");
    expect(schema).toContain("model WorkspaceChange");
    expect(schema).toContain("beforeData");
    expect(schema).toContain("afterData");
    expect(schema).toContain("@@unique([workspaceId, afterVersion])");
  });
});
