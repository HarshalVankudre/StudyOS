/**
 * Share links in the operator console (/app/admin): the shared pages
 * visitors reported, and a tiny usage stat. Server-only; the console and its
 * actions check the admin allow-list before calling these.
 *
 * The list is of distinct reported shares (grouped by share in the
 * database), the most recently reported first, each with its number of open
 * reports and its latest few messages, so one page reported a hundred times
 * cannot push every other report out of view. An operator either turns the
 * link off ("Disable link": revoked, marked disabledByOperatorAt so the page
 * cannot simply be shared again, its reports closed) or dismisses the
 * reports (closed, the link stays).
 */
import "server-only";

import { prisma } from "@/lib/db";
import { NOT_TRASHED, parseStoredWorkspace } from "@/lib/workspace/store";

/** Shared pages listed in the console, most recently reported first. */
export const REPORTED_SHARES_SHOWN = 30;
/** Open reports shown per shared page (the newest). */
export const REPORTS_SHOWN_PER_SHARE = 5;

export interface ReportedShare {
  shareId: string;
  token: string;
  /** The page's current title; null when the page or its workspace is gone. */
  pageTitle: string | null;
  pageIcon: string | null;
  active: boolean;
  /** An operator turned this link off (the page cannot be shared again). */
  disabledByOperator: boolean;
  viewCount: number;
  /** How many open reports the share has. */
  openReports: number;
  /** The newest open reports (at most REPORTS_SHOWN_PER_SHARE), newest first. */
  reports: { id: string; reason: string; message: string | null; createdAt: Date }[];
  latestReportAt: Date;
}

/** Shares with open ("new") reports, the most recently reported first. */
export async function reportedShares(): Promise<ReportedShare[]> {
  const groups = await prisma.shareReport.groupBy({
    by: ["shareId"],
    where: { status: "new" },
    _count: { _all: true },
    _max: { createdAt: true },
    orderBy: { _max: { createdAt: "desc" } },
    take: REPORTED_SHARES_SHOWN,
  });
  if (groups.length === 0) return [];

  const shares = await prisma.pageShare.findMany({
    where: { id: { in: groups.map((g) => g.shareId) } },
    select: {
      id: true,
      token: true,
      userId: true,
      workspaceId: true,
      pageId: true,
      revokedAt: true,
      disabledByOperatorAt: true,
      viewCount: true,
      reports: {
        where: { status: "new" },
        orderBy: { createdAt: "desc" },
        take: REPORTS_SHOWN_PER_SHARE,
        select: { id: true, reason: true, message: true, createdAt: true },
      },
    },
  });
  const byId = new Map(shares.map((s) => [s.id, s]));

  // Each workspace is read once, however many of its pages were reported.
  const workspaceIds = [...new Set(shares.map((s) => s.workspaceId))];
  const workspaces = await prisma.workspace.findMany({
    where: { id: { in: workspaceIds }, ...NOT_TRASHED },
    select: { id: true, ownerId: true, name: true, data: true },
  });
  const docs = new Map(workspaces.map((w) => [w.id, { ownerId: w.ownerId, doc: parseStoredWorkspace(w) }]));

  const out: ReportedShare[] = [];
  for (const group of groups) {
    const share = byId.get(group.shareId);
    if (!share || share.reports.length === 0) continue;
    const stored = docs.get(share.workspaceId);
    const page =
      stored && stored.ownerId === share.userId ? stored.doc?.pages.find((p) => p.id === share.pageId) : undefined;
    out.push({
      shareId: share.id,
      token: share.token,
      pageTitle: page ? page.title : null,
      pageIcon: page?.icon ?? null,
      active: share.revokedAt === null,
      disabledByOperator: share.disabledByOperatorAt !== null,
      viewCount: share.viewCount,
      openReports: group._count._all,
      reports: share.reports,
      latestReportAt: group._max.createdAt ?? share.reports[0].createdAt,
    });
  }
  return out;
}

/** Active share links and their counted views. One aggregate query. */
export async function shareStats(): Promise<{ active: number; views: number }> {
  const result = await prisma.pageShare.aggregate({
    where: { revokedAt: null },
    _count: { _all: true },
    _sum: { viewCount: true },
  });
  return { active: result._count._all, views: result._sum.viewCount ?? 0 };
}

/**
 * "Disable link": turn a reported link off for good. Every active link of
 * that page is revoked, the share is marked disabledByOperatorAt (so the
 * student cannot share that page again, and enough such links stop them
 * sharing at all; lib/share/store.ts), and its open reports are closed.
 * Returns false when there is no such share.
 */
export async function disableReportedShare(shareId: string, now = new Date()): Promise<boolean> {
  const share = await prisma.pageShare.findUnique({
    where: { id: shareId },
    select: { workspaceId: true, pageId: true },
  });
  if (!share) return false;
  await prisma.$transaction([
    prisma.pageShare.updateMany({
      where: { workspaceId: share.workspaceId, pageId: share.pageId, revokedAt: null },
      data: { revokedAt: now },
    }),
    prisma.pageShare.updateMany({
      where: { id: shareId, disabledByOperatorAt: null },
      data: { disabledByOperatorAt: now },
    }),
    prisma.shareReport.updateMany({ where: { shareId, status: "new" }, data: { status: "done" } }),
  ]);
  return true;
}

/** "Dismiss reports": close a share's open reports and keep its link as it is. */
export async function dismissShareReports(shareId: string): Promise<number> {
  const result = await prisma.shareReport.updateMany({ where: { shareId, status: "new" }, data: { status: "done" } });
  return result.count;
}
