/**
 * Share links: the database side (server-only). The owner's dialog
 * (src/app/app/share-actions.ts), the public page (/s/<token>), its asset
 * route and its actions all go through here.
 *
 * Rules:
 *  - a share belongs to one user, one workspace and one page; at most one is
 *    active (revokedAt null) per page, and at most MAX_ACTIVE_SHARES_PER_USER
 *    per user (checked under the user's advisory lock, so parallel requests
 *    cannot pass the count together; at the cap, links whose page or
 *    workspace is gone are revoked first);
 *  - turning sharing off sets revokedAt; turning it on again makes a new token;
 *  - a link works only while the share is active, its workspace is not in the
 *    trash (and still belongs to the sharer) and the page still exists.
 *    Anything else looks exactly like an unknown token (null). Trashing the
 *    workspace or deleting the page also revokes the share for good
 *    (lib/workspace/store.ts);
 *  - a page whose link an operator turned off after a report
 *    (disabledByOperatorAt) cannot be shared again, and a student with
 *    OPERATOR_DISABLED_SHARES_BLOCK such links cannot share any page.
 */
import "server-only";

import { DEFAULT_TIME_ZONE, validTimeZone } from "@/lib/ai/student-clock";
import { prisma } from "@/lib/db";
import { userLockKey, withKeyLock, type LockedTx } from "@/lib/db-lock";
import { createMemoryRateLimiter } from "@/lib/ops/memory-rate-limit";
import { NOT_TRASHED, parseStoredWorkspace } from "@/lib/workspace/store";
import type { Page, Workspace } from "@/lib/workspace/types";
import {
  MAX_ACTIVE_SHARES_PER_USER,
  OPERATOR_DISABLED_SHARES_BLOCK,
  SHARE_REPORTS_OPEN_CAP,
  type ShareReportReason,
} from "./config";
import { isShareTokenShape, newShareToken } from "./token";

export interface ActiveShare {
  id: string;
  token: string;
  userId: string;
  workspaceId: string;
  pageId: string;
}

export interface SharedPage {
  share: ActiveShare;
  workspace: Workspace;
  page: Page;
}

export interface LiveShare {
  share: ActiveShare;
  /** The shared workspace's current version (every save advances it). */
  version: number;
}

/**
 * The share behind a token while its link works: not revoked, its workspace
 * the sharer's and not in the trash. Reads two small rows (the share and its
 * workspace's owner, trash state and version), never the document, so it
 * runs on every request to a shared page; whether the page still exists is
 * known only once the document is read (loadSharedDocument).
 */
export async function findLiveShare(token: string): Promise<LiveShare | null> {
  if (!isShareTokenShape(token)) return null;
  const row = await prisma.pageShare.findUnique({
    where: { token },
    select: {
      id: true,
      token: true,
      userId: true,
      workspaceId: true,
      pageId: true,
      revokedAt: true,
      workspace: { select: { ownerId: true, deletedAt: true, version: true } },
    },
  });
  if (!row || row.revokedAt || !row.workspace) return null;
  if (row.workspace.deletedAt || row.workspace.ownerId !== row.userId) return null;
  return {
    share: { id: row.id, token: row.token, userId: row.userId, workspaceId: row.workspaceId, pageId: row.pageId },
    version: row.workspace.version,
  };
}

/** The shared workspace and page as stored now, with its version; null when either is gone. */
export async function loadSharedDocument(
  share: ActiveShare,
): Promise<{ workspace: Workspace; page: Page; version: number } | null> {
  const row = await prisma.workspace.findFirst({
    where: { id: share.workspaceId, ownerId: share.userId, ...NOT_TRASHED },
    select: { id: true, name: true, data: true, version: true },
  });
  if (!row) return null;
  const workspace = parseStoredWorkspace(row);
  const page = workspace?.pages.find((p) => p.id === share.pageId);
  if (!workspace || !page) return null;
  return { workspace, page, version: row.version };
}

