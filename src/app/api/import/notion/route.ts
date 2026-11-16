import { auth } from "@clerk/nextjs/server";
import { revalidatePath } from "next/cache";
import { isUploadImageMime } from "@/lib/assets/mime";
import { createAssetService } from "@/lib/assets/service";
import { prismaAssetRepo } from "@/lib/assets/repo";
import { gcsAssetStore } from "@/lib/assets/storage";
import { rejectCrossSite } from "@/lib/http/same-origin";
import { getI18n } from "@/lib/i18n/server";
import { importNotionExport, type StoreImage } from "@/lib/import/notion/build";
import { acquireImportSlot } from "@/lib/import/notion/guard";
import { NOTION_IMPORT_LIMITS, NotionImportError, type NotionImportErrorCode } from "@/lib/import/notion/limits";
import { readFormCapped } from "@/lib/import/upload-body";
import { remoteAssetImagesAvailable } from "@/lib/ops/env";
import { reportError } from "@/lib/ops/report-error";
import { checkUsageLimit, MAX_WORKSPACES_PER_USER, workspaceLimitReached } from "@/lib/usage-limits";
import { WorkspaceTooLargeError } from "@/lib/workspace/repair";
import { saveNewWorkspace } from "@/lib/workspace/store";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Multipart overhead allowed on top of the file itself. */
const FORM_OVERHEAD_BYTES = 64 * 1024;
const MAX_BODY_BYTES = NOTION_IMPORT_LIMITS.maxUploadBytes + FORM_OVERHEAD_BYTES;

// Lazy: no storage or database client is made until an image is stored.
const assets = createAssetService({ store: gcsAssetStore(), repo: prismaAssetRepo() });

const STATUS: Record<NotionImportErrorCode, number> = {
  not_zip: 422,
  not_notion: 422,
  too_large: 413,
  too_many_files: 422,
  unsafe: 422,
  encrypted: 422,
  corrupt: 422,
  timeout: 422,
};

const fail = (code: string, status: number, extra: Record<string, unknown> = {}) =>
  Response.json({ code, ...extra }, { status });

/**
 * An error as it may be reported: its kind and where it happened, never its
 * message (which could quote the export).
 */
function reportable(error: unknown): Error {
  const safe = new Error(`notion import failed (${error instanceof Error ? error.name : typeof error})`);
  if (error instanceof Error && error.stack) {
    safe.stack = [safe.message, ...error.stack.split("\n").slice(1, 8)].join("\n");
  }
  return safe;
}

/**
 * POST /api/import/notion — multipart { file }: a Notion "Markdown & CSV"
 * export (.zip, up to 25 MB) becomes a new workspace. No AI and no credits.
 *
 * Checks, cheapest first: same-origin, signed in, the declared body size
 * (refused unread), the workspace cap (as Duplicate), one import at a time
 * per student and a few per instance, the hourly import limit (recorded
 * before the body is read), then the body is read with a hard cap. The zip is
 * read in process under the import's own limits and time budget
 * (lib/import/notion), and the workspace is saved through the same
 * repair/size gate as every other save (saveNewWorkspace). Nothing from the
 * export is logged.
 *
 * 201 { workspaceId, name, summary } or an error status with { code }:
 * not_authenticated | invalid | too_large | workspace_limit (+ max) | busy |
 * rate_limited | not_zip | not_notion | too_many_files | unsafe | encrypted |
 * corrupt | timeout | failed.
 */
export async function POST(request: Request) {
  const crossSite = rejectCrossSite(request);
  if (crossSite) return crossSite;
  const { userId } = await auth();
  if (!userId) return fail("not_authenticated", 401);

  const declared = Number(request.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return fail("too_large", 413);

  if (await workspaceLimitReached(userId)) return fail("workspace_limit", 409, { max: MAX_WORKSPACES_PER_USER });

  const release = acquireImportSlot(userId);
  if (!release) return fail("busy", 429);
  try {
    if (!(await checkUsageLimit(userId, "notion_import")).allowed) return fail("rate_limited", 429);

    const form = await readFormCapped(request, MAX_BODY_BYTES);
    if (form === "too_large") return fail("too_large", 413);
    const value = form?.get("file");
    const file = value instanceof File ? value : null;
    if (!file) return fail("invalid", 400);
    if (file.size > NOTION_IMPORT_LIMITS.maxUploadBytes) return fail("too_large", 413);
    const bytes = new Uint8Array(await file.arrayBuffer());

    const { dict, locale } = await getI18n();
    const workspaceId = crypto.randomUUID();
    // Images become media only where asset images can be served, and only
    // the raster types sniffImage recognises by their bytes (PNG, JPEG, GIF,
    // WebP): an SVG from an upload is never stored.
    const storeImage: StoreImage | undefined = remoteAssetImagesAvailable()
      ? async ({ bytes: data, mime, name }) => {
          if (!isUploadImageMime(mime)) return null;
          try {
            const handle = await assets.createAsset({
              ownerId: userId,
              workspaceId,
              bytes: data,
              mime,
              filename: name.slice(0, 200),
            });
            return handle.assetId;
          } catch (error) {
            reportError(reportable(error), { route: "/api/import/notion", source: "notion-import-image", userId });
            return null;
          }
        }
      : undefined;

    const { workspace, summary } = await importNotionExport(bytes, {
      workspaceId,
      labels: dict.notionImport.content,
      // "03/04/2024" is 3 April almost everywhere but the US.
      dayFirst: locale !== "en",
      storeImage,
    });
    const id = await saveNewWorkspace(workspace, { id: workspaceId });
    revalidatePath("/app");
    return Response.json({ workspaceId: id, name: workspace.name, summary }, { status: 201 });
  } catch (error) {
    if (error instanceof NotionImportError) return fail(error.code, STATUS[error.code]);
    if (error instanceof WorkspaceTooLargeError) return fail("too_large", 413);
    reportError(reportable(error), { route: "/api/import/notion", method: "POST", userId });
    return fail("failed", 500);
  } finally {
    release();
  }
}
