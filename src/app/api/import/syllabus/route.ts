import { rejectCrossSite } from "@/lib/http/same-origin";
import { auth } from "@clerk/nextjs/server";
import {
  ExtractError,
  MAX_UPLOAD_BYTES,
  extractSourceText,
} from "@/lib/import/extract";
import { MAX_SOURCE_TEXT } from "@/lib/import/syllabus";
import { readFormCapped } from "@/lib/import/upload-body";
import { reportError } from "@/lib/ops/report-error";
import { checkUsageLimit } from "@/lib/usage-limits";

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
 * Order of checks: signed in, then the per-user upload rate limit (before
 * any body is read), then the body is read with a hard byte cap (a declared
 * Content-Length past the cap is refused unread; an undeclared or lying one
 * is cut off as soon as the cap is passed), then extraction runs in an
 * isolated, memory- and time-capped process (lib/import/extract).
 *
 * Responses: 200 { text, totalChars, usedChars, kind, pages?, pagesTruncated? }
 * or an error status with { code } (too_large | unsupported | no_text |
 * unreadable | timeout | busy | rate_limited | invalid), plus `kind` for
 * no_text so the client can say "scanned PDF".
 */
export async function POST(request: Request) {
  const crossSite = rejectCrossSite(request);
  if (crossSite) return crossSite;
  const { userId } = await auth();
  if (!userId) return Response.json({ code: "not_authenticated" }, { status: 401 });

  const maxBody = MAX_UPLOAD_BYTES + FORM_OVERHEAD_BYTES;
  const declared = Number(request.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > maxBody) {
    return Response.json({ code: "too_large" }, { status: 413 });
  }

  if (!(await checkUsageLimit(userId, "syllabus_upload")).allowed) {
    return Response.json({ code: "rate_limited" }, { status: 429 });
  }

  const form = await readFormCapped(request, maxBody);
  if (form === "too_large") return Response.json({ code: "too_large" }, { status: 413 });
  const value = form?.get("file");
  const file = value instanceof File ? value : null;
  if (!file) return Response.json({ code: "invalid" }, { status: 400 });
  if (file.size > MAX_UPLOAD_BYTES) {
    return Response.json({ code: "too_large" }, { status: 413 });
  }

  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const extracted = await extractSourceText(bytes, file.name, file.type, { owner: userId });
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
      if (error.code === "busy") {
        return Response.json(
          { code: "busy" },
          { status: 503, headers: { "Retry-After": "30" } },
        );
      }
      const status =
        error.code === "too_large" ? 413 : error.code === "unsupported" ? 415 : 422;
      return Response.json(
        { code: error.code, ...(error.kind ? { kind: error.kind } : {}) },
        { status },
      );
    }
    reportError(error, { route: "/api/import/syllabus", method: "POST", userId });
    return Response.json({ code: "unreadable" }, { status: 422 });
  }
}