/** The live shared page behind a token, or null (unknown, revoked, trashed, page gone). */
export async function loadSharedPage(token: string): Promise<SharedPage | null> {
  const live = await findLiveShare(token);
  if (!live) return null;
  const doc = await loadSharedDocument(live.share);
  return doc ? { share: live.share, workspace: doc.workspace, page: doc.page } : null;
}

/**
 * The time zone a sharer's page is read in (their Today plan's zone, UTC
 * when they have none), so "today", "overdue" and "next 7 days" filters show
 * a visitor what the sharer sees, whatever the server's own zone.
 */
export async function ownerTimeZone(userId: string): Promise<string> {
  const config = await prisma.dailyStudyAgentConfig.findUnique({ where: { userId }, select: { timeZone: true } });
  return validTimeZone(config?.timeZone) ?? DEFAULT_TIME_ZONE;
}

// ---- The owner's side ----------------------------------------------------------

/**
 * Why a page cannot be shared: "page", an operator turned its link off after
 * a report; "account", the student has OPERATOR_DISABLED_SHARES_BLOCK such
 * links and cannot share any page.
 */
export type ShareBlock = "page" | "account";

export type ShareState =
  | { enabled: false; blocked?: ShareBlock }
  | { enabled: true; token: string; createdAt: Date; viewCount: number };

type ShareReader = Pick<LockedTx, "pageShare">;

/** Whether an operator's decision keeps this page (or this student) from sharing. */
async function shareBlock(db: ShareReader, userId: string, workspaceId: string, pageId: string): Promise<ShareBlock | null> {
  const [page, disabled] = await Promise.all([
    db.pageShare.findFirst({
      where: { workspaceId, pageId, disabledByOperatorAt: { not: null } },
      select: { id: true },
    }),
    db.pageShare.count({ where: { userId, disabledByOperatorAt: { not: null } } }),
  ]);
  if (page) return "page";
  return disabled >= OPERATOR_DISABLED_SHARES_BLOCK ? "account" : null;
}

/** True when the user owns this workspace (not in the trash) and it holds the page. */
export async function ownsPage(userId: string, workspaceId: string, pageId: string): Promise<boolean> {
  const row = await prisma.workspace.findFirst({
    where: { id: workspaceId, ownerId: userId, ...NOT_TRASHED },
    select: { id: true, name: true, data: true },
  });
  if (!row) return false;
  return Boolean(parseStoredWorkspace(row)?.pages.some((p) => p.id === pageId));
}

async function activeShareOf(userId: string, workspaceId: string, pageId: string) {
  return prisma.pageShare.findFirst({
    where: { userId, workspaceId, pageId, revokedAt: null },
    orderBy: { createdAt: "desc" },
    select: { token: true, createdAt: true, viewCount: true },
  });
}

/** Whether the page is shared, for its owner (null: not their page). */
export async function getShareState(userId: string, workspaceId: string, pageId: string): Promise<ShareState | null> {
  if (!(await ownsPage(userId, workspaceId, pageId))) return null;
  const share = await activeShareOf(userId, workspaceId, pageId);
  if (share) return { enabled: true, ...share };
  const blocked = await shareBlock(prisma, userId, workspaceId, pageId);
  return blocked ? { enabled: false, blocked } : { enabled: false };
}

/**
 * Revoke the student's active links that can no longer open anything (their
 * page was deleted, their workspace trashed or deleted): run only at the
 * cap, so a link the student cannot reach from the editor any more never
 * holds a place for good. Returns how many were revoked.
 */
async function revokeDeadShares(tx: LockedTx, userId: string): Promise<number> {
  const shares = await tx.pageShare.findMany({
    where: { userId, revokedAt: null },
    select: { id: true, workspaceId: true, pageId: true },
  });
  const rows = await tx.workspace.findMany({
    where: { id: { in: [...new Set(shares.map((s) => s.workspaceId))] }, ownerId: userId, ...NOT_TRASHED },
    select: { id: true, name: true, data: true },
  });
  const pages = new Map(rows.map((row) => [row.id, new Set(parseStoredWorkspace(row)?.pages.map((p) => p.id) ?? [])]));
  const dead = shares.filter((s) => !pages.get(s.workspaceId)?.has(s.pageId)).map((s) => s.id);
  if (dead.length === 0) return 0;
  await tx.pageShare.updateMany({ where: { id: { in: dead }, userId, revokedAt: null }, data: { revokedAt: new Date() } });
  return dead.length;
}

