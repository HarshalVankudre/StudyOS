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

  it("redacts Daytona and Google API keys", () => {
    const text = scrub("sandbox failed for dtn_0123456789abcdef0123 key AIzaSyA1234567890abcdefghijklmnopqrstu");
    expect(text).not.toContain("dtn_0123456789abcdef0123");
    expect(text).not.toContain("AIzaSyA1234567890");
    expect(text).toContain("[redacted-daytona-key]");
  });

  it("drops short quoted user content but keeps codes and identifiers", () => {
    const parse = scrub(`Unexpected token 'M', "Midterm on Oct 3" is not valid JSON`);
    expect(parse).not.toContain("Midterm");
    const zod = scrub(`Invalid option: expected one of "todo"|"done", received “Call Dr. Lee”`);
    expect(zod).not.toContain("Dr. Lee");
    expect(zod).toContain('"todo"');
    expect(zod).toContain('"done"');
    const code = scrub(`Unique constraint failed on the fields: (\`idempotencyKey\`) code 'P2002'`);
    expect(code).toContain("`idempotencyKey`");
    expect(code).toContain("'P2002'");
    // Apostrophes are not quotes.
    expect(scrub("the model didn't return the student's plan")).toBe(
      "the model didn't return the student's plan",
    );
    // Short inline JSON documents go too.
    expect(scrub('bad row {"title":"Essay due"} skipped')).not.toContain("Essay");
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
