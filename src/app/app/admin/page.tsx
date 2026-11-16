import { randomUUID } from "node:crypto";
import type { Metadata } from "next";
import Link from "next/link";
import { auth } from "@clerk/nextjs/server";
import { BrandMark } from "@/components/BrandMark";
import { isAdmin, requireAdmin } from "@/lib/ops/admin";
import {
  activationMetrics,
  COHORT_WEEKS,
  FUNNEL_DAYS,
  rateText,
  shareText,
  type ActivationMetrics,
  type FunnelKey,
  type Share,
} from "@/lib/ops/activation-metrics";
import {
  INBOX_PAGE_SIZE,
  loadOperatorSnapshot,
  parseInboxFilter,
  type InboxFilter,
  type InboxItem,
  type PerWindow,
  type WindowKey,
} from "@/lib/ops/admin-metrics";
import { publicConfigStatus } from "@/lib/ops/env";
import { reportError } from "@/lib/ops/report-error";
import { deletionReasonCounts, type DeletionReasonSummary, type Tenure } from "@/lib/account/deletion-reason";
import { en } from "@/lib/i18n/dictionaries/en";
import { findUserIdsByEmail, parseLookupEmail } from "@/lib/ops/user-search";
import { ERRORS_SHOWN, errorOverview, type ErrorGroup } from "@/lib/ops/error-overview";
import {
  ADMIN_ADJUST_MAX,
  ADMIN_ADJUST_REASON,
  ADMIN_NOTE_MAX_CHARS,
  lookupAccount,
  parseUserId,
  type AccountLookup,
} from "@/lib/ops/credit-adjust";
import {
  REFERRAL_CREDITS,
  REFERRAL_MAX_FRIEND_GRANTS_PER_DAY,
  REFERRAL_MAX_PER_DAY,
  REFERRAL_MAX_REWARDS,
} from "@/lib/price-list";
import { referralsEnabled } from "@/lib/referral/config";
import { ACTIVITY_WINDOW_DAYS, formatBuildDelay, referralMetrics } from "@/lib/referral/metrics";
import { sharePath } from "@/lib/share/config";
import {
  REPORTED_SHARES_SHOWN,
  REPORTS_SHOWN_PER_SHARE,
  reportedShares,
  shareStats,
  type ReportedShare,
} from "@/lib/share/moderation";
import { cn } from "@/lib/utils";
import { openContractNotices, OPEN_NOTICES_SHOWN, type OpenNotice } from "@/lib/contract-notices/store";
import { setFeedbackStatusAction } from "./actions";
import { markContractNoticeDoneAction } from "./contract-notice-actions";
import { CreditAdjustForm } from "./CreditAdjustForm";
import { clearErrorEventAction } from "./error-actions";
import { disableSharedPageAction, dismissShareReportsAction } from "./share-actions";

/**
 * Operator console: the owner's view of accounts, revenue, AI usage, content,
 * student feedback and configuration. Only the user ids in
 * STUDYOS_ADMIN_USER_IDS get in (lib/ops/admin.ts); everyone else gets the
 * plain 404 page, so the console never reveals that it exists. English only.
 */
export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const { userId } = await auth();
  // Nothing that names the console for anyone else.
  if (!isAdmin(userId)) return { robots: { index: false, follow: false } };
  return { title: "Operator console · StudyOS", robots: { index: false, follow: false } };
}

const WINDOW_LABELS: Record<WindowKey, string> = { day: "24 hours", week: "7 days", month: "30 days" };
const WINDOW_ORDER: WindowKey[] = ["day", "week", "month"];

const FEATURE_LABELS: Record<string, string> = {
  ai: "AI models",
  billing: "Billing (Stripe)",
  assets: "Asset storage",
  sandbox: "Render sandbox",
  clerkWebhook: "Clerk webhook",
  feedLinks: "Calendar feed links",
  maintenance: "Maintenance job",
  webFetch: "Agent web reading",
  notifications: "Push notifications",
};

const KIND_STYLES: Record<string, string> = {
  bug: "bg-heather",
  idea: "bg-matcha",
  question: "bg-cloud",
  other: "bg-oat",
};

const FILTERS: { key: InboxFilter; label: string }[] = [
  { key: "new", label: "New" },
  { key: "read", label: "Read" },
  { key: "done", label: "Done" },
  { key: "all", label: "All" },
];

const FUNNEL_LABELS: Record<FunnelKey, string> = {
  signedUp: "Signed up",
  built: "Built a workspace",
  studied: "Studied",
  returned: "Came back on a later day",
  pro: "Pro, now or before",
};

