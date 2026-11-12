import { auth } from "@clerk/nextjs/server";
import {
  ExtractError,
  MAX_UPLOAD_BYTES,
  extractSourceText,
} from "@/lib/import/extract";
import { MAX_SOURCE_TEXT } from "@/lib/import/syllabus";

export const runtime = "nodejs";
export const maxDuration = 30;

/** Multipart overhead allowed on top of the file itself. */
const FORM_OVERHEAD_BYTES = 64 * 1024;

/**
 * Turn an uploaded syllabus (PDF, .docx, .txt, .md) into plain text for the
 * generator. The text is returned to the browser (so the student sees exactly
 * what will be used) and is re-normalized and fenced as untrusted data when it
 * is later sent with a generation request.
 *
 * Responses: 200 { text, totalChars, usedChars, kind, pages?, pagesTruncated? }
 * or an error status with { code } (too_large | unsupported | no_text |
 * unreadable | timeout | invalid), plus `kind` for no_text so the client can
 * say "scanned PDF".
 */
export async function POST(request: Request) {
  const { userId } = await auth();
  if (!userId) return Response.json({ code: "not_authenticated" }, { status: 401 });

  // Refuse oversized bodies before buffering them.
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > MAX_UPLOAD_BYTES + FORM_OVERHEAD_BYTES) {
    return Response.json({ code: "too_large" }, { status: 413 });
  }

  let file: File | null = null;
  try {
    const form = await request.formData();
    const value = form.get("file");
    file = value instanceof File ? value : null;
  } catch {
    file = null;
  }
  if (!file) return Response.json({ code: "invalid" }, { status: 400 });
  if (file.size > MAX_UPLOAD_BYTES) {
    return Response.json({ code: "too_large" }, { status: 413 });
  }

  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const extracted = await extractSourceText(bytes, file.name, file.type);
    return Response.json({
      text: extracted.text,
      kind: extracted.kind,
      totalChars: extracted.totalChars,
      usedChars: Math.min(extracted.totalChars, MAX_SOURCE_TEXT),
      ...(extracted.pages !== undefined
        ? {
            pages: extracted.pages,
            pagesRead: extracted.pagesRead,
            pagesTruncated: extracted.pagesTruncated,
          }
        : {}),
    });
  } catch (error) {
    if (error instanceof ExtractError) {
      const status =
        error.code === "too_large" ? 413 : error.code === "unsupported" ? 415 : 422;
      return Response.json(
        { code: error.code, ...(error.kind ? { kind: error.kind } : {}) },
        { status },
      );
    }
    console.error("[StudyOS] syllabus extraction failed:", error);
    return Response.json({ code: "unreadable" }, { status: 422 });
  }
}
