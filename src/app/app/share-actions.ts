"use server";

/**
 * The "Share" dialog's server side (owner only). Sharing is off until the
 * student turns it on: that creates the page's link (or returns the one that
 * is already active); turning it off revokes the link for good, and turning
 * it on again issues a new one. Only a page of the student's own workspace,
 * not in the trash, can be shared (lib/share/store.ts), and not a page an
 * operator turned off after a report. Turning sharing on is limited to
 * SHARE_ENABLES_PER_HOUR per student (each can create a link); turning it
 * off never is. Never throws to the client: every outcome is a typed result.
 */
import { auth } from "@clerk/nextjs/server";
import { z } from "zod";
import { SHARE_ENABLE_KIND, SHARE_ENABLES_PER_HOUR, sharePath } from "@/lib/share/config";
import { reportError } from "@/lib/ops/report-error";
import { disableShare, enableShare, getShareState, type ShareBlock, type ShareState } from "@/lib/share/store";
import { claimWithinLimit } from "@/lib/usage-limits";

export type PageShareView =
  | { enabled: false; blocked?: ShareBlock }
  | { enabled: true; path: string; createdAt: string; viewCount: number };

export type PageShareError =
  | "unauthorized"
  | "invalid"
  | "not_found"
  | "limit"
  | "rate_limited"
  | "page_disabled"
  | "sharing_blocked"
  | "failed";
export type PageShareResult = { ok: true; share: PageShareView } | { ok: false; error: PageShareError };

const target = z.object({
  workspaceId: z.string().min(1).max(100),
  pageId: z.string().min(1).max(200),
});
const setInput = target.extend({ enabled: z.boolean() });

export type PageShareTarget = z.input<typeof target>;
export type SetPageShareInput = z.input<typeof setInput>;

const HOUR_MS = 60 * 60 * 1000;

function toView(state: ShareState): PageShareView {
  if (state.enabled) {
    return { enabled: true, path: sharePath(state.token), createdAt: state.createdAt.toISOString(), viewCount: state.viewCount };
  }
  return state.blocked ? { enabled: false, blocked: state.blocked } : { enabled: false };
}

/** One "turn sharing on" for the student, within SHARE_ENABLES_PER_HOUR (fails open on a database hiccup). */
async function claimEnable(userId: string): Promise<boolean> {
  try {
    return (await claimWithinLimit(userId, SHARE_ENABLE_KIND, SHARE_ENABLES_PER_HOUR, HOUR_MS)).allowed;
  } catch (error) {
    reportError(error, { source: "share-actions", userId });
    return true;
  }
}

/** Whether the page is shared, with its link and view count. */
export async function getPageShareAction(raw: PageShareTarget): Promise<PageShareResult> {
  const { userId } = await auth();
  if (!userId) return { ok: false, error: "unauthorized" };
  const parsed = target.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "invalid" };
  try {
    const state = await getShareState(userId, parsed.data.workspaceId, parsed.data.pageId);
    return state ? { ok: true, share: toView(state) } : { ok: false, error: "not_found" };
  } catch (error) {
    reportError(error, { source: "share-actions", userId });
    return { ok: false, error: "failed" };
  }
}

/** Turn the page's link on (creating it) or off (revoking it). */
export async function setPageShareAction(raw: SetPageShareInput): Promise<PageShareResult> {
  const { userId } = await auth();
  if (!userId) return { ok: false, error: "unauthorized" };
  const parsed = setInput.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const { workspaceId, pageId, enabled } = parsed.data;
  try {
    if (!enabled) {
      // Scoped to the student's own shares: works even once the page is gone,
      // and is never rate limited (taking a page down must always work).
      await disableShare(userId, workspaceId, pageId);
      return { ok: true, share: { enabled: false } };
    }
    if (!(await claimEnable(userId))) return { ok: false, error: "rate_limited" };
    const result = await enableShare(userId, workspaceId, pageId);
    if (result.status === "ok") return { ok: true, share: toView(result.state) };
    return { ok: false, error: result.status };
  } catch (error) {
    reportError(error, { source: "share-actions", userId });
    return { ok: false, error: "failed" };
  }
}
