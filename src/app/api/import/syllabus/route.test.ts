// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { docx, graphicsOnlyPdf, textPdf } from "@/lib/import/__fixtures__/documents";

const mocks = vi.hoisted(() => ({ auth: vi.fn() }));
vi.mock("@clerk/nextjs/server", () => ({ auth: mocks.auth }));

import { POST } from "./route";

function upload(bytes: Uint8Array, name: string, type = "") {
  const form = new FormData();
  form.append("file", new File([new Uint8Array(bytes)], name, { type }));
  return new Request("http://localhost/api/import/syllabus", { method: "POST", body: form });
}

beforeEach(() => {
  mocks.auth.mockResolvedValue({ userId: "user-1" });
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
});
