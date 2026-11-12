import { rejectCrossSite } from "@/lib/http/same-origin";
import { reportError } from "@/lib/ops/report-error";
import { parsePatch } from "@/lib/workspace/patch-input";
import { InvalidWorkspaceError, WorkspaceTooLargeError } from "@/lib/workspace/repair";
import { isSaveId } from "@/lib/workspace/save-ids";
import { saveWorkspaceChanges } from "@/lib/workspace/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** A request sent while the page closes is small (browsers cap it near 64 KB). */
const MAX_BODY_CHARS = 256_000;

/**
 * The editor's last save when a tab closes (sent with `fetch(..., { keepalive
 * true })`, which outlives the page): the patch of unsaved edits on top of
 * `baseVersion`, under the tab's save id. Applied through the same
 * version-checked save gate as every autosave; a save id that already landed
 * is never applied twice. The tab's local draft stays as the fallback.
 */
export async function POST(request: Request) {
  const crossSite = rejectCrossSite(request);
  if (crossSite) return crossSite;
  const raw = await request.text().catch(() => "");
  if (!raw || raw.length > MAX_BODY_CHARS) return Response.json({ status: "invalid" }, { status: 413 });
  let body: { id?: unknown; baseVersion?: unknown; saveId?: unknown; ops?: unknown };
  try {
    body = JSON.parse(raw) as typeof body;
  } catch {
    return Response.json({ status: "invalid" }, { status: 400 });
  }
  const ops = parsePatch(body?.ops);
  if (
    typeof body?.id !== "string" ||
    body.id.length > 200 ||
    !Number.isInteger(body.baseVersion) ||
    !isSaveId(body.saveId) ||
    !ops
  ) {
    return Response.json({ status: "invalid" }, { status: 400 });
  }
  try {
    const result = await saveWorkspaceChanges(body.id, body.baseVersion as number, ops, body.saveId);
    return Response.json(result, { status: result.status === "not_found" ? 404 : 200 });
  } catch (error) {
    if (error instanceof WorkspaceTooLargeError) return Response.json({ status: "too_large" }, { status: 413 });
    if (error instanceof InvalidWorkspaceError) return Response.json({ status: "invalid" }, { status: 400 });
    if (error instanceof Error && error.message === "Not authenticated") {
      return Response.json({ status: "unauthorized" }, { status: 401 });
    }
    reportError(error, { source: "api", route: "/api/workspace/save", method: "POST" });
    return Response.json({ status: "error" }, { status: 500 });
  }
}
