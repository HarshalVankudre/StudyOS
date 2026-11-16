import { auth } from "@clerk/nextjs/server";
import { ID_PATTERN } from "@/lib/notebooks/model";
import { errorResponse, toErrorResponse } from "@/lib/notebooks/server/errors";
import { allowNotebookRead } from "@/lib/notebooks/server/guard";
import { MAX_INK_PAGES_PER_READ } from "@/lib/notebooks/server/limits";
import { idSchema } from "@/lib/notebooks/server/schemas";
import { readInk } from "@/lib/notebooks/server/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Props = { params: Promise<{ id: string }> };

/**
 * GET /api/notebooks/:id/ink?pages=id1,id2,…  The stored ink of up to
 * MAX_INK_PAGES_PER_READ (20) pages → { pages: [{ id, inkVersion, ink }] }
 * where `ink` is the page blob (lib/notebooks/codec.ts) in base64. Ids that
 * are not pages of this notebook are left out. Never cached: ink changes
 * with every sync.
 *
 * Errors carry { code }: not_authenticated | not_found | invalid (no ids,
 * a malformed id, or more than 20) | rate_limited | unavailable.
 */
export async function GET(request: Request, { params }: Props) {
  const { userId } = await auth();
  if (!userId) return errorResponse("not_authenticated", 401);
  if (!allowNotebookRead(userId)) return errorResponse("rate_limited", 429);
  const { id } = await params;
  if (!idSchema.safeParse(id).success) return errorResponse("not_found", 404);

  const raw = new URL(request.url).searchParams.get("pages") ?? "";
  const ids = [...new Set(raw.split(",").map((s) => s.trim()).filter(Boolean))];
  if (ids.length === 0 || ids.length > MAX_INK_PAGES_PER_READ || !ids.every((p) => ID_PATTERN.test(p))) {
    return errorResponse("invalid", 400);
  }
  try {
    const pages = await readInk(userId, id, ids);
    if (!pages) return errorResponse("not_found", 404);
    return Response.json({ pages }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return toErrorResponse(error, { route: "/api/notebooks/[id]/ink", method: "GET", userId });
  }
}
