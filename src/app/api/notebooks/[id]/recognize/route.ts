import { auth } from "@clerk/nextjs/server";
import { z } from "zod";
import { rejectCrossSite } from "@/lib/http/same-origin";
import { errorResponse, toErrorResponse } from "@/lib/notebooks/server/errors";
import { allowNotebookWrite, readJsonBody } from "@/lib/notebooks/server/guard";
import { MAX_RECOGNIZE_BODY_BYTES, MAX_RECOGNIZE_IMAGE_BYTES } from "@/lib/notebooks/server/limits";
import {
  handwritingModel,
  HandwritingRefusedError,
  imageMatchesMime,
  recognizeHandwriting,
} from "@/lib/notebooks/server/recognize";
import { idSchema } from "@/lib/notebooks/server/schemas";
import { pageExists, storeInkText } from "@/lib/notebooks/server/store";
import { reportError } from "@/lib/ops/report-error";
import { checkUsageLimit } from "@/lib/usage-limits";

export const runtime = "nodejs";
export const maxDuration = 90;

type Props = { params: Promise<{ id: string }> };

const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

const bodySchema = z.object({
  pageId: idSchema,
  inkVersion: z.number().int().min(0).max(2_000_000_000),
  /** Base64 of the PNG or JPEG bytes, without a "data:" prefix. */
  image: z.string().min(8).max(Math.ceil((MAX_RECOGNIZE_IMAGE_BYTES * 4) / 3) + 4),
  mime: z.enum(["image/png", "image/jpeg"]),
});

/**
 * POST /api/notebooks/:id/recognize  JSON { pageId, inkVersion, image, mime }
 * → { text, stored }: the page's handwriting as plain text, read by a vision
 * model (lib/notebooks/server/recognize.ts), stored as the page's inkText
 * recognised at `inkVersion` when the page is still in the notebook, its ink
 * is at least that version and no newer recognition landed (`stored` says
 * whether it was). Uses no credits; limited per day (USAGE_LIMITS.handwriting).
 *
 * Errors carry { code }: not_authenticated | invalid (schema, base64) |
 * too_large (image over 2 MB) | unsupported (415: the bytes are not the
 * declared PNG/JPEG) | not_found (page or notebook) | rate_limited |
 * unreadable (422: the model declined) | unavailable (503: no handwriting
 * model configured; 502: the model call failed).
 */
export async function POST(request: Request, { params }: Props) {
  const crossSite = rejectCrossSite(request);
  if (crossSite) return crossSite;
  const { userId } = await auth();
  if (!userId) return errorResponse("not_authenticated", 401);
  if (!allowNotebookWrite(userId)) return errorResponse("rate_limited", 429);
  const { id } = await params;
  if (!idSchema.safeParse(id).success) return errorResponse("not_found", 404);

  const read = await readJsonBody(request, MAX_RECOGNIZE_BODY_BYTES);
  if (!read.ok) return errorResponse(read.status === 413 ? "too_large" : "invalid", read.status);
  const parsed = bodySchema.safeParse(read.value);
  if (!parsed.success) {
    const tooLong = parsed.error.issues.some((i) => i.path[0] === "image" && i.code === "too_big");
    return tooLong ? errorResponse("too_large", 413) : errorResponse("invalid", 400);
  }
  const { pageId, inkVersion, image, mime } = parsed.data;
  if (!BASE64.test(image)) return errorResponse("invalid", 400);
  const bytes = new Uint8Array(Buffer.from(image, "base64"));
  if (bytes.byteLength > MAX_RECOGNIZE_IMAGE_BYTES) return errorResponse("too_large", 413);
  if (!imageMatchesMime(bytes, mime)) return errorResponse("unsupported", 415);

  try {
    if (!(await pageExists(userId, id, pageId))) return errorResponse("not_found", 404);
    const model = handwritingModel();
    if (!model) return errorResponse("unavailable", 503);
    if (!(await checkUsageLimit(userId, "handwriting")).allowed) return errorResponse("rate_limited", 429);

    let text: string;
    try {
      text = await recognizeHandwriting(model, bytes, mime);
    } catch (error) {
      if (error instanceof HandwritingRefusedError) return errorResponse("unreadable", 422);
      reportError(error, { source: "api", route: "/api/notebooks/[id]/recognize", method: "POST", userId });
      return errorResponse("unavailable", 502);
    }
    const stored = await storeInkText(userId, id, pageId, inkVersion, text);
    return Response.json({ text, stored }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return toErrorResponse(error, { route: "/api/notebooks/[id]/recognize", method: "POST", userId });
  }
}
