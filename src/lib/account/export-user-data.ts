/**
 * GDPR access/portability: everything StudyOS stores about one user, as one
 * JSON document. Every model in prisma/schema.prisma is either exported here
 * or listed in EXPORT_EXCLUDED_MODELS with its reason (a test checks this):
 *  - WorkspaceChange: before/after copies of the workspaces already
 *    included, kept only for undo;
 *  - AgentTask: transport rows of a running agent task (they expire within
 *    minutes; their replies are in agentConversations);
 *  - DeletedAccount: the tombstone of an erased account (no live user has one);
 *  - ShareReport: reports other people sent about a shared page (their
 *    messages, kept for moderation; erased with the account);
 *  - ErrorEvent: server error counts for the operator console, grouped by
 *    kind, with no user id (nothing in it belongs to any one student);
 *  - ReferralMailbox: the invite program's register of keyed mailbox
 *    hashes, with no user id or address (no row can be told to be anyone's
 *    without the server key; lib/referral/mailbox.ts);
 *  - AccountDeletionReason: why deleted accounts left, with no user id (a
 *    live account has none).
 * Credentials are never exported: the calendar feed token is reported as
 * present/absent, connected feed links by host, push subscriptions as devices
 * (label and dates, never their endpoint or keys), shared page links without
 * their token, Stripe ids only as "has a customer".
 *
 * The document is STREAMED (streamUserDataExport): workspaces (up to 2 MB
 * each), study material (up to a few hundred KB each) and agent chat
 * messages (one row per message, growing with use) are read a page at a time
 * as the download is consumed, so an export never holds a user's whole data
 * in memory at once. Everything else is small and loaded up front.
 */
import "server-only";

import { prisma } from "@/lib/db";
import { claimWithinLimit } from "@/lib/usage-limits";

export const EXPORT_FORMAT_VERSION = 1;

/** Exports per user per window (each one reads every workspace). */
export const EXPORT_LIMIT = { max: 5, windowMs: 24 * 60 * 60 * 1000 } as const;
export const EXPORT_KIND = "data_export";

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

// ---- The large collections, read in small batches ------------------------

/** Workspaces read per database round trip (each up to 2 MB). */
export const EXPORT_WORKSPACE_BATCH = 2;
/** Study materials read per round trip (each up to a few hundred KB). */
export const EXPORT_MATERIAL_BATCH = 5;
/** Agent chat messages read per round trip (each at most a few KB). */
export const EXPORT_CHAT_BATCH = 200;

/** Models deliberately not in the export (see the header for why). */
export const EXPORT_EXCLUDED_MODELS = [
  "WorkspaceChange",
  "AgentTask",
  "DeletedAccount",
  "ShareReport",
  "ErrorEvent",
  "ReferralMailbox",
  "AccountDeletionReason",
] as const;

/**
 * The streamed collections. Each lists only ids first (cheap), then loads
 * rows `batch` at a time, in the listed order, when the consumer asks.
 */
const STREAMED = {
  // Includes workspaces in the trash (deletedAt set): still stored, so still exported.
  workspaces: {
    batch: EXPORT_WORKSPACE_BATCH,
    listIds: (userId: string) =>
      prisma.workspace.findMany({
        where: { ownerId: userId },
        orderBy: { createdAt: "asc" },
        select: { id: true },
      }),
    load: async (userId: string, ids: string[]) =>
      (
        await prisma.workspace.findMany({
          where: { ownerId: userId, id: { in: ids } },
          select: { id: true, name: true, icon: true, data: true, version: true, deletedAt: true, createdAt: true, updatedAt: true },
        })
      ).map((w) => ({ ...w, data: parseJson(w.data) })),
  },
  // Course material the student uploaded or pasted, with its text (also
  // material of workspaces in the trash: still stored, so still exported).
  studyMaterials: {
    batch: EXPORT_MATERIAL_BATCH,
    listIds: (userId: string) =>
      prisma.studyMaterial.findMany({
        where: { ownerId: userId },
        orderBy: { createdAt: "asc" },
        select: { id: true },
      }),
    load: async (userId: string, ids: string[]) =>
      (
        await prisma.studyMaterial.findMany({
          where: { ownerId: userId, id: { in: ids } },
          select: {
            id: true, workspaceId: true, title: true, kind: true, pages: true, sourcePages: true,
            truncated: true, sourcePageId: true, createdAt: true, updatedAt: true,
          },
        })
      ).map((m) => ({ ...m, pages: parseJson(m.pages) })),
  },
  // The AI agent conversations, per workspace (what the student and the
  // agent wrote; internal change notes and render metadata are left out).
  agentConversations: {
    batch: EXPORT_CHAT_BATCH,
    listIds: (userId: string) =>
      prisma.agentChatMessage.findMany({
        where: { userId },
        orderBy: [{ workspaceId: "asc" }, { createdAt: "asc" }],
        select: { id: true },
      }),
    load: (userId: string, ids: string[]) =>
      prisma.agentChatMessage.findMany({
        where: { userId, id: { in: ids } },
        select: { id: true, workspaceId: true, role: true, content: true, createdAt: true },
      }),
  },
} as const;

