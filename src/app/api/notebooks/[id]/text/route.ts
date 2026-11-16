import { auth } from "@clerk/nextjs/server";
import { errorResponse, toErrorResponse } from "@/lib/notebooks/server/errors";
import { allowNotebookRead } from "@/lib/notebooks/server/guard";
import { idSchema } from "@/lib/notebooks/server/schemas";
import { readTexts } from "@/lib/notebooks/server/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Props = { params: Promise<{ id: string }> };

/**
 * GET /api/notebooks/:id/text  Every page's text, in page order →
 * { pages: [{ id, position, pdfText, inkText, inkVersion, inkTextVersion,
 * strokeCount }] }. `inkTextVersion < inkVersion` (with strokes) means the
 * handwriting changed since it was last recognised: the client sends that
 * page to /recognize again. Also the text a study kit is made from.
 *
 * Errors carry { code }: not_authenticated | not_found | rate_limited | unavailable.
 */
export async function GET(_request: Request, { params }: Props) {
  const { userId } = await auth();
  if (!userId) return errorResponse("not_authenticated", 401);
  if (!allowNotebookRead(userId)) return errorResponse("rate_limited", 429);
  const { id } = await params;
  if (!idSchema.safeParse(id).success) return errorResponse("not_found", 404);
  try {
    const pages = await readTexts(userId, id);
    if (!pages) return errorResponse("not_found", 404);
    return Response.json({ pages }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return toErrorResponse(error, { route: "/api/notebooks/[id]/text", method: "GET", userId });
  }
}
