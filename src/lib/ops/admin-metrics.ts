/**
 * The numbers behind the operator console (/app/admin). Every query is a
 * count or an aggregate over a date window (or a short, newest-first list),
 * so the page stays cheap however large the tables grow: nothing here loads a
 * whole table.
 *
 * Windows: "day" = the last 24 hours, "week" = 7 days, "month" = 30 days,
 * all counted back from `now`.
 */
import "server-only";

import { clerkClient } from "@clerk/nextjs/server";
import { prisma } from "@/lib/db";
import { FEEDBACK_STATUSES, type FeedbackKind, type FeedbackStatus } from "@/lib/feedback";
import { ADMIN_ADJUST_REASON } from "@/lib/ops/credit-adjust";
import { REFERRAL_REASONS } from "@/lib/referral/config";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

export const WINDOWS = { day: DAY_MS, week: 7 * DAY_MS, month: 30 * DAY_MS } as const;
export type WindowKey = keyof typeof WINDOWS;
export type PerWindow = Record<WindowKey, number>;

const WINDOW_KEYS = Object.keys(WINDOWS) as WindowKey[];

const ago = (now: Date, ms: number) => new Date(now.getTime() - ms);

async function perWindow(now: Date, count: (since: Date) => Promise<number>): Promise<PerWindow> {
  const values = await Promise.all(WINDOW_KEYS.map((key) => count(ago(now, WINDOWS[key]))));
  return Object.fromEntries(WINDOW_KEYS.map((key, i) => [key, values[i]])) as PerWindow;
}

const toNumber = (value: bigint | number | null | undefined) => Number(value ?? 0);

// ---- Accounts ----------------------------------------------------------------

export interface AccountMetrics {
  total: number;
  /** New accounts: every account gets its CreditAccount row (with the trial grant) on first sight. */
  new: PerWindow;
  /** Distinct students with any activity (see activeStudents). */
  active: { week: number; month: number };
}

/**
 * Distinct students who did something in the last 7 and 30 days: edited a
 * workspace, studied (flashcards or quizzes), ran a focus-timer block, were
 * charged credits for AI work, or triggered any recorded app event (the same
 * sources as the activation section, lib/ops/activation-metrics.ts). One aggregate query. (An
 * operator's deduction, ledger reason 'admin_adjust' = ADMIN_ADJUST_REASON,
 * is not the student doing something.)
 */
export async function activeStudents(now = new Date()): Promise<{ week: number; month: number }> {
  const week = ago(now, WINDOWS.week);
  const month = ago(now, WINDOWS.month);
  const rows = await prisma.$queryRaw<{ week: bigint | number; month: bigint | number }[]>`
    SELECT COUNT(DISTINCT a.uid) FILTER (WHERE a.at >= ${week}) AS "week",
           COUNT(DISTINCT a.uid) AS "month"
    FROM (
      SELECT "ownerId" AS uid, "updatedAt" AS at FROM "Workspace"
        WHERE "updatedAt" >= ${month} AND "ownerId" <> 'local'
      UNION ALL
      SELECT "userId", "updatedAt" FROM "StudyDay" WHERE "updatedAt" >= ${month}
      UNION ALL
      SELECT "userId", "startedAt" FROM "FocusSession" WHERE "startedAt" >= ${month}
      UNION ALL
      SELECT "userId", "createdAt" FROM "CreditLedger"
        WHERE "createdAt" >= ${month} AND "delta" < 0 AND "reason" <> 'admin_adjust'
      UNION ALL
      SELECT "userId", "createdAt" FROM "UsageEvent" WHERE "createdAt" >= ${month}
    ) AS a`;
  return { week: toNumber(rows[0]?.week), month: toNumber(rows[0]?.month) };
}

export async function accountMetrics(now = new Date()): Promise<AccountMetrics> {
  const [total, created, active] = await Promise.all([
    prisma.creditAccount.count(),
    perWindow(now, (since) => prisma.creditAccount.count({ where: { createdAt: { gte: since } } })),
    activeStudents(now),
  ]);
  return { total, new: created, active };
}

// ---- Revenue -------------------------------------------------------------------

export interface RevenueMetrics {
  /** Subscription rows by Stripe status ("active" is Pro), largest first. */
  subscriptions: { status: string; count: number }[];
  /** Billing events of the last 30 days by kind, with their summed amounts (minor units). */
  billingEvents: { kind: string; count: number; amountCents: number }[];
  /** Credit packs sold (one "credit_purchase" grant each). */
  packsSold: { month: number; total: number };
}

