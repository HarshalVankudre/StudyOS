"use server";

/**
 * Server actions of a shared page (/s/<token>), open to anyone holding the
 * link:
 *  - "Report this page": validated, rate limited per address (in memory,
 *    SHARE_REPORTS_PER_HOUR; an IPv6 client by its /64) and stored for the
 *    operator console, at most SHARE_REPORTS_OPEN_CAP open reports per share.
 *    No reporter identity is kept.
 *  - "Save a copy to my StudyOS": needs a signed-in student; copies the page
 *    (lib/share/copy.ts) into a NEW workspace of theirs through the normal
 *    store path (ownership, version, validation), within the workspace cap
 *    and the duplicate rate limit. No credits are charged.
 * Neither ever throws to the client: every outcome is a typed result.
 */
import { auth } from "@clerk/nextjs/server";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { z } from "zod";
import { getI18n } from "@/lib/i18n/server";
import { clientRateLimitKey } from "@/lib/ops/client-ip";
import { createMemoryRateLimiter } from "@/lib/ops/memory-rate-limit";
import { reportError } from "@/lib/ops/report-error";
import {
  SHARE_REPORT_MAX_MESSAGE,
  SHARE_REPORT_REASONS,
  SHARE_REPORTS_PER_HOUR,
} from "@/lib/share/config";
import { buildPageCopy } from "@/lib/share/copy";
import { loadPublicShare } from "@/lib/share/public-share";
import { loadSharedPage, ownerTimeZone, storeShareReport } from "@/lib/share/store";
import { isShareTokenShape } from "@/lib/share/token";
import { checkUsageLimit, workspaceLimitReached } from "@/lib/usage-limits";
import { dayKeyOf } from "@/lib/workspace/view-logic";
import { saveNewWorkspace } from "@/lib/workspace/store";

const HOUR_MS = 60 * 60 * 1000;
const reportLimiter = createMemoryRateLimiter({ limit: SHARE_REPORTS_PER_HOUR, windowMs: HOUR_MS });

const tokenSchema = z.string().refine((value) => isShareTokenShape(value));

const reportInput = z.object({
  token: tokenSchema,
  reason: z.enum(SHARE_REPORT_REASONS),
  message: z.string().trim().max(SHARE_REPORT_MAX_MESSAGE).nullish(),
});

export type ReportShareInput = z.input<typeof reportInput>;
export type ReportShareError = "invalid" | "rate_limited" | "gone" | "failed";
export type ReportShareResult = { ok: true } | { ok: false; error: ReportShareError };

/** "Report this page". */
export async function reportShareAction(raw: ReportShareInput): Promise<ReportShareResult> {
  const parsed = reportInput.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const { token, reason } = parsed.data;
  const message = parsed.data.message || null;

  if (!reportLimiter(clientRateLimitKey(await headers()))) return { ok: false, error: "rate_limited" };
  try {
    const shared = await loadPublicShare(token);
    if (!shared) return { ok: false, error: "gone" };
    await storeShareReport(shared.share.id, reason, message);
    return { ok: true };
  } catch (error) {
    reportError(error, { source: "share-report" });
    return { ok: false, error: "failed" };
  }
}

export type SaveSharedCopyError = "signed_out" | "invalid" | "gone" | "limit" | "rate_limited" | "failed";
export type SaveSharedCopyResult = { ok: true; workspaceId: string } | { ok: false; error: SaveSharedCopyError };

/** "Save a copy to my StudyOS": the page as a new workspace of the signed-in student. */
export async function saveSharedCopyAction(token: string): Promise<SaveSharedCopyResult> {
  const { userId } = await auth();
  if (!userId) return { ok: false, error: "signed_out" };
  if (!isShareTokenShape(token)) return { ok: false, error: "invalid" };
  try {
    const shared = await loadSharedPage(token);
    if (!shared) return { ok: false, error: "gone" };
    if (await workspaceLimitReached(userId)) return { ok: false, error: "limit" };
    // A copy is a new workspace of up to 2 MB: the same rate limit as "Duplicate".
    if (!(await checkUsageLimit(userId, "workspace_duplicate")).allowed) return { ok: false, error: "rate_limited" };

    const { dict } = await getI18n();
    const copy = buildPageCopy(shared.page, shared.workspace, {
      sameOwner: userId === shared.share.userId,
      // The sharer's day, as on the page the visitor saw (its date filters).
      today: dayKeyOf(new Date(), await ownerTimeZone(shared.share.userId)),
      untitled: dict.editor.untitled,
    });
    const workspaceId = await saveNewWorkspace(copy);
    revalidatePath("/app");
    return { ok: true, workspaceId };
  } catch (error) {
    reportError(error, { source: "share-copy", userId });
    return { ok: false, error: "failed" };
  }
}