type StreamedKey = keyof typeof STREAMED;
type ExportProfile = { email?: string | null; name?: string | null };

async function* streamCollection(userId: string, key: StreamedKey): AsyncGenerator<string> {
  const spec = STREAMED[key];
  const ids = (await spec.listIds(userId)).map((row) => row.id);
  let first = true;
  for (let at = 0; at < ids.length; at += spec.batch) {
    const batch = ids.slice(at, at + spec.batch);
    const rows: { id: string }[] = await spec.load(userId, batch);
    // Keep the listed order (an IN query does not promise one).
    const byId = new Map(rows.map((row) => [row.id, row]));
    for (const id of batch) {
      const row = byId.get(id);
      if (!row) continue; // deleted while the export ran
      yield `${first ? "" : ","}${JSON.stringify(row)}`;
      first = false;
    }
  }
}

/** The JSON document, piece by piece (valid JSON once concatenated). */
export async function* userDataExportChunks(
  userId: string,
  profile: ExportProfile = {},
  now = new Date(),
): AsyncGenerator<string> {
  const summary = await loadExportSummary(userId, profile, now);
  const { format, version, exportedAt, account, ...rest } = summary;
  yield `{"format":${JSON.stringify(format)},"version":${version},"exportedAt":${JSON.stringify(exportedAt)},"account":${JSON.stringify(account)}`;
  for (const key of Object.keys(STREAMED) as StreamedKey[]) {
    yield `,${JSON.stringify(key)}:[`;
    yield* streamCollection(userId, key);
    yield "]";
  }
  for (const [key, value] of Object.entries(rest)) {
    yield `,${JSON.stringify(key)}:${JSON.stringify(value)}`;
  }
  yield "}";
}

/**
 * The export as a byte stream that reads the next batch only when the
 * consumer pulls. Loads the small summary before returning, so a database
 * failure surfaces as a rejected promise (a clean 500) rather than a broken
 * download.
 */
export async function streamUserDataExport(
  userId: string,
  profile: ExportProfile = {},
  now = new Date(),
  onError: (error: unknown) => void = () => {},
): Promise<ReadableStream<Uint8Array>> {
  const chunks = userDataExportChunks(userId, profile, now);
  const first = await chunks.next();
  const encoder = new TextEncoder();
  let pending: string | null = first.done ? null : first.value;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        if (pending !== null) {
          controller.enqueue(encoder.encode(pending));
          pending = null;
          return;
        }
        const next = await chunks.next();
        if (next.done) controller.close();
        else controller.enqueue(encoder.encode(next.value));
      } catch (error) {
        onError(error);
        controller.error(error);
      }
    },
    async cancel() {
      await chunks.return(undefined);
    },
  });
}

/**
 * The whole export as one object. For tests and small tools only: it holds
 * every workspace in memory, which is exactly what the download route avoids.
 */
export async function buildUserDataExport(
  userId: string,
  profile: ExportProfile = {},
  now = new Date(),
) {
  let json = "";
  for await (const chunk of userDataExportChunks(userId, profile, now)) json += chunk;
  return JSON.parse(json);
}