export async function revenueMetrics(now = new Date()): Promise<RevenueMetrics> {
  const month = ago(now, WINDOWS.month);
  const [subscriptions, events, packsMonth, packsTotal] = await Promise.all([
    prisma.subscription.groupBy({ by: ["status"], _count: { _all: true } }),
    prisma.billingEvent.groupBy({
      by: ["kind"],
      where: { createdAt: { gte: month } },
      _count: { _all: true },
      _sum: { amountCents: true },
    }),
    prisma.creditLedger.count({ where: { reason: "credit_purchase", createdAt: { gte: month } } }),
    prisma.creditLedger.count({ where: { reason: "credit_purchase" } }),
  ]);
  return {
    subscriptions: subscriptions
      .map((row) => ({ status: row.status, count: row._count._all }))
      .sort((a, b) => b.count - a.count || a.status.localeCompare(b.status)),
    billingEvents: events
      .map((row) => ({ kind: row.kind, count: row._count._all, amountCents: row._sum.amountCents ?? 0 }))
      .sort((a, b) => b.amountCents - a.amountCents || b.count - a.count),
    packsSold: { month: packsMonth, total: packsTotal },
  };
}

// ---- AI usage ------------------------------------------------------------------

/**
 * Ledger reasons that are not AI spending: grants, purchases, their
 * reversals, operator adjustments and the invite bonuses.
 */
export const NON_SPEND_REASONS: ReadonlySet<string> = new Set([
  "free_signup",
  "pro_monthly",
  "credit_purchase",
  "credit_reversal",
  "credit_reversal_restored",
  ADMIN_ADJUST_REASON,
  ...REFERRAL_REASONS,
]);

/**
 * The AI action a ledger reason belongs to ("generate" for generate_hold,
 * generate_release, generate_cancelled ...), or null when the reason is not
 * spending. A run reserves its price (`_hold`), then settles the difference
 * under the action's name or gives it back (`_release`); summing them all is
 * what the action really cost. Every referral_* reason is an invite bonus
 * (lib/referral), never spending.
 */
export function spendAction(reason: string): string | null {
  if (NON_SPEND_REASONS.has(reason) || reason.startsWith("referral_")) return null;
  return reason.replace(/_(hold|release|cancelled|failed)$/, "");
}

export interface CreditSpend {
  total: number;
  byAction: { action: string; credits: number }[];
}

/** Net credits charged for AI work since `since`, by action (holds given back are subtracted). */
export async function creditsSpentSince(since: Date): Promise<CreditSpend> {
  const rows = await prisma.creditLedger.groupBy({
    by: ["reason"],
    where: { createdAt: { gte: since } },
    _sum: { delta: true },
  });
  const byAction = new Map<string, number>();
  for (const row of rows) {
    const action = spendAction(row.reason);
    if (!action) continue;
    byAction.set(action, (byAction.get(action) ?? 0) - (row._sum.delta ?? 0));
  }
  const list = [...byAction]
    .map(([action, credits]) => ({ action, credits }))
    .filter((entry) => entry.credits !== 0)
    .sort((a, b) => b.credits - a.credits || a.action.localeCompare(b.action));
  return { total: list.reduce((sum, entry) => sum + entry.credits, 0), byAction: list };
}

/** Longest error text shown for a failed run. */
export const ERROR_PREVIEW_CHARS = 240;

