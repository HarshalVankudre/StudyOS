// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { docx, graphicsOnlyPdf, textPdf } from "@/lib/import/__fixtures__/documents";
import { configureExtractionIsolation, extractionLoad } from "@/lib/import/extract";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  checkUsageLimit: vi.fn(),
  reportError: vi.fn(),
}));
vi.mock("@clerk/nextjs/server", () => ({ auth: mocks.auth }));
vi.mock("@/lib/usage-limits", () => ({ checkUsageLimit: mocks.checkUsageLimit }));
vi.mock("@/lib/ops/report-error", () => ({ reportError: mocks.reportError }));

import { POST } from "./route";

function upload(bytes: Uint8Array, name: string, type = "") {
  const form = new FormData();
  form.append("file", new File([new Uint8Array(bytes)], name, { type }));
  return new Request("http://localhost/api/import/syllabus", { method: "POST", body: form });
}

let restore: ReturnType<typeof configureExtractionIsolation> | null = null;
function isolation(changes: Parameters<typeof configureExtractionIsolation>[0]) {
  const previous = configureExtractionIsolation(changes);
  restore ??= previous;
}

beforeEach(() => {
  mocks.auth.mockResolvedValue({ userId: "user-1" });
  mocks.checkUsageLimit.mockResolvedValue({ allowed: true, remaining: 10 });
});

afterEach(() => {
  if (restore) configureExtractionIsolation(restore);
  restore = null;
});

describe("POST /api/import/syllabus", () => {
  it("requires a signed-in user", async () => {
    mocks.auth.mockResolvedValue({ userId: null });
    const response = await POST(upload(textPdf(["x"]), "a.pdf"));
    expect(response.status).toBe(401);
  });

  it("returns the text of a PDF", async () => {
    const response = await POST(
      upload(textPdf(["PSY 101 Intro to Psychology", "Final exam 40%"]), "syllabus.pdf", "application/pdf"),
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({ kind: "pdf", pages: 1, pagesRead: 1, pagesTruncated: false });
    expect(body.text).toContain("Final exam 40%");
    expect(body.usedChars).toBe(body.totalChars);
    expect(mocks.checkUsageLimit).toHaveBeenCalledWith("user-1", "syllabus_upload");
  });

  it("returns the text of a .docx", async () => {
    const response = await POST(upload(docx(["ECON 110 Principles of Economics", ["Midterm", "30%"]]), "syllabus.docx"));
    expect(response.status).toBe(200);
    expect((await response.json()).text).toContain("Midterm\t30%");
  });

  it("explains a scanned PDF", async () => {
    const response = await POST(upload(graphicsOnlyPdf(), "scan.pdf", "application/pdf"));
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({ code: "no_text", kind: "pdf" });
  });

  it("refuses unsupported files and oversized bodies", async () => {
    const png = await POST(upload(new Uint8Array([0x89, 0x50, 0x4e, 0x47]), "photo.png", "image/png"));
    expect(png.status).toBe(415);

    const big = new Request("http://localhost/api/import/syllabus", {
      method: "POST",
      headers: { "content-length": String(50 * 1024 * 1024) },
      body: "x",
    });
    const response = await POST(big);
    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({ code: "too_large" });
  });

  it("stops reading an undeclared (chunked) body as soon as it passes the cap", async () => {
    let sent = 0;
    const chunk = new Uint8Array(1024 * 1024);
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        // An endless body: only the cap can end this request.
        sent += chunk.length;
        controller.enqueue(chunk);
      },
    });
    const request = new Request("http://localhost/api/import/syllabus", {
      method: "POST",
      headers: { "content-type": "multipart/form-data; boundary=x" },
      body,
      duplex: "half",
    } as RequestInit);
    const response = await POST(request);
    expect(response.status).toBe(413);
    expect(sent).toBeLessThan(14 * 1024 * 1024);
  });

  it("is rate limited per user before the body is read", async () => {
    mocks.checkUsageLimit.mockResolvedValue({ allowed: false, remaining: 0 });
    const request = upload(textPdf(["PSY 101"]), "a.pdf", "application/pdf");
    const response = await POST(request);
    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({ code: "rate_limited" });
    expect(request.bodyUsed).toBe(false);
  });

  it("answers busy (503) when every extraction slot on the instance is taken", async () => {
    isolation({ maxConcurrent: 0, maxQueued: 0 });
    const response = await POST(upload(docx(["BIO 110 Cell Biology syllabus"]), "s.docx"));
    expect(response.status).toBe(503);
    expect(response.headers.get("retry-after")).toBe("30");
    expect(await response.json()).toEqual({ code: "busy" });
  });

  it("returns a clean timeout when the extraction process is killed at its deadline", async () => {
    isolation({ maxTimeoutMs: 1, killGraceMs: 0 });
    const response = await POST(upload(docx(["BIO 110 Cell Biology syllabus"]), "s.docx"));
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({ code: "timeout" });
    expect(extractionLoad()).toEqual({ active: 0, waiting: 0 });
  });

  it("returns a clean too_large when the extraction process passes its memory cap", async () => {
    // Any real process is above 1 MB resident, so the watchdog fires at once.
    isolation({ rssLimitMb: 1 });
    const response = await POST(upload(textPdf(["PSY 101 Intro to Psychology"]), "s.pdf", "application/pdf"));
    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({ code: "too_large" });
    expect(mocks.reportError).not.toHaveBeenCalled();
  });
});
