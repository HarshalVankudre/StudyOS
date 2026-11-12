import { afterEach, describe, expect, it, vi } from "vitest";
import { REPORTED_ERROR_EVENT_TYPE, buildErrorEntry, reportError, scrub } from "./report-error";

afterEach(() => vi.restoreAllMocks());

describe("reportError", () => {
  it("writes one JSON line in the Error Reporting shape", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    reportError(new Error("boom"), { source: "api", route: "/api/x", method: "POST", userId: "user_1" });
    expect(spy).toHaveBeenCalledTimes(1);
    const line = spy.mock.calls[0][0] as string;
    expect(line).not.toContain("\n");
    const entry = JSON.parse(line);
    expect(entry["@type"]).toBe(REPORTED_ERROR_EVENT_TYPE);
    expect(entry.severity).toBe("ERROR");
    expect(entry.message).toMatch(/^Error: boom\n\s+at /);
    expect(entry.context.httpRequest).toEqual({ method: "POST" });
    expect(entry.context.user).toBe("user_1");
    expect(entry.serviceContext.service).toBeTruthy();
  });

  it("uses Cloud Run's service and revision", () => {
    const entry = buildErrorEntry(new Error("x"), {}, { K_SERVICE: "studyos", K_REVISION: "studyos-00042" });
    expect(entry.serviceContext).toEqual({ service: "studyos", version: "studyos-00042" });
  });

  it("redacts credentials from messages", () => {
    const text = scrub(
      "failed sk_live_ABC123 whsec_abc= Bearer eyJhbGciOi.payload.sig postgresql://user:pw@db/x a@b.com",
    );
    for (const leaked of ["sk_live_ABC123", "whsec_abc", "eyJhbGciOi", "user:pw", "a@b.com"]) {
      expect(text).not.toContain(leaked);
    }
  });

  it("drops embedded documents and caps length", () => {
    const doc = JSON.stringify({ title: "My secret essay", body: "x".repeat(400) });
    const entry = buildErrorEntry(new Error(`could not save ${doc}`));
    expect(entry.message).not.toContain("My secret essay");
    expect(entry.message.length).toBeLessThan(4_100);
  });

  it("keeps only the Prisma error code, never the query arguments", () => {
    class PrismaClientKnownRequestError extends Error {
      code = "P2002";
    }
    const err = new PrismaClientKnownRequestError(
      'Invalid `prisma.workspace.update()` invocation: { data: "my lecture notes" }',
    );
    const entry = buildErrorEntry(err);
    expect(entry.message).toContain("P2002");
    expect(entry.message).not.toContain("lecture notes");
  });

  it("logs only allowlisted primitive context, without query strings", () => {
    const entry = buildErrorEntry(new Error("x"), {
      path: "/api/calendar/abc?token=secret",
      ...({ workspace: { data: "doc" }, password: "hunter2" } as object),
    });
    const json = JSON.stringify(entry);
    expect(json).not.toContain("hunter2");
    expect(json).not.toContain("doc");
    expect(json).not.toContain("token=secret");
    expect(entry.labels.path).toBe("/api/calendar/abc");
  });

  it("adds a report location when there is no stack trace", () => {
    const entry = buildErrorEntry("plain string", { source: "client" });
    expect(entry.context.reportLocation?.functionName).toBe("client");
  });
});
