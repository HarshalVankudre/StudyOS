import { auth } from "@clerk/nextjs/server";
import { z } from "zod";
import { ExtractError, extractSourcePages } from "@/lib/import/extract";
import { readFormCapped } from "@/lib/import/upload-body";
import {
  MATERIAL_EXTRACTION_TIMEOUT_MS,
  MAX_MATERIAL_CHARS,
  MAX_MATERIAL_PDF_PAGES,
  MAX_MATERIAL_TITLE,
  MAX_MATERIAL_UPLOAD_BYTES,
  MAX_PASTE_CHARS,
} from "@/lib/materials/limits";
import { capPages, cleanMaterialText, paginateText } from "@/lib/materials/pages";
import { acquireHeavySlot, allowMaterialRead, readJsonBody } from "@/lib/materials/guard";
import { createMaterial, listMaterials, ownsLiveWorkspace } from "@/lib/materials/store";
import type { MaterialKind } from "@/lib/materials/types";
import { reportError } from "@/lib/ops/report-error";
import { checkUsageLimit } from "@/lib/usage-limits";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Multipart overhead allowed on top of the file itself. */
const FORM_OVERHEAD_BYTES = 64 * 1024;
/** Largest JSON body: the pasted text cap, with room for escaping. */
const MAX_JSON_BYTES = MAX_PASTE_CHARS * 6 + 4096;
const workspaceIdSchema = z.string().min(1).max(100);

/**
 * GET  /api/materials?workspaceId=…  The workspace's materials (no text).
 * POST /api/materials                 Add material: multipart { workspaceId, file }
 *                                     or JSON { workspaceId, title, text, sourcePageId? }.
 *
 * Errors carry { code }: not_authenticated | not_found | invalid | too_large |
 * unsupported | no_text | unreadable | timeout | limit | storage | busy |
 * rate_limited.
 */
export async function GET(request: Request) {
  const { userId } = await auth();
  if (!userId) return Response.json({ code: "not_authenticated" }, { status: 401 });
  if (!allowMaterialRead(userId)) return Response.json({ code: "rate_limited" }, { status: 429 });
  const parsed = workspaceIdSchema.safeParse(new URL(request.url).searchParams.get("workspaceId"));
  if (!parsed.success) return Response.json({ code: "invalid" }, { status: 400 });
  if (!(await ownsLiveWorkspace(userId, parsed.data))) {
    return Response.json({ code: "not_found" }, { status: 404 });
  }
  return Response.json({ materials: await listMaterials(userId, parsed.data) });
}

const pasteSchema = z.object({
  workspaceId: workspaceIdSchema,
  title: z.string().trim().min(1).max(MAX_MATERIAL_TITLE * 2),
  text: z.string().max(MAX_PASTE_CHARS),
  sourcePageId: z.string().max(100).optional(),
});

function titleFromFileName(name: string): string {
  const base = name.replace(/\.[A-Za-z0-9]{1,8}$/, "").replace(/[_]+/g, " ").trim();
  return (base || name).slice(0, MAX_MATERIAL_TITLE);
}

