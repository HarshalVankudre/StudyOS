import { auth } from "@clerk/nextjs/server";
import { errorResponse, toErrorResponse } from "@/lib/notebooks/server/errors";
import { allowNotebookRead } from "@/lib/notebooks/server/guard";
import { idSchema } from "@/lib/notebooks/server/schemas";
import { readNotebookFile } from "@/lib/notebooks/server/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Props = { params: Promise<{ fileId: string }> };

/**
 * GET /api/notebooks/files/:fileId  The bytes of an imported PDF, for the
 * page backgrounds (pdf.js fetches it from this origin, so the CSP's
 * connect-src 'self' covers it and no bucket URL is ever handed out).
 * Owner-scoped: anyone else gets a 404. A file never changes once stored, so
 * the browser may keep it (privately) for a year; the ETag is its SHA-256.
 * Served as an attachment with nosniff, so opening the URL directly
 * downloads it instead of rendering it on our origin.
 */
export async function GET(request: Request, { params }: Props) {
  const { userId } = await auth();
  if (!userId) return errorResponse("not_authenticated", 401);
  if (!allowNotebookRead(userId)) return errorResponse("rate_limited", 429);
  const { fileId } = await params;
  if (!idSchema.safeParse(fileId).success) return errorResponse("not_found", 404);
  try {
    const file = await readNotebookFile(userId, fileId);
    if (!file) return errorResponse("not_found", 404);
    const etag = `"${file.sha256}"`;
    const headers = {
      "Cache-Control": "private, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
      ETag: etag,
    };
    if (request.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers });
    return new Response(new Uint8Array(file.bytes), {
      headers: {
        ...headers,
        "Content-Type": "application/pdf",
        "Content-Length": String(file.bytes.byteLength),
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(file.name)}`,
      },
    });
  } catch (error) {
    return toErrorResponse(error, { route: "/api/notebooks/files/[fileId]", method: "GET", userId });
  }
}