export function truncate(text: string | null | undefined, max: number): string {
  const value = (text ?? "").trim();
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

export interface AiUsageMetrics {
  creditsSpent: Record<WindowKey, CreditSpend>;
  /** Workspaces the AI built (a completed build each). */
  workspacesBuilt: PerWindow;
  /** Study kits made from students' material. */
  studyKits: PerWindow;
  /** Agent runs started in the last 30 days, by status. */
  agentRuns: { total: number; completed: number; failed: number; running: number; failureRate: number | null };
  recentFailures: { id: string; agentKey: string; trigger: string; error: string; startedAt: Date }[];
}

export async function aiUsageMetrics(now = new Date()): Promise<AiUsageMetrics> {
  const month = ago(now, WINDOWS.month);
  const [spent, workspacesBuilt, studyKits, runs, failures] = await Promise.all([
    Promise.all(WINDOW_KEYS.map((key) => creditsSpentSince(ago(now, WINDOWS[key])))),
    perWindow(now, (since) =>
      prisma.usageEvent.count({ where: { kind: "evt:generate_complete", createdAt: { gte: since } } }),
    ),
    perWindow(now, (since) =>
      prisma.usageEvent.count({ where: { kind: "evt:study_kit_complete", createdAt: { gte: since } } }),
    ),
    prisma.agentRun.groupBy({ by: ["status"], where: { startedAt: { gte: month } }, _count: { _all: true } }),
    prisma.agentRun.findMany({
      where: { status: "failed", startedAt: { gte: month } },
      orderBy: { startedAt: "desc" },
      take: 8,
      select: { id: true, agentKey: true, trigger: true, error: true, startedAt: true },
    }),
  ]);
  const byStatus = new Map(runs.map((row) => [row.status, row._count._all]));
  const completed = byStatus.get("completed") ?? 0;
  const failed = byStatus.get("failed") ?? 0;
  const running = byStatus.get("running") ?? 0;
  const total = runs.reduce((sum, row) => sum + row._count._all, 0);
  return {
    creditsSpent: Object.fromEntries(WINDOW_KEYS.map((key, i) => [key, spent[i]])) as Record<WindowKey, CreditSpend>,
    workspacesBuilt,
    studyKits,
    agentRuns: {
      total,
      completed,
      failed,
      running,
      failureRate: completed + failed > 0 ? failed / (completed + failed) : null,
    },
    recentFailures: failures.map((run) => ({ ...run, error: truncate(run.error, ERROR_PREVIEW_CHARS) || "(no error text)" })),
  };
}

// ---- Content -------------------------------------------------------------------

export interface ContentMetrics {
  /** Every stored workspace, trash included. */
  total: number;
  createdWeek: number;
  inTrash: number;
}

export async function contentMetrics(now = new Date()): Promise<ContentMetrics> {
  const [total, createdWeek, inTrash] = await Promise.all([
    prisma.workspace.count(),
    prisma.workspace.count({ where: { createdAt: { gte: ago(now, WINDOWS.week) } } }),
    prisma.workspace.count({ where: { deletedAt: { not: null } } }),
  ]);
  return { total, createdWeek, inTrash };
}

// ---- Feedback inbox ------------------------------------------------------------

export type InboxFilter = FeedbackStatus | "all";

/** Messages listed per inbox view (newest first). */
export const INBOX_PAGE_SIZE = 50;

export function parseInboxFilter(value: unknown): InboxFilter {
  const text = Array.isArray(value) ? value[0] : value;
  return (FEEDBACK_STATUSES as readonly string[]).includes(text as string) || text === "all"
    ? (text as InboxFilter)
    : "new";
}

export interface InboxItem {
  id: string;
  userId: string;
  kind: FeedbackKind | string;
  message: string;
  pagePath: string | null;
  locale: string | null;
  contactOk: boolean;
  status: FeedbackStatus | string;
  createdAt: Date;
  /** The student's address, looked up only when they agreed to be contacted. */
  email: string | null;
}

export interface FeedbackInbox {
  filter: InboxFilter;
  items: InboxItem[];
  counts: Record<InboxFilter, number>;
}

/**
 * Email addresses of the given users, by id, from Clerk (one batched call).
 * Never throws: when Clerk cannot be reached the map is empty and the console
 * shows the user id instead.
 */
export async function contactEmails(userIds: readonly string[]): Promise<Map<string, string>> {
  const ids = [...new Set(userIds)].slice(0, INBOX_PAGE_SIZE);
  const emails = new Map<string, string>();
  if (ids.length === 0) return emails;
  try {
    const client = await clerkClient();
    const { data } = await client.users.getUserList({ userId: ids, limit: ids.length });
    for (const user of data) {
      const email = user.primaryEmailAddress?.emailAddress ?? user.emailAddresses?.[0]?.emailAddress;
      if (email) emails.set(user.id, email);
    }
  } catch {
    // Failure-tolerant on purpose: the inbox must load without Clerk.
  }
  return emails;
}

export async function feedbackInbox(filter: InboxFilter = "new"): Promise<FeedbackInbox> {
  const [rows, groups] = await Promise.all([
    prisma.feedback.findMany({
      where: filter === "all" ? {} : { status: filter },
      orderBy: { createdAt: "desc" },
      take: INBOX_PAGE_SIZE,
      select: {
        id: true, userId: true, kind: true, message: true, pagePath: true, locale: true,
        contactOk: true, status: true, createdAt: true,
      },
    }),
    prisma.feedback.groupBy({ by: ["status"], _count: { _all: true } }),
  ]);
  const counts = { all: 0, new: 0, read: 0, done: 0 } as Record<InboxFilter, number>;
  for (const row of groups) {
    counts.all += row._count._all;
    if (row.status in counts) counts[row.status as FeedbackStatus] += row._count._all;
  }
  const emails = await contactEmails(rows.filter((row) => row.contactOk).map((row) => row.userId));
  return {
    filter,
    items: rows.map((row) => ({ ...row, email: row.contactOk ? (emails.get(row.userId) ?? null) : null })),
    counts,
  };
}

// ---- Everything at once ----------------------------------------------------------

export interface OperatorSnapshot {
  generatedAt: Date;
  accounts: AccountMetrics;
  revenue: RevenueMetrics;
  ai: AiUsageMetrics;
  content: ContentMetrics;
  inbox: FeedbackInbox;
}

export async function loadOperatorSnapshot(filter: InboxFilter, now = new Date()): Promise<OperatorSnapshot> {
  const [accounts, revenue, ai, content, inbox] = await Promise.all([
    accountMetrics(now),
    revenueMetrics(now),
    aiUsageMetrics(now),
    contentMetrics(now),
    feedbackInbox(filter),
  ]);
  return { generatedAt: now, accounts, revenue, ai, content, inbox };
}
