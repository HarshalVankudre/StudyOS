// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ save: vi.fn(), report: vi.fn() }));
vi.mock("@/lib/workspace/store", () => ({ saveWorkspaceChanges: m.save }));
vi.mock("@/lib/ops/report-error", () => ({ reportError: m.report }));

import { POST } from "./route";

const SAVE_ID = "0b6f1c2e-4d5a-4f6b-8c7d-9e0f1a2b3c4d";
const ops = [{ op: "set", path: ["name"], before: "W", after: "W2" }];

function request(body: unknown, headers: Record<string, string> = {}) {
  return new Request("https://studyos.app/api/workspace/save", {
    method: "POST",
    headers: { "content-type": "application/json", host: "studyos.app", origin: "https://studyos.app", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

beforeEach(() => {
  m.save.mockResolvedValue({ status: "saved", version: 4 });
});

describe("POST /api/workspace/save (the closing tab's last save)", () => {
  it("applies the patch through the save gate under the tab's save id", async () => {
    const res = await POST(request({ id: "w1", baseVersion: 3, saveId: SAVE_ID, ops }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "saved", version: 4 });
    expect(m.save).toHaveBeenCalledWith("w1", 3, ops, SAVE_ID);
  });

  it("refuses another site's request before reading it", async () => {
    const res = await POST(request({ id: "w1", baseVersion: 3, saveId: SAVE_ID, ops }, { origin: "https://evil.example" }));
    expect(res.status).toBe(403);
    expect(m.save).not.toHaveBeenCalled();
  });

  it("refuses what is not a patch: no save id, a bad op, a prototype path, too large", async () => {
    for (const body of [
      { id: "w1", baseVersion: 3, ops },
      { id: "w1", baseVersion: 3, saveId: "x", ops },
      { id: "w1", baseVersion: 3, saveId: SAVE_ID, ops: [{ op: "explode" }] },
      { id: "w1", baseVersion: 3, saveId: SAVE_ID, ops: [{ op: "set", path: ["__proto__", "x"], before: 1, after: 2 }] },
      "not json",
    ]) {
      const res = await POST(request(body));
      expect(res.status).toBe(400);
    }
    expect((await POST(request("x".repeat(300_000)))).status).toBe(413);
    expect(m.save).not.toHaveBeenCalled();
  });

  it("signed out: 401; a failure: 500 and reported", async () => {
    m.save.mockRejectedValueOnce(new Error("Not authenticated"));
    expect((await POST(request({ id: "w1", baseVersion: 3, saveId: SAVE_ID, ops }))).status).toBe(401);
    m.save.mockRejectedValueOnce(new Error("db down"));
    expect((await POST(request({ id: "w1", baseVersion: 3, saveId: SAVE_ID, ops }))).status).toBe(500);
    expect(m.report).toHaveBeenCalledTimes(1);
  });
});