export type EnableShareResult =
  | { status: "ok"; state: Extract<ShareState, { enabled: true }> }
  | { status: "not_found" }
  | { status: "limit" }
  /** An operator turned this page's link off after a report. */
  | { status: "page_disabled" }
  /** The student has too many links an operator turned off. */
  | { status: "sharing_blocked" };

/**
 * Share the page: its active link, or a new one (one active link per page).
 * Refused for a page an operator turned off, and for a student with
 * OPERATOR_DISABLED_SHARES_BLOCK such links.
 */
export async function enableShare(userId: string, workspaceId: string, pageId: string): Promise<EnableShareResult> {
  if (!(await ownsPage(userId, workspaceId, pageId))) return { status: "not_found" };
  return withKeyLock(userLockKey("page-share", userId), async (tx) => {
    const blocked = await shareBlock(tx, userId, workspaceId, pageId);
    if (blocked === "page") return { status: "page_disabled" } as const;
    if (blocked === "account") return { status: "sharing_blocked" } as const;
    const existing = await tx.pageShare.findFirst({
      where: { userId, workspaceId, pageId, revokedAt: null },
      orderBy: { createdAt: "desc" },
      select: { token: true, createdAt: true, viewCount: true },
    });
    if (existing) return { status: "ok", state: { enabled: true, ...existing } } as const;
    let active = await tx.pageShare.count({ where: { userId, revokedAt: null } });
    if (active >= MAX_ACTIVE_SHARES_PER_USER) active -= await revokeDeadShares(tx, userId);
    if (active >= MAX_ACTIVE_SHARES_PER_USER) return { status: "limit" } as const;
    const created = await tx.pageShare.create({
      data: { token: newShareToken(), userId, workspaceId, pageId },
      select: { token: true, createdAt: true, viewCount: true },
    });
    return { status: "ok", state: { enabled: true, ...created } } as const;
  });
}

/** Stop sharing the page: its link stops working for good. Scoped to the owner's own shares. */
export async function disableShare(userId: string, workspaceId: string, pageId: string): Promise<number> {
  const result = await prisma.pageShare.updateMany({
    where: { userId, workspaceId, pageId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  return result.count;
}

// ---- Views ---------------------------------------------------------------------

const HOUR_MS = 60 * 60 * 1000;
/** One counted view per address and link per hour (per instance; a hint, not analytics). */
const viewLimiter = createMemoryRateLimiter({ limit: 1, windowMs: HOUR_MS, maxKeys: 20_000 });

// ---- Reports -------------------------------------------------------------------

/**
 * Store a visitor's report about a share. Past SHARE_REPORTS_OPEN_CAP open
 * reports for one share nothing more is stored ("capped"); the visitor is
 * thanked all the same, since the page is already waiting for review.
 */
export async function storeShareReport(
  shareId: string,
  reason: ShareReportReason,
  message: string | null,
): Promise<"stored" | "capped"> {
  const open = await prisma.shareReport.count({ where: { shareId, status: "new" } });
  if (open >= SHARE_REPORTS_OPEN_CAP) return "capped";
  await prisma.shareReport.create({ data: { shareId, reason, message } });
  return "stored";
}

/** Count a view of an active share, unless this address was counted for it within the hour. */
export async function recordShareView(shareId: string, clientKey: string): Promise<boolean> {
  if (!viewLimiter(`${clientKey}|${shareId}`)) return false;
  await prisma.pageShare.updateMany({
    where: { id: shareId, revokedAt: null },
    data: { viewCount: { increment: 1 }, lastViewedAt: new Date() },
  });
  return true;
}