/** Everything except the streamed collections (all small). */
async function loadExportSummary(userId: string, profile: ExportProfile, now: Date) {
  const [
    dailyPlans,
    dailyAgentConfig,
    agentRuns,
    studyEvents,
    studyDays,
    focusSessions,
    usageEvents,
    creditAccount,
    creditLedger,
    subscription,
    assets,
    calendarToken,
    importedFeeds,
    creditHolds,
    billingEvents,
    billingIntents,
    notificationPrefs,
    pushDevices,
    notificationLog,
    feedback,
    pageShares,
    referralCode,
    referralsMade,
    invitedBy,
    contractNotices,
  ] = await Promise.all([
    prisma.dailyStudyPlan.findMany({
      where: { userId },
      orderBy: { localDate: "asc" },
      select: {
        localDate: true, timeZone: true, summary: true, items: true, details: true, version: true,
        sourceCount: true, candidateCount: true, generatedAt: true, updatedAt: true,
      },
    }),
    prisma.dailyStudyAgentConfig.findUnique({
      where: { userId },
      select: { enabled: true, dailyMinutes: true, timeZone: true, createdAt: true, updatedAt: true },
    }),
    prisma.agentRun.findMany({
      where: { userId },
      orderBy: { startedAt: "asc" },
      select: { agentKey: true, trigger: true, status: true, summary: true, error: true, startedAt: true, completedAt: true },
    }),
    prisma.usageEvent.findMany({
      where: { userId, kind: "evt:study_reviewed" },
      orderBy: { createdAt: "asc" },
      select: { createdAt: true },
    }),
    prisma.studyDay.findMany({
      where: { userId },
      orderBy: [{ localDate: "asc" }, { workspaceId: "asc" }],
      select: {
        workspaceId: true, localDate: true, reviews: true, again: true, hard: true, good: true,
        easy: true, newCards: true, reviewTotal: true, reviewPassed: true, practice: true,
        quizAnswers: true, quizCorrect: true,
      },
    }),
    // Focus timer sessions: what the student focused on, when and how long.
    prisma.focusSession.findMany({
      where: { userId },
      orderBy: { startedAt: "asc" },
      select: {
        workspaceId: true, itemKey: true, label: true, localDate: true, startedAt: true, seconds: true,
        completed: true, createdAt: true,
      },
    }),
    prisma.usageEvent.findMany({
      where: { userId, NOT: { kind: "evt:study_reviewed" } },
      orderBy: { createdAt: "asc" },
      select: { kind: true, createdAt: true },
    }),
    prisma.creditAccount.findUnique({
      where: { userId },
      select: { balance: true, createdAt: true, updatedAt: true },
    }),
    prisma.creditLedger.findMany({
      where: { userId },
      orderBy: { createdAt: "asc" },
      select: { delta: true, reason: true, createdAt: true },
    }),
    prisma.subscription.findUnique({
      where: { userId },
      select: {
        status: true, currentPeriodEnd: true, stripeCustomerId: true, allowancePeriodStart: true,
        allowancePeriodEnd: true, allowanceYearly: true, updatedAt: true,
      },
    }),
    prisma.asset.findMany({
      where: { ownerId: userId },
      orderBy: { createdAt: "asc" },
      select: { id: true, workspaceId: true, mime: true, sizeBytes: true, createdAt: true },
    }),
    prisma.calendarToken.findUnique({ where: { userId }, select: { createdAt: true } }),
    // Incoming calendar feeds the student connected. The link itself is a
    // credential to their calendar and is never exported, only its host.
    prisma.calendarFeed.findMany({
      where: { userId },
      orderBy: { createdAt: "asc" },
      select: {
        workspaceId: true, databaseId: true, label: true, platform: true, settings: true,
        lastSyncedAt: true, lastAttemptAt: true, lastError: true, lastSummary: true,
        createdAt: true, updatedAt: true,
      },
    }),
    // Credits reserved for AI work (normally settled within seconds).
    prisma.creditHold.findMany({
      where: { userId },
      orderBy: { createdAt: "asc" },
      select: { amount: true, reason: true, state: true, charged: true, createdAt: true, expiresAt: true, settledAt: true },
    }),
    // Money movements other than grants (refunds, disputes), without Stripe ids.
    prisma.billingEvent.findMany({
      where: { userId },
      orderBy: { createdAt: "asc" },
      select: { kind: true, amountCents: true, credits: true, createdAt: true },
    }),
    // Billing jobs run for the account (e.g. a duplicate subscription refunded).
    prisma.billingIntent.findMany({
      where: { userId },
      orderBy: { createdAt: "asc" },
      select: { kind: true, reason: true, state: true, createdAt: true, completedAt: true },
    }),
    prisma.notificationPreference.findUnique({
      where: { userId },
      select: {
        timeZone: true, locale: true, dailyEnabled: true, dailyMinute: true, deadlineEnabled: true,
        deadlineMinute: true, deadlineLeads: true, examLeads: true, streakEnabled: true,
        weeklyEnabled: true, weeklyDay: true, weeklyMinute: true,
        quietEnabled: true, quietStart: true, quietEnd: true,
        // The email switch and a recorded rejection; the address itself is
        // never stored by StudyOS (it lives in the Clerk account).
        emailEnabled: true, emailBouncedAt: true,
        createdAt: true, updatedAt: true,
      },
    }),
    // The endpoint is a capability URL to the device: never exported.
    prisma.pushSubscription.findMany({
      where: { userId },
      orderBy: { createdAt: "asc" },
      select: { label: true, lastSuccessAt: true, createdAt: true },
    }),
    prisma.notificationLog.findMany({
      where: { userId },
      orderBy: { createdAt: "asc" },
      select: { kind: true, localDate: true, status: true, message: true, createdAt: true, sentAt: true },
    }),
    // Messages the student sent with "Send feedback", and where each stands.
    prisma.feedback.findMany({
      where: { userId },
      orderBy: { createdAt: "asc" },
      select: { kind: true, message: true, pagePath: true, locale: true, contactOk: true, status: true, createdAt: true },
    }),
    // Pages the student shared with a link (the page is in its exported
    // workspace). The token is the link itself, a credential: never exported.
    prisma.pageShare.findMany({
      where: { userId },
      orderBy: { createdAt: "asc" },
      select: { workspaceId: true, pageId: true, createdAt: true, revokedAt: true, viewCount: true, lastViewedAt: true },
    }),
    // Invites (lib/referral): the student's own link; the friends who joined
    // through it by date only (never who they are, and never the attempts
    // that were refused, which say something about the person who made
    // them); and whether the student was invited (never by whom, nor the
    // fraud check that refused it: only "not eligible").
    prisma.referralCode.findUnique({ where: { userId }, select: { code: true, createdAt: true } }),
    prisma.referral.findMany({
      where: { referrerId: userId, status: { in: ["pending", "rewarded"] } },
      orderBy: { createdAt: "asc" },
      select: { createdAt: true, rewardedAt: true },
    }),
    prisma.referral.findUnique({
      where: { refereeId: userId },
      select: { status: true, createdAt: true, rewardedAt: true },
    }),
    // Withdrawals and cancellations the student declared while signed in
    // (/withdraw, /cancel), as sent, and where each stands. Stripe ids are
    // left out, like everywhere in the export.
    prisma.contractNotice.findMany({
      where: { userId },
      orderBy: { receivedAt: "asc" },
      select: {
        kind: true, name: true, email: true, contractKind: true, details: true, cancelType: true, reason: true,
        requestedEnd: true, locale: true, receivedAt: true, status: true, handledAt: true, ackStatus: true,
        proEndsAt: true,
      },
    }),
  ]);

  return {
    format: "studyos-data-export",
    version: EXPORT_FORMAT_VERSION,
    exportedAt: now.toISOString(),
    account: { userId, email: profile.email ?? null, name: profile.name ?? null },
    study: {
      reviewDays: studyEvents.map((e) => e.createdAt),
      reviewsPerDay: studyDays,
      focusSessions,
      dailyAgent: dailyAgentConfig,
      dailyPlans: dailyPlans.map((p) => ({ ...p, items: parseJson(p.items), details: parseJson(p.details) })),
      agentRuns,
    },
    credits: {
      balance: creditAccount?.balance ?? 0,
      account: creditAccount,
      ledger: creditLedger,
      holds: creditHolds,
    },
    subscription: subscription
      ? {
          status: subscription.status,
          currentPeriodEnd: subscription.currentPeriodEnd,
          hasStripeCustomer: Boolean(subscription.stripeCustomerId),
          allowancePeriodStart: subscription.allowancePeriodStart,
          allowancePeriodEnd: subscription.allowancePeriodEnd,
          allowanceYearly: subscription.allowanceYearly,
          updatedAt: subscription.updatedAt,
        }
      : { status: "free", currentPeriodEnd: null, hasStripeCustomer: false, updatedAt: null },
    billing: { events: billingEvents, jobs: billingIntents },
    contractNotices,
    assets,
    calendarFeed: { enabled: Boolean(calendarToken), createdAt: calendarToken?.createdAt ?? null },
    importedCalendars: importedFeeds.map((f) => ({
      ...f,
      settings: parseJson(f.settings),
      lastSummary: f.lastSummary ? parseJson(f.lastSummary) : null,
    })),
    notifications: {
      preferences: notificationPrefs
        ? {
            ...notificationPrefs,
            deadlineLeads: parseJson(notificationPrefs.deadlineLeads),
            examLeads: parseJson(notificationPrefs.examLeads),
          }
        : null,
      devices: pushDevices,
      sent: notificationLog,
    },
    feedback,
    sharedPages: pageShares,
    referrals: {
      inviteCode: referralCode,
      friendsInvited: referralsMade.length,
      invited: referralsMade.map((r) => ({ joinedAt: r.createdAt, rewardedAt: r.rewardedAt })),
      invitedBy: invitedBy
        ? {
            status: invitedBy.status === "rejected" ? "not_eligible" : invitedBy.status,
            invitedAt: invitedBy.createdAt,
            rewardedAt: invitedBy.rewardedAt,
          }
        : null,
    },
    usageEvents,
  };
}

/**
 * Exports allowed per user (EXPORT_LIMIT), counted and recorded atomically
 * under the user's lock (lib/usage-limits claimWithinLimit): parallel
 * requests cannot all pass the count before any of them records.
 */
export async function allowDataExport(userId: string): Promise<boolean> {
  const claim = await claimWithinLimit(userId, EXPORT_KIND, EXPORT_LIMIT.max, EXPORT_LIMIT.windowMs);
  return claim.allowed;
}
