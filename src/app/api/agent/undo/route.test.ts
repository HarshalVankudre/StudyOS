// POST /api/agent/undo: refusals are told apart by the error's typed reason,
// never by its message text.
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ auth: vi.fn(), undo: vi.fn(), report: vi.fn() }));

vi.mock("@clerk/nextjs/server", () => ({ auth: m.auth }));
vi.mock("@/lib/i18n/server", () => ({ getLocale: async () => "en" }));
vi.mock("@/lib/ops/report-error", () => ({ reportError: m.report }));
vi.mock("@/lib/workspace/version-service", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/workspace/version-service")>()),
  undoAgentWorkspaceChange: m.undo,
}));

import { POST } from "./route";
import { WorkspaceChangeUnavailableError } from "@/lib/workspace/version-service";

const request = () =>
  new Request("http://localhost/api/agent/undo", {
    method: "POST",
    body: JSON.stringify({ changeId: "chg_1" }),
  });

beforeEach(() => {
  m.auth.mockResolvedValue({ userId: "user_1" });
  m.undo.mockReset();
  m.report.mockReset();
});

describe("POST /api/agent/undo", () => {
  it("says the student's later edits blocked the undo (reason newer_edits)", async () => {
    m.undo.mockRejectedValue(new WorkspaceChangeUnavailableError("anything at all", "newer_edits"));
    const res = await POST(request());
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ reason: "newer_edits" });
  });

  it("any other unavailable change is plain 'unavailable', whatever its message says", async () => {
    m.undo.mockRejectedValue(new WorkspaceChangeUnavailableError("Workspace has newer changes"));
    const res = await POST(request());
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ reason: "unavailable" });
    expect(m.report).not.toHaveBeenCalled();
  });

  it("refuses a cross-site request before doing anything (CSRF)", async () => {
    const cross = (headers: Record<string, string>) =>
      new Request("http://localhost/api/agent/undo", {
        method: "POST",
        headers: { host: "localhost", ...headers },
        body: JSON.stringify({ changeId: "chg_1" }),
      });
    for (const headers of <Record<string, string>[]>[
      { origin: "https://evil.example" },
      { "sec-fetch-site": "cross-site" },
      { origin: "http://localhost", "sec-fetch-site": "same-site" },
    ]) {
      const res = await POST(cross(headers));
      expect(res.status).toBe(403);
    }
    expect(m.auth).not.toHaveBeenCalled();
    expect(m.undo).not.toHaveBeenCalled();
    m.undo.mockResolvedValue({ workspace: { id: "ws1" }, version: 5, changeId: "undo_1" });
    const ok = await POST(cross({ origin: "http://localhost", "sec-fetch-site": "same-origin" }));
    expect(ok.status).toBe(200);
  });

  it("returns the restored workspace on success", async () => {
    m.undo.mockResolvedValue({ workspace: { id: "ws1" }, version: 5, changeId: "undo_1" });
    const res = await POST(request());
    expect(await res.json()).toEqual({ workspace: { id: "ws1" }, version: 5, changeId: "undo_1" });
  });
});