const num = (value: number) => value.toLocaleString("en-US");
/** How long a deleted account had existed (lib/account/deletion-answer.ts TENURES). */
const TENURE_LABELS: Record<Tenure, string> = {
  week: "under a week",
  month: "under a month",
  quarter: "under 3 months",
  year: "under a year",
  older: "a year or more",
};
const LEAVING_DAYS = 90;
const money = (cents: number) =>
  (cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const percent = (rate: number | null) => (rate === null ? "–" : `${(rate * 100).toFixed(1)}%`);
const when = (date: Date) =>
  `${new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(date)} UTC`;
const weekOf = (date: Date) =>
  new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(date);

export default async function OperatorConsolePage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string | string[]; lookup?: string | string[] }>;
}) {
  await requireAdmin();
  const params = await searchParams;
  const filter = parseInboxFilter(params.status);
  // Support tools: the student looked up (?lookup=<Clerk user id or email>).
  const lookupAsked = params.lookup !== undefined && params.lookup !== "";
  const lookupEmail = parseLookupEmail(params.lookup);
  const byEmail = lookupEmail ? await findUserIdsByEmail(lookupEmail) : null;
  const lookupId =
    parseUserId(params.lookup) ??
    (byEmail?.status === "found" && byEmail.userIds.length === 1 ? byEmail.userIds[0] : null);
  const lookup = lookupId ? await lookupAccount(lookupId) : null;
  const [{ generatedAt, accounts, revenue, ai, content, inbox }, reported, sharing, errors, activation, leaving] =
    await Promise.all([
      loadOperatorSnapshot(filter),
      reportedShares(),
      shareStats(),
      errorOverview(),
      // Null when it cannot load (reported); its section says so.
      activationMetrics(),
      // Why deleted accounts left (anonymous, lib/account/deletion-reason.ts); null when it cannot load.
      deletionReasonCounts(LEAVING_DAYS).catch((error) => {
        reportError(error, { source: "admin", route: "/app/admin" });
        return null;
      }),
    ]);
  // The invite program (lib/referral/metrics.ts); its section says so when it cannot load.
  const referrals = await referralMetrics().catch(() => null);
  // Withdrawals and cancellations to process (lib/contract-notices); null when they cannot load.
  const notices = await openContractNotices().catch((error) => {
    reportError(error, { source: "admin", route: "/app/admin" });
    return null;
  });
  const config = publicConfigStatus();
  const version = process.env.DEPLOYMENT_VERSION?.trim() || process.env.NEXT_DEPLOYMENT_ID || null;

  const actions = [...new Set(WINDOW_ORDER.flatMap((key) => ai.creditsSpent[key].byAction.map((a) => a.action)))];
  const spentBy = (key: WindowKey, action: string) =>
    ai.creditsSpent[key].byAction.find((a) => a.action === action)?.credits ?? 0;

  return (
    <div className="min-h-screen bg-paper text-ink antialiased">
      <header className="border-b border-ink/10">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-4 sm:px-6">
          <Link href="/" className="flex items-center gap-1.5 font-display text-lg font-extrabold tracking-tight">
            <BrandMark />
            StudyOS
          </Link>
          <Link href="/app" className="text-sm text-ink-soft transition hover:text-ink">
            ← Workspaces
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-10 sm:px-6 sm:py-12">
        <h1 className="font-display text-3xl font-bold tracking-tight">Operator console</h1>
        <p className="mt-1 text-sm text-ink-soft">
          Live numbers from the database, as of {when(generatedAt)}. Reload for fresh ones.
        </p>
        {notices && notices.count > 0 && (
          <p className="mt-3">
            <a
              href="#contract-notices"
              data-testid="open-notices-count"
              className="inline-flex min-h-9 items-center rounded-full bg-heather px-4 text-sm font-semibold text-ink"
            >
              {num(notices.count)} open withdrawal or cancellation notice{notices.count === 1 ? "" : "s"} to process
            </a>
          </p>
        )}

        {/* Accounts */}
        <Section title="Accounts" note="A student counts as active after editing a workspace, studying, running a focus block, using AI or using any app feature in the window.">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <Stat tint="bg-matcha" label="Total accounts" value={num(accounts.total)} />
            {WINDOW_ORDER.map((key) => (
              <Stat key={key} tint="bg-matcha" label={`New, ${WINDOW_LABELS[key]}`} value={num(accounts.new[key])} />
            ))}
            <Stat tint="bg-matcha" label="Active, 7 days" value={num(accounts.active.week)} />
            <Stat tint="bg-matcha" label="Active, 30 days" value={num(accounts.active.month)} />
          </div>
        </Section>

        {/* Activation and retention */}
        <Section
          id="activation"
          title="Activation and retention"
          note="Do new students stick? A signup is a new account. The operators' own accounts, the 'local' owner and operator credit adjustments are left out. Weeks run Monday to Sunday, UTC."
        >
          {activation === null ? (
            <p className="rounded-2xl bg-oat px-4 py-6 text-center text-sm text-ink-soft">
              The activation numbers could not be loaded. The server log has the error.
            </p>
          ) : (
            <ActivationView activation={activation} />
          )}
        </Section>

        {/* Why students leave */}
        <Section
          id="leaving"
          title="Why students leave"
          note={`The optional question when a student deletes their account, last ${LEAVING_DAYS} days. Answers are stored after the account is erased, without any link to it.`}
        >
          {leaving === null ? (
            <p className="rounded-2xl bg-oat px-4 py-6 text-center text-sm text-ink-soft">
              The answers could not be loaded. The server log has the error.
            </p>
          ) : (
            <LeavingView leaving={leaving} />
          )}
        </Section>

        {/* Revenue */}
        <Section title="Revenue" note="Billing amounts are as charged (in the currency of each charge). Credit packs are counted from their credit grants.">
          <div className="grid gap-4 lg:grid-cols-2">
            <Card title="Subscriptions by status">
              {revenue.subscriptions.length === 0 ? (
                <Empty>No subscriptions yet.</Empty>
              ) : (
                <ul className="flex flex-wrap gap-2">
                  {revenue.subscriptions.map((row) => (
                    <li
                      key={row.status}
                      className={cn(
                        "rounded-full px-3 py-1 text-sm",
                        row.status === "active" ? "bg-matcha font-semibold" : "bg-oat",
                      )}
                    >
                      {row.status === "active" ? "active (Pro)" : row.status}: {num(row.count)}
                    </li>
                  ))}
                </ul>
              )}
              <div className="mt-4 grid grid-cols-2 gap-3">
                <Stat tint="bg-oat" label="Packs sold, 30 days" value={num(revenue.packsSold.month)} />
                <Stat tint="bg-oat" label="Packs sold, all time" value={num(revenue.packsSold.total)} />
              </div>
            </Card>
            <Card title="Billing events, last 30 days">
              {revenue.billingEvents.length === 0 ? (
                <Empty>No billing events in the last 30 days.</Empty>
              ) : (
                <Table head={["Kind", "Count", "Amount"]}>
                  {revenue.billingEvents.map((row) => (
                    <tr key={row.kind} className="border-t border-line">
                      <td className="py-2 pe-3 font-mono text-xs">{row.kind}</td>
                      <td className="py-2 pe-3 tabular-nums">{num(row.count)}</td>
                      <td className="py-2 tabular-nums">{money(row.amountCents)}</td>
                    </tr>
                  ))}
                </Table>
              )}
            </Card>
          </div>
        </Section>

        {/* AI usage */}
        <Section title="AI usage" note="Credits are the net charge for AI work: credits reserved for a run and given back are subtracted.">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {WINDOW_ORDER.map((key) => (
              <Stat
                key={key}
                tint="bg-cloud"
                label={`Credits spent, ${WINDOW_LABELS[key]}`}
                value={num(ai.creditsSpent[key].total)}
              />
            ))}
          </div>
          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <Card title="Credits by action">
              {actions.length === 0 ? (
                <Empty>No AI spending in the last 30 days.</Empty>
              ) : (
                <Table head={["Action", ...WINDOW_ORDER.map((key) => WINDOW_LABELS[key])]}>
                  {actions.map((action) => (
                    <tr key={action} className="border-t border-line">
                      <td className="py-2 pe-3 font-mono text-xs">{action}</td>
                      {WINDOW_ORDER.map((key) => (
                        <td key={key} className="py-2 pe-3 tabular-nums">
                          {num(spentBy(key, action))}
                        </td>
                      ))}
                    </tr>
                  ))}
                </Table>
              )}
            </Card>
            <Card title="Completed AI work">
              <Table head={["", ...WINDOW_ORDER.map((key) => WINDOW_LABELS[key])]}>
                <WindowRow label="Workspaces built" values={ai.workspacesBuilt} />
                <WindowRow label="Study kits made" values={ai.studyKits} />
              </Table>
            </Card>
          </div>
          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <Card title="Agent runs, last 30 days">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                <Stat tint="bg-cloud" label="Runs" value={num(ai.agentRuns.total)} />
                <Stat tint="bg-cloud" label="Completed" value={num(ai.agentRuns.completed)} />
                <Stat tint="bg-cloud" label="Failed" value={num(ai.agentRuns.failed)} />
                <Stat tint="bg-cloud" label="Still running" value={num(ai.agentRuns.running)} />
                <Stat tint="bg-cloud" label="Failure rate" value={percent(ai.agentRuns.failureRate)} />
              </div>
              <p className="mt-3 text-xs text-ink-faint">Failure rate = failed ÷ (completed + failed).</p>
            </Card>
            <Card title="Recent failed runs">
              {ai.recentFailures.length === 0 ? (
                <Empty>No failed runs in the last 30 days.</Empty>
              ) : (
                <ul className="flex flex-col divide-y divide-line">
                  {ai.recentFailures.map((run) => (
                    <li key={run.id} className="py-2.5 first:pt-0 last:pb-0">
                      <p className="flex flex-wrap items-center gap-x-2 text-xs text-ink-soft">
                        <span className="font-mono">{run.agentKey}</span>
                        <span aria-hidden>·</span>
                        <span>{run.trigger}</span>
                        <span aria-hidden>·</span>
                        <span>{when(run.startedAt)}</span>
                      </p>
                      <p className="mt-1 break-words font-mono text-xs text-ink">{run.error}</p>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
        </Section>

        {/* Content */}
        <Section title="Content">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Stat tint="bg-heather" label="Workspaces stored" value={num(content.total)} />
            <Stat tint="bg-heather" label="Created, 7 days" value={num(content.createdWeek)} />
            <Stat tint="bg-heather" label="In the trash" value={num(content.inTrash)} />
          </div>
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Stat tint="bg-oat" label="Shared links, active" value={num(sharing.active)} />
            <Stat tint="bg-oat" label="Views of active links" value={num(sharing.views)} />
          </div>
        </Section>

        {/* Referrals */}
        <Section
          id="referrals"
          title="Referrals"
          note={`Invite links and the friends who joined through them, last 30 days unless noted. A referral is rewarded after the friend's first charged workspace build, with a verified email: ${num(REFERRAL_CREDITS)} credits each. A mailbox earns the friend bonus once, ever (+tags, case and Gmail dots ignored). The inviter's half stops at ${num(REFERRAL_MAX_REWARDS)} friends in total and ${num(REFERRAL_MAX_PER_DAY)} in any 24 hours, per account and per mailbox. Past ${num(REFERRAL_MAX_FRIEND_GRANTS_PER_DAY)} friend bonuses in 24 hours across everyone, rewards wait and an error is reported. STUDYOS_REFERRALS=off pauses the program${referralsEnabled() ? "" : " (paused now)"}. Invite credits never count as credits spent.`}
        >
          {!referrals ? (
            <Empty>Referral numbers could not be loaded.</Empty>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Stat tint="bg-matcha" label="Invite codes, all time" value={num(referrals.codes.total)} />
                <Stat tint="bg-matcha" label="Invite codes, 30 days" value={num(referrals.codes.month)} />
                <Stat tint="bg-cloud" label="Pending" value={num(referrals.month.pending)} />
                <Stat tint="bg-cloud" label="Rewarded" value={num(referrals.month.rewarded)} />
                <Stat tint="bg-cloud" label="Rejected" value={num(referrals.month.rejected)} />
                <Stat tint="bg-oat" label="Credits granted, 30 days" value={num(referrals.credits.month)} />
                <Stat tint="bg-oat" label="Credits granted, all time" value={num(referrals.credits.total)} />
              </div>
              <div className="mt-4">
                <Card title="Rejected, and the inviter's half">
                  {referrals.rejectedBy.length === 0 && referrals.inviterOutcomes.length === 0 ? (
                    <Empty>Nothing in the last 30 days.</Empty>
                  ) : (
                    <ul className="flex flex-wrap gap-2">
                      {referrals.rejectedBy.map((row) => (
                        <li key={`r-${row.reason}`} className="rounded-full bg-heather px-3 py-1 text-sm">
                          rejected, {row.reason}: {num(row.count)}
                        </li>
                      ))}
                      {referrals.inviterOutcomes.map((row) => (
                        <li
                          key={`o-${row.outcome}`}
                          className={cn("rounded-full px-3 py-1 text-sm", row.outcome === "granted" ? "bg-matcha" : "bg-oat")}
                        >
                          inviter {row.outcome}: {num(row.count)}
                        </li>
                      ))}
                    </ul>
                  )}
                </Card>
              </div>
              <div className="mt-4">
                <Card title="Top inviters, all time, by inviter bonuses">
                  {referrals.topReferrers.length === 0 ? (
                    <Empty>No inviter bonuses granted yet.</Empty>
                  ) : (
                    <>
                      <Table
                        head={[
                          "Clerk user id",
                          "Inviter bonuses",
                          "Friends rewarded",
                          "Friends since deleted",
                          `Inactive ${ACTIVITY_WINDOW_DAYS} days after reward`,
                          "Median link to first build",
                        ]}
                      >
                        {referrals.topReferrers.map((row) => (
                          <tr key={row.userId} className="border-t border-line">
                            <td className="py-2 pe-3">
                              <Link
                                href={`/app/admin?lookup=${encodeURIComponent(row.userId)}#support`}
                                className="break-all font-mono text-xs underline"
                              >
                                {row.userId}
                              </Link>
                            </td>
                            <td className="py-2 pe-3 tabular-nums">{num(row.granted)}</td>
                            <td className="py-2 pe-3 tabular-nums">{num(row.rewarded)}</td>
                            <td className={cn("py-2 pe-3 tabular-nums", row.deleted > 0 && "font-semibold")}>
                              {num(row.deleted)}
                            </td>
                            <td className={cn("py-2 pe-3 tabular-nums", row.inactive > 0 && "font-semibold")}>
                              {num(row.inactive)}
                            </td>
                            <td className="py-2 tabular-nums">{formatBuildDelay(row.medianToBuildSeconds)}</td>
                          </tr>
                        ))}
                      </Table>
                      <p className="mt-3 text-xs text-ink-soft">
                        Ranked by the bonuses in the inviter&apos;s own ledger, which a friend deleting their account
                        never removes (that friend&apos;s referral is kept, anonymised). Inactive: a rewarded friend
                        with no flashcard or quiz day and no focus session in the {ACTIVITY_WINDOW_DAYS} days after
                        their reward, and no workspace edited since it (rewards under a week old are judged on the
                        days so far). Many deleted or inactive friends, or first builds minutes after the link was
                        opened, point to farming.
                      </p>
                    </>
                  )}
                </Card>
              </div>
            </>
          )}
        </Section>

        {/* Withdrawals and cancellations (the statutory online functions) */}
        <Section
          id="contract-notices"
          title="Contract notices"
          note={`Withdrawals (/withdraw) and cancellations (/cancel) still to process, oldest first (up to ${OPEN_NOTICES_SHOWN}). A withdrawal is never processed automatically: work out the refund under section 4 of the Terms. An ordinary cancellation of Pro by a signed-in subscriber is scheduled in Stripe at once and arrives here already done; everything else waits for you. Confirm the outcome to the sender by email, then mark it done.`}
        >
          {notices === null ? (
            <p className="rounded-2xl bg-oat px-4 py-6 text-center text-sm text-ink-soft">
              The notices could not be loaded (is the contract_notices migration applied?). Each one was also emailed
              to the operator address.
            </p>
          ) : notices.items.length === 0 ? (
            <p className="rounded-2xl bg-oat px-4 py-6 text-center text-sm text-ink-soft">No open notices.</p>
          ) : (
            <ul className="flex flex-col gap-3">
              {notices.items.map((notice) => (
                <ContractNoticeItem key={notice.id} notice={notice} />
              ))}
            </ul>
          )}
        </Section>

        {/* Feedback inbox */}
        <Section
          id="feedback"
          title="Feedback inbox"
          note={`Newest first, up to ${INBOX_PAGE_SIZE} messages. An email address is shown only when the student agreed to be contacted.`}
        >
          <nav aria-label="Filter feedback" className="flex flex-wrap gap-2">
            {FILTERS.map((option) => (
              <Link
                key={option.key}
                href={`/app/admin?status=${option.key}#feedback`}
                aria-current={inbox.filter === option.key ? "page" : undefined}
                className={cn(
                  "rounded-full border px-4 py-1.5 text-sm font-semibold transition",
                  inbox.filter === option.key
                    ? "border-ink bg-ink text-paper"
                    : "border-line-strong text-ink-soft hover:bg-hover hover:text-ink",
                )}
              >
                {option.label} · {num(inbox.counts[option.key])}
              </Link>
            ))}
          </nav>
          {inbox.items.length === 0 ? (
            <p className="mt-4 rounded-2xl bg-oat px-4 py-6 text-center text-sm text-ink-soft">Nothing here.</p>
          ) : (
            <ul className="mt-4 flex flex-col gap-3">
              {inbox.items.map((item) => (
                <FeedbackItem key={item.id} item={item} />
              ))}
            </ul>
          )}
        </Section>

        {/* Reported shared pages */}
        <Section
          id="reported-shares"
          title="Reported shares"
          note={`Shared pages with open reports, most recently reported first (up to ${REPORTED_SHARES_SHOWN}, with the newest ${REPORTS_SHOWN_PER_SHARE} messages each). "Disable link" turns the link off for good, keeps the student from sharing that page again and closes its reports; "Dismiss reports" closes them and leaves the link as it is.`}
        >
          {reported.length === 0 ? (
            <p className="rounded-2xl bg-oat px-4 py-6 text-center text-sm text-ink-soft">No open reports.</p>
          ) : (
            <ul className="flex flex-col gap-3">
              {reported.map((share) => (
                <ReportedShareItem key={share.shareId} share={share} />
              ))}
            </ul>
          )}
        </Section>

        {/* Support tools */}
        <Section
          id="support"
          title="Support tools"
          note={`Grant or deduct a student's credits: for a withdrawal (the unused Pro credits of that period) or as goodwill. At most ${num(ADMIN_ADJUST_MAX)} either way; a deduction never takes the balance below zero. Each one is recorded in the ledger as ${ADMIN_ADJUST_REASON} with your note, applies once even when the form is sent twice, and never counts as AI spending.`}
        >
          <div className="grid gap-4 lg:grid-cols-2">
            <Card title="Adjust credits">
              <CreditAdjustForm nonce={randomUUID()} maxAmount={ADMIN_ADJUST_MAX} maxNote={ADMIN_NOTE_MAX_CHARS} />
            </Card>
            <Card title="Look up a student">
              <form method="get" action="/app/admin#support" className="flex flex-wrap gap-2">
                <label className="min-w-0 flex-1 text-xs font-semibold text-ink-soft">
                  Clerk user id or email address
                  <input
                    name="lookup"
                    required
                    autoComplete="off"
                    spellCheck={false}
                    placeholder="user_… or name@example.com"
                    defaultValue={lookupEmail ?? lookupId ?? ""}
                    className="mt-1 block min-h-10 w-full rounded-xl border border-line-strong bg-card px-3 font-mono text-sm text-ink placeholder:text-ink-faint"
                  />
                </label>
                <button
                  type="submit"
                  className="min-h-10 self-end rounded-full border border-line-strong px-5 text-sm font-semibold text-ink transition hover:bg-hover"
                >
                  Look up
                </button>
              </form>
              {lookup ? (
                <AccountLookupView lookup={lookup} />
              ) : byEmail?.status === "found" ? (
                <div className="mt-3 text-sm text-ink-soft">
                  <p>Several accounts use this address:</p>
                  <ul className="mt-1 space-y-1">
                    {byEmail.userIds.map((id) => (
                      <li key={id}>
                        <Link
                          href={`/app/admin?lookup=${encodeURIComponent(id)}#support`}
                          className="break-all font-mono text-xs text-lime-deep underline underline-offset-4"
                        >
                          {id}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : byEmail?.status === "none" ? (
                <p className="mt-3 text-sm text-ink-soft">No account has this email address.</p>
              ) : byEmail?.status === "unavailable" ? (
                <p className="mt-3 text-sm text-rose-600">Could not reach Clerk to look up the address. Try again, or use the user id.</p>
              ) : (
                lookupAsked && <p className="mt-3 text-sm text-rose-600">That is neither a Clerk user id nor an email address.</p>
              )}
            </Card>
          </div>
        </Section>

        {/* Errors */}
        <Section
          id="errors"
          title="Errors"
          note={`Server errors, and the ones the app's error pages send from browsers, grouped by kind: same source, route and message, numbers and ids aside. They are counted in memory and written here every 30 seconds, so the newest can take that long to show (and the last few seconds before a restart are lost); the server log keeps every error in full. A kind not seen for 30 days is removed; "Clear" removes one now, for a fixed issue, and it comes back if the error does.`}
        >
          {errors === null ? (
            <p className="rounded-2xl bg-oat px-4 py-6 text-center text-sm text-ink-soft">
              The error counts could not be loaded (is the error_events migration applied?). The server log has
              every error.
            </p>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Stat tint="bg-heather" label="Errors seen, 24 hours" value={num(errors.seen.day)} />
                <Stat tint="bg-heather" label="Errors seen, 7 days" value={num(errors.seen.week)} />
                <Stat tint="bg-heather" label="Kinds, 24 hours" value={num(errors.kinds.day)} />
                <Stat tint="bg-heather" label="Kinds, 7 days" value={num(errors.kinds.week)} />
              </div>
              <p className="mt-3 text-xs text-ink-faint">
                Errors seen adds up the whole count of every kind last seen in the window, its earlier occurrences
                included, so it is a rough gauge rather than an exact count.
              </p>
              <div className="mt-4">
                <Card title={`Most frequent kinds seen in the last 7 days (top ${ERRORS_SHOWN})`}>
                  {errors.top.length === 0 ? (
                    <Empty>No errors in the last 7 days.</Empty>
                  ) : (
                    <Table head={["Source", "Route", "Message", "Count", "First seen", "Last seen", "Release", ""]}>
                      {errors.top.map((group) => (
                        <ErrorGroupRow key={group.fingerprint} group={group} />
                      ))}
                    </Table>
                  )}
                  <p className="mt-3 text-xs text-ink-faint">
                    Count = every occurrence since first seen. The message is the first occurrence&apos;s, scrubbed
                    like the log line.
                  </p>
                </Card>
              </div>
            </>
          )}
        </Section>

        {/* System */}
        <Section title="System" note="On/off only; values are never shown here. Details are in the startup log.">
          <div className="grid gap-4 lg:grid-cols-2">
            <Card title="Features">
              <ul className="flex flex-wrap gap-2">
                {Object.entries(config.features).map(([key, on]) => (
                  <li
                    key={key}
                    className={cn("rounded-full px-3 py-1 text-sm", on ? "bg-matcha font-semibold" : "bg-oat text-ink-soft")}
                  >
                    {FEATURE_LABELS[key] ?? key}: {on ? "on" : "off"}
                  </li>
                ))}
              </ul>
            </Card>
            <Card title="Health">
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
                <dt className="text-ink-soft">Required settings</dt>
                <dd className="font-semibold">
                  {config.ok ? "All set" : `${config.missingRequired.length} missing`}
                </dd>
                <dt className="text-ink-soft">Startup warnings</dt>
                <dd className="font-semibold">{num(config.warnings.length)}</dd>
                <dt className="text-ink-soft">App version</dt>
                <dd className="break-all font-mono text-xs leading-5">{version ?? "not set"}</dd>
              </dl>
            </Card>
          </div>
        </Section>
      </main>
    </div>
  );
}

function Section({
  id,
  title,
  note,
  children,
}: {
  id?: string;
  title: string;
  note?: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="mt-8 scroll-mt-6 rounded-3xl border border-line bg-card/60 p-5 sm:p-6">
      <h2 className="font-display text-xl font-bold">{title}</h2>
      {note && <p className="mt-1 text-sm text-ink-soft">{note}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0 rounded-2xl border border-line bg-card p-4">
      <h3 className="mb-3 font-display text-base font-bold">{title}</h3>
      {children}
    </div>
  );
}

function Stat({ label, value, tint }: { label: string; value: string; tint: string }) {
  return (
    <div className={cn("min-w-0 rounded-2xl px-4 py-3", tint)}>
      <p className="text-xs text-ink-soft">{label}</p>
      <p className="mt-1 font-display text-2xl font-bold tabular-nums text-ink">{value}</p>
    </div>
  );
}

/** Support tools: one student's balance, plan and latest ledger rows. */
function AccountLookupView({ lookup }: { lookup: AccountLookup }) {
  if (!lookup.exists && !lookup.deleted) {
    return (
      <p className="mt-3 text-sm text-ink-soft" data-testid="lookup-result">
        No StudyOS account with the id <span className="break-all font-mono">{lookup.userId}</span>.
      </p>
    );
  }
  const sub = lookup.subscription;
  const subscription = sub
    ? [
        sub.status,
        sub.allowanceYearly ? "yearly" : null,
        sub.currentPeriodEnd ? `paid to ${when(sub.currentPeriodEnd)}` : null,
        sub.disputeId ? `dispute ${sub.disputeId}` : null,
      ]
        .filter(Boolean)
        .join(" · ")
    : "none";
  return (
    <div className="mt-4" data-testid="lookup-result">
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
        <dt className="text-ink-soft">User</dt>
        <dd className="break-all font-mono text-xs leading-5">{lookup.userId}</dd>
        <dt className="text-ink-soft">Balance</dt>
        <dd className="font-semibold tabular-nums">{lookup.balance === null ? "–" : num(lookup.balance)}</dd>
        <dt className="text-ink-soft">Plan</dt>
        <dd className="font-semibold">{lookup.pro ? "Pro" : "Free"}</dd>
        <dt className="text-ink-soft">Subscription</dt>
        <dd>{subscription}</dd>
        {sub?.stripeCustomerId && (
          <>
            <dt className="text-ink-soft">Stripe customer</dt>
            <dd className="break-all font-mono text-xs leading-5">{sub.stripeCustomerId}</dd>
          </>
        )}
        {lookup.deleted && (
          <>
            <dt className="text-ink-soft">Account</dt>
            <dd className="font-semibold text-rose-600">deleted</dd>
          </>
        )}
      </dl>
      <div className="mt-4">
        {lookup.ledger.length === 0 ? (
          <Empty>No ledger rows.</Empty>
        ) : (
          <Table head={["When", "Credits", "Reason"]}>
            {lookup.ledger.map((row, i) => (
              <tr key={`${row.key ?? "row"}:${i}`} className="border-t border-line align-top">
                <td className="py-2 pe-3 text-xs text-ink-soft">{when(row.createdAt)}</td>
                <td className="py-2 pe-3 tabular-nums">{row.delta > 0 ? `+${num(row.delta)}` : num(row.delta)}</td>
                <td className="py-2">
                  <span className="font-mono text-xs">{row.reason}</span>
                  {row.note && <p className="mt-0.5 break-words text-xs text-ink-soft">{row.note}</p>}
                </td>
              </tr>
            ))}
          </Table>
        )}
      </div>
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-ink-soft">{children}</p>;
}

function Table({ head, children }: { head: string[]; children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-start text-sm">
        <thead>
          <tr className="text-xs text-ink-soft">
            {head.map((cell, i) => (
              <th key={i} scope="col" className="pb-2 pe-3 text-start font-semibold">
                {cell}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

function WindowRow({ label, values }: { label: string; values: PerWindow }) {
  return (
    <tr className="border-t border-line">
      <th scope="row" className="py-2 pe-3 text-start font-normal">
        {label}
      </th>
      {WINDOW_ORDER.map((key) => (
        <td key={key} className="py-2 pe-3 tabular-nums">
          {num(values[key])}
        </td>
      ))}
    </tr>
  );
}

/** Activation and retention: weekly signup cohorts and the 30-day funnel (lib/ops/activation-metrics.ts). */
function ActivationView({ activation }: { activation: ActivationMetrics }) {
  const signups = activation.funnel[0]?.count ?? 0;
  return (
    <div className="grid gap-4">
      <Card title={`Signup cohorts, last ${COHORT_WEEKS} weeks`}>
        <Table
          head={[
            "Signup week",
            "Signups",
            "Built a workspace",
            "Studied",
            "Active in week 1",
            "Active in week 2",
            "Pro, now or before",
          ]}
        >
          {activation.cohorts.map((row) => (
            <tr key={row.weekStart.toISOString()} className="border-t border-line" data-testid="cohort-row">
              <th scope="row" className="whitespace-nowrap py-2 pe-3 text-start font-normal">
                {weekOf(row.weekStart)}
                {row.current && (
                  <>
                    {" "}
                    <span className="ms-1 rounded-full bg-lime px-2 py-0.5 text-xs font-semibold text-lime-on">so far</span>
                  </>
                )}
              </th>
              <td className="py-2 pe-3 font-semibold tabular-nums">{num(row.signups)}</td>
              <CohortCell value={row.built} />
              <CohortCell value={row.studied} />
              <CohortCell value={row.week1} />
              <CohortCell value={row.week2} />
              <CohortCell value={row.pro} />
            </tr>
          ))}
        </Table>
        <p className="mt-3 text-xs text-ink-soft">
          Each row is the students whose account was made that week. Signups: how many. Built a workspace: made at
          least one. Studied: reviewed flashcards, answered quiz questions or ran a focus timer at least once. Active
          in week 1 and week 2: did anything in the app (edited a workspace, studied, used AI or any other feature) 7
          to 13, or 14 to 20, days after their own signup; the cell stays blank until that window is over for
          everyone in the row. Pro, now or before: on Pro today, or paid for at least one Pro month. In brackets: the
          number of students behind the percent. Older weeks can read a little low, since only a workspace&apos;s
          latest edit is kept.
        </p>
      </Card>
      <Card title={`Activation funnel, signups of the last ${FUNNEL_DAYS} days`}>
        {signups === 0 ? (
          <Empty>No signups in the last {FUNNEL_DAYS} days.</Empty>
        ) : (
          <ol className="flex flex-col gap-3">
            {activation.funnel.map((step, i) => (
              <li key={step.key} data-testid="funnel-step">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                  <span className="text-sm">{FUNNEL_LABELS[step.key]}</span>
                  <span className="flex items-baseline gap-2">
                    <span className="font-display text-lg font-bold tabular-nums">{num(step.count)}</span>
                    {i > 0 && (
                      <span className="rounded-full bg-matcha px-2.5 py-0.5 text-xs font-semibold tabular-nums">
                        {rateText(step.fromPrevious)} of the step before
                      </span>
                    )}
                  </span>
                </div>
                <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-oat" aria-hidden>
                  <div
                    className="h-full rounded-full bg-lime"
                    style={{ width: `${Math.round((step.ofSignups ?? 0) * 100)}%` }}
                  />
                </div>
              </li>
            ))}
          </ol>
        )}
        <p className="mt-3 text-xs text-ink-soft">
          Students whose account was made in the last {FUNNEL_DAYS} days. Each step counts only the students who also
          reached every step before it: the pill is the share of the step before, the bar the share of all signups.
          Came back on a later day: did anything in the app at least 24 hours after signing up.
        </p>
      </Card>
    </div>
  );
}

/** The answers from the delete-account confirmation: counts per reason and the latest notes. */
function LeavingView({ leaving }: { leaving: DeletionReasonSummary }) {
  if (leaving.total === 0) return <Empty>No answers in the last {LEAVING_DAYS} days.</Empty>;
  const most = Math.max(...leaving.byReason.map((r) => r.count), 1);
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Card title={`Reasons, ${num(leaving.total)} ${leaving.total === 1 ? "answer" : "answers"}`}>
        <ul className="flex flex-col gap-2.5">
          {leaving.byReason.map((row) => (
            <li key={row.reason} data-testid="leaving-reason">
              <div className="flex items-baseline justify-between gap-3 text-sm">
                <span className="min-w-0">{en.settings.deleteReasons[row.reason]}</span>
                <span className="tabular-nums">{num(row.count)}</span>
              </div>
              <div className="mt-1 h-2 overflow-hidden rounded-full bg-oat" aria-hidden>
                <div className="h-full rounded-full bg-lime" style={{ width: `${Math.round((row.count / most) * 100)}%` }} />
              </div>
            </li>
          ))}
        </ul>
      </Card>
      <Card title="Latest notes">
        {leaving.notes.length === 0 ? (
          <Empty>Nobody wrote a note.</Empty>
        ) : (
          <ul className="flex flex-col gap-3">
            {leaving.notes.map((item, i) => (
              <li key={i} className="rounded-2xl bg-oat px-4 py-3">
                <p className="whitespace-pre-wrap break-words text-sm text-ink">{item.note}</p>
                <p className="mt-1 text-xs text-ink-soft">
                  {en.settings.deleteReasons[item.reason]} · {item.plan === "pro" ? "Pro" : "Free"} · had the account{" "}
                  {TENURE_LABELS[item.tenure as Tenure] ?? item.tenure} · {weekOf(item.createdAt)}
                </p>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

/** A cohort percent with its head count; blank (not 0%) while the window is still open. */
function CohortCell({ value }: { value: Share | null }) {
  if (value === null) {
    return (
      <td className="py-2 pe-3">
        <span className="sr-only">not yet</span>
      </td>
    );
  }
  return (
    <td className="whitespace-nowrap py-2 pe-3 tabular-nums">
      {shareText(value)}
      {value.rate !== null && <span className="text-xs text-ink-faint"> ({num(value.count)})</span>}
    </td>
  );
}

function ErrorGroupRow({ group }: { group: ErrorGroup }) {
  return (
    <tr className="border-t border-line align-top">
      <td className="py-2 pe-3">
        <span className="whitespace-nowrap rounded-full bg-heather px-2.5 py-0.5 font-mono text-xs text-ink">
          {group.source}
        </span>
      </td>
      <td className="py-2 pe-3 break-all font-mono text-xs">{group.route ?? "–"}</td>
      <td className="min-w-64 py-2 pe-3">
        <p className="break-words font-mono text-xs text-ink">{group.message}</p>
        {group.sample && (
          <details className="mt-1">
            <summary className="cursor-pointer text-xs text-ink-soft transition hover:text-ink">Stack</summary>
            <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-all rounded-xl bg-oat p-2 font-mono text-[11px] leading-4 text-ink-soft">
              {group.sample}
            </pre>
          </details>
        )}
      </td>
      <td className="py-2 pe-3 font-semibold tabular-nums">{num(group.count)}</td>
      <td className="whitespace-nowrap py-2 pe-3 text-xs text-ink-soft">{when(group.firstSeen)}</td>
      <td className="whitespace-nowrap py-2 pe-3 text-xs text-ink-soft">{when(group.lastSeen)}</td>
      <td className="py-2 pe-3 break-all font-mono text-xs">{group.release ?? "–"}</td>
      <td className="py-2">
        <form action={clearErrorEventAction}>
          <input type="hidden" name="fingerprint" value={group.fingerprint} />
          <button
            type="submit"
            title="Removes this kind of error from the list; it comes back if the error happens again"
            className="min-h-9 rounded-full border border-line-strong px-4 text-xs font-semibold text-ink transition hover:bg-hover"
          >
            Clear
          </button>
        </form>
      </td>
    </tr>
  );
}

function FeedbackItem({ item }: { item: InboxItem }) {
  const moves: { status: "new" | "read" | "done"; label: string }[] = [];
  if (item.status === "new") moves.push({ status: "read", label: "Mark read" });
  if (item.status !== "done") moves.push({ status: "done", label: "Mark done" });
  else moves.push({ status: "new", label: "Move back to new" });

  return (
    <li className="rounded-2xl border border-line bg-card p-4">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className={cn("rounded-full px-2.5 py-0.5 font-semibold text-ink", KIND_STYLES[item.kind] ?? "bg-oat")}>
          {item.kind}
        </span>
        <span className="rounded-full border border-line-strong px-2.5 py-0.5 text-ink-soft">{item.status}</span>
        <span className="text-ink-soft">{when(item.createdAt)}</span>
        {item.locale && <span className="text-ink-soft">· {item.locale}</span>}
        {item.pagePath && <span className="break-all font-mono text-ink-soft">· {item.pagePath}</span>}
      </div>
      <p dir="auto" className="mt-3 whitespace-pre-wrap break-words text-sm text-ink">
        {item.message}
      </p>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <p className="min-w-0 text-xs text-ink-soft">
          {item.contactOk ? (
            item.email ? (
              <>
                May be emailed:{" "}
                <a href={`mailto:${item.email}`} className="font-semibold text-ink underline underline-offset-2">
                  {item.email}
                </a>
              </>
            ) : (
              <>
                May be emailed (address unavailable): <span className="break-all font-mono">{item.userId}</span>
              </>
            )
          ) : (
            <>
              No contact wanted · <span className="break-all font-mono">{item.userId}</span>
            </>
          )}
        </p>
        <div className="flex flex-wrap gap-2">
          {moves.map((move) => (
            <form key={move.status} action={setFeedbackStatusAction}>
              <input type="hidden" name="id" value={item.id} />
              <input type="hidden" name="status" value={move.status} />
              <button
                type="submit"
                className="min-h-9 rounded-full border border-line-strong px-4 text-xs font-semibold text-ink transition hover:bg-hover"
              >
                {move.label}
              </button>
            </form>
          ))}
        </div>
      </div>
    </li>
  );
}

const CONTRACT_LABELS: Record<string, string> = { pro: "Pro subscription", pack: "Credit pack", other: "Other" };
const ACK_LABELS: Record<string, string> = {
  sent: "acknowledgement sent",
  failed: "acknowledgement FAILED: email them",
  not_configured: "no acknowledgement (email off): email them",
  pending: "acknowledgement not recorded",
};
const STRIPE_LABELS: Record<string, string> = {
  scheduled: "Stripe updated: cancels at period end",
  already_scheduled: "Stripe: already cancelling at period end",
  no_live_subscription: "Stripe not changed: no active subscription",
  failed: "Stripe update FAILED: cancel by hand",
};

function ContractNoticeItem({ notice }: { notice: OpenNotice }) {
  const facts: [string, string | null][] = [
    ["Contract", `${CONTRACT_LABELS[notice.contractKind] ?? notice.contractKind}${notice.contractRef ? ` (${notice.contractRef})` : ""}`],
    [
      "Cancellation",
      notice.kind === "cancellation"
        ? `${notice.cancelType ?? "ordinary"}, ${notice.requestedEnd ? `ends ${notice.requestedEnd}` : "earliest possible date"}`
        : null,
    ],
    ["Reason", notice.reason],
    ["Details", notice.details],
    ["Account", notice.userId ?? "not signed in (or account deleted)"],
  ];
  return (
    <li className="rounded-2xl border border-line bg-card p-4" data-testid="contract-notice">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2 text-xs">
            <span
              className={cn(
                "rounded-full px-2.5 py-0.5 font-semibold text-ink",
                notice.kind === "withdrawal" ? "bg-heather" : "bg-cloud",
              )}
            >
              {notice.kind}
            </span>
            <span className="text-ink-soft">received {when(notice.receivedAt)}</span>
            <span className="text-ink-soft">· {notice.locale}</span>
          </p>
          <p dir="auto" className="mt-2 break-words font-display text-base font-bold text-ink">
            {notice.name}
          </p>
          <a href={`mailto:${notice.email}`} className="break-all text-sm font-semibold text-ink underline underline-offset-2">
            {notice.email}
          </a>
        </div>
        <form action={markContractNoticeDoneAction}>
          <input type="hidden" name="id" value={notice.id} />
          <button
            type="submit"
            className="min-h-9 rounded-full border border-line-strong px-4 text-xs font-semibold text-ink transition hover:bg-hover"
          >
            Mark done
          </button>
        </form>
      </div>
      <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        {facts
          .filter((fact): fact is [string, string] => Boolean(fact[1]))
          .map(([label, value]) => (
            <div key={label} className="contents">
              <dt className="text-ink-soft">{label}</dt>
              <dd dir="auto" className="min-w-0 whitespace-pre-wrap break-words text-ink">
                {value}
              </dd>
            </div>
          ))}
      </dl>
      <p className="mt-3 flex flex-wrap gap-2 text-xs">
        <span
          className={cn(
            "rounded-full px-2.5 py-0.5 font-semibold text-ink",
            notice.ackStatus === "sent" ? "bg-matcha" : "bg-oat",
          )}
        >
          {ACK_LABELS[notice.ackStatus] ?? notice.ackStatus}
        </span>
        {notice.kind === "cancellation" && (
          <span
            className={cn(
              "rounded-full px-2.5 py-0.5 font-semibold text-ink",
              notice.stripeOutcome === "scheduled" || notice.stripeOutcome === "already_scheduled" ? "bg-matcha" : "bg-oat",
            )}
          >
            {notice.stripeOutcome ? STRIPE_LABELS[notice.stripeOutcome] ?? notice.stripeOutcome : "Stripe not touched"}
            {notice.proEndsAt ? `, Pro ends ${when(notice.proEndsAt)}` : ""}
          </span>
        )}
        {!notice.operatorNotified && <span className="rounded-full bg-oat px-2.5 py-0.5 text-ink-soft">no operator email</span>}
      </p>
    </li>
  );
}

const REPORT_REASON_LABELS: Record<string, string> = {
  spam: "Spam",
  copyright: "Copyright",
  harmful: "Harmful or abusive",
  personal: "Personal information",
  other: "Other",
};

function ReportedShareItem({ share }: { share: ReportedShare }) {
  return (
    <li className="rounded-2xl border border-line bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p dir="auto" className="break-words font-display text-base font-bold text-ink">
            {share.pageTitle === null
              ? "(page no longer exists)"
              : `${share.pageIcon ? `${share.pageIcon} ` : ""}${share.pageTitle.trim() || "Untitled"}`}
          </p>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-ink-soft">
            <span
              className={cn(
                "rounded-full px-2.5 py-0.5 font-semibold text-ink",
                share.active ? "bg-matcha" : "bg-oat",
              )}
            >
              {share.disabledByOperator ? "turned off by an operator" : share.active ? "link on" : "link off"}
            </span>
            <span>{num(share.viewCount)} views</span>
            <span aria-hidden>·</span>
            <span>
              {num(share.openReports)} open report{share.openReports === 1 ? "" : "s"}
              {share.openReports > share.reports.length ? ` (newest ${share.reports.length} shown)` : ""}
            </span>
            {share.active && share.pageTitle !== null && (
              <>
                <span aria-hidden>·</span>
                <a
                  href={sharePath(share.token)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-semibold text-ink underline underline-offset-2"
                >
                  View page
                </a>
              </>
            )}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {!share.disabledByOperator && (
            <form action={disableSharedPageAction}>
              <input type="hidden" name="shareId" value={share.shareId} />
              <button
                type="submit"
                title="Turns the link off for good and keeps the student from sharing this page again"
                className="min-h-9 rounded-full border border-line-strong px-4 text-xs font-semibold text-ink transition hover:bg-hover"
              >
                {share.active ? "Disable link" : "Block page"}
              </button>
            </form>
          )}
          <form action={dismissShareReportsAction}>
            <input type="hidden" name="shareId" value={share.shareId} />
            <button
              type="submit"
              title="Closes these reports; the link stays as it is"
              className="min-h-9 rounded-full px-4 text-xs font-semibold text-ink-soft transition hover:bg-hover hover:text-ink"
            >
              Dismiss reports
            </button>
          </form>
        </div>
      </div>
      <ul className="mt-3 flex flex-col divide-y divide-line">
        {share.reports.map((report) => (
          <li key={report.id} className="py-2.5 first:pt-0 last:pb-0">
            <p className="flex flex-wrap items-center gap-x-2 text-xs text-ink-soft">
              <span className="rounded-full bg-heather px-2.5 py-0.5 font-semibold text-ink">
                {REPORT_REASON_LABELS[report.reason] ?? report.reason}
              </span>
              <span>{when(report.createdAt)}</span>
            </p>
            {report.message && (
              <p dir="auto" className="mt-1.5 whitespace-pre-wrap break-words text-sm text-ink">
                {report.message}
              </p>
            )}
          </li>
        ))}
      </ul>
    </li>
  );
}