export async function POST(request: Request) {
  const { userId } = await auth();
  if (!userId) return Response.json({ code: "not_authenticated" }, { status: 401 });

  const contentType = request.headers.get("content-type") ?? "";
  let workspaceId: string;
  let title: string;
  let kind: MaterialKind;
  let pages: string[];
  let sourcePages: number;
  let truncated = false;
  let sourcePageId: string | null = null;
  let file: File | null = null;

  if (contentType.includes("multipart/form-data")) {
    // Read the body with a hard cap: a declared size past it is refused
    // unread, and a chunked or lying body is cut off at the cap.
    const form = await readFormCapped(request, MAX_MATERIAL_UPLOAD_BYTES + FORM_OVERHEAD_BYTES);
    if (form === "too_large") return Response.json({ code: "too_large" }, { status: 413 });
    const value = form?.get("file");
    file = value instanceof File ? value : null;
    const id: unknown = form?.get("workspaceId") ?? null;
    const parsedId = workspaceIdSchema.safeParse(id);
    if (!file || !parsedId.success) return Response.json({ code: "invalid" }, { status: 400 });
    if (file.size > MAX_MATERIAL_UPLOAD_BYTES) {
      return Response.json({ code: "too_large" }, { status: 413 });
    }
    workspaceId = parsedId.data;
    title = titleFromFileName(file.name);
    kind = "text";
    pages = [];
    sourcePages = 0;
  } else {
    const read = await readJsonBody(request, MAX_JSON_BYTES);
    if (!read.ok) {
      return Response.json({ code: read.status === 413 ? "too_large" : "invalid" }, { status: read.status });
    }
    const parsed = pasteSchema.safeParse(read.value);
    if (!parsed.success) return Response.json({ code: "invalid" }, { status: 400 });
    workspaceId = parsed.data.workspaceId;
    title = parsed.data.title.slice(0, MAX_MATERIAL_TITLE);
    kind = parsed.data.sourcePageId ? "page" : "text";
    sourcePageId = parsed.data.sourcePageId ?? null;
    const text = cleanMaterialText(parsed.data.text);
    if (text.replace(/\s+/g, "").length < 20) {
      return Response.json({ code: "no_text" }, { status: 422 });
    }
    pages = paginateText(text.slice(0, MAX_MATERIAL_CHARS));
    sourcePages = pages.length;
    truncated = text.length > MAX_MATERIAL_CHARS;
  }

  // Check the workspace before doing any work on its behalf.
  if (!(await ownsLiveWorkspace(userId, workspaceId))) {
    return Response.json({ code: "not_found" }, { status: 404 });
  }
  if (!(await checkUsageLimit(userId, "material_upload")).allowed) {
    return Response.json({ code: "rate_limited" }, { status: 429 });
  }

  if (file) {
    // Extraction is CPU and memory heavy: a couple at a time per student.
    const release = acquireHeavySlot("extract", userId);
    if (!release) return Response.json({ code: "busy" }, { status: 429 });
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const extracted = await extractSourcePages(bytes, file.name, file.type, {
        maxBytes: MAX_MATERIAL_UPLOAD_BYTES,
        maxPdfPages: MAX_MATERIAL_PDF_PAGES,
        maxChars: MAX_MATERIAL_CHARS,
        timeoutMs: MATERIAL_EXTRACTION_TIMEOUT_MS,
        maxPdfInflatedBytes: 250 * 1024 * 1024,
      });
      kind = extracted.kind;
      pages = extracted.paginated
        ? capPages(extracted.pages)
        : paginateText(extracted.pages.join("\n\n"));
      sourcePages = extracted.paginated ? extracted.sourcePages : pages.length;
      truncated = extracted.truncated;
    } catch (error) {
      if (error instanceof ExtractError) {
        // busy: every extraction process on this server instance is taken.
        const status =
          error.code === "too_large"
            ? 413
            : error.code === "unsupported"
              ? 415
              : error.code === "busy"
                ? 503
                : 422;
        return Response.json(
          { code: error.code, ...(error.kind ? { kind: error.kind } : {}) },
          { status },
        );
      }
      reportError(error, { route: "/api/materials", method: "POST", userId });
      return Response.json({ code: "unreadable" }, { status: 422 });
    } finally {
      release();
    }
  }

  const created = await createMaterial({
    ownerId: userId,
    workspaceId,
    title,
    kind,
    pages,
    sourcePages,
    truncated,
    sourcePageId,
  });
  if (!created.ok) {
    return created.reason === "not_found"
      ? Response.json({ code: "not_found" }, { status: 404 })
      : Response.json({ code: created.reason }, { status: 409 });
  }
  return Response.json(
    { material: created.material, reused: created.reused },
    { status: created.reused ? 200 : 201 },
  );
}
