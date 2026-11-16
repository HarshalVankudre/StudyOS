import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ snapshot: vi.fn(), activation: vi.fn(), leaving: vi.fn(), notices: vi.fn() }));

vi.mock("@/lib/db", () => ({ prisma: {} }));
vi.mock("@clerk/nextjs/server", () => ({ auth: async () => ({ userId: "user_op" }) }));
vi.mock("@/lib/ops/admin", () => ({
  isAdmin: () => true,
  requireAdmin: async () => "user_op",
  adminUserIds: () => new Set(["user_op"]),
}));
vi.mock("@/lib/ops/report-error", () => ({ reportError: vi.fn() }));
vi.mock("@/lib/ops/admin-metrics", () => ({
  INBOX_PAGE_SIZE: 50,
  loadOperatorSnapshot: m.snapshot,
  parseInboxFilter: () => "new",
}));
// The real shaping and formatting; only the query is replaced.
vi.mock("@/lib/ops/activation-metrics", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ops/activation-metrics")>()),
  activationMetrics: m.activation,
}));
vi.mock("@/lib/account/deletion-reason", () => ({ deletionReasonCounts: m.leaving }));
vi.mock("@/lib/ops/env", () => ({
  publicConfigStatus: () => ({ ok: true, features: {}, missingRequired: [], warnings: [] }),
}));
vi.mock("@/lib/ops/user-search", () => ({ parseLookupEmail: () => null, findUserIdsByEmail: vi.fn() }));
vi.mock("@/lib/ops/error-overview", () => ({ ERRORS_SHOWN: 20, errorOverview: async () => null }));
vi.mock("@/lib/ops/credit-adjust", () => ({
  ADMIN_ADJUST_MAX: 100_000,
  ADMIN_ADJUST_REASON: "admin_adjust",
  ADMIN_NOTE_MAX_CHARS: 200,
  lookupAccount: vi.fn(),
  parseUserId: () => null,
}));
vi.mock("@/lib/referral/metrics", () => ({
  ACTIVITY_WINDOW_DAYS: 7,
  formatBuildDelay: () => "–",
  referralMetrics: async () => {
    throw new Error("not in this test");
  },
}));
vi.mock("@/lib/share/moderation", () => ({
  REPORTED_SHARES_SHOWN: 30,
  REPORTS_SHOWN_PER_SHARE: 5,
  reportedShares: async () => [],
  shareStats: async () => ({ active: 0, views: 0 }),
}));
vi.mock("./actions", () => ({ setFeedbackStatusAction: vi.fn() }));
vi.mock("./error-actions", () => ({ clearErrorEventAction: vi.fn() }));
vi.mock("./share-actions", () => ({ disableSharedPageAction: vi.fn(), dismissShareReportsAction: vi.fn() }));
vi.mock("./contract-notice-actions", () => ({ markContractNoticeDoneAction: vi.fn() }));
vi.mock("@/lib/contract-notices/store", () => ({ OPEN_NOTICES_SHOWN: 100, openContractNotices: m.notices }));
vi.mock("./CreditAdjustForm", () => ({ CreditAdjustForm: () => <div data-testid="credit-adjust-form" /> }));

import {
  funnelCounts,
  funnelSteps,
  shapeCohorts,
  type CohortQueryRow,
} from "@/lib/ops/activation-metrics";
import OperatorConsolePage from "./page";

const NOW = new Date("2026-11-13T15:30:00Z");
const perWindow = { day: 0, week: 0, month: 0 };
const noSpend = { total: 0, byAction: [] };

const row = (week: string, counts: Partial<Omit<CohortQueryRow, "week">>): CohortQueryRow => ({
  week: new Date(`${week}T00:00:00Z`),
  signups: 0, built: 0, studied: 0, week1: 0, week2: 0, pro: 0,
  funnelSignedUp: 0, funnelBuilt: 0, funnelStudied: 0, funnelReturned: 0, funnelPro: 0,
  ...counts,
});

beforeEach(() => {
  m.snapshot.mockResolvedValue({
    generatedAt: NOW,
    accounts: { total: 20, new: perWindow, active: { week: 0, month: 0 } },
    revenue: { subscriptions: [], billingEvents: [], packsSold: { month: 0, total: 0 } },
    ai: {
      creditsSpent: { day: noSpend, week: noSpend, month: noSpend },
      workspacesBuilt: perWindow,
      studyKits: perWindow,
      agentRuns: { total: 0, completed: 0, failed: 0, running: 0, failureRate: null },
      recentFailures: [],
    },
    content: { total: 0, createdWeek: 0, inTrash: 0 },
    inbox: { filter: "new", items: [], counts: { all: 0, new: 0, read: 0, done: 0 } },
  });
  m.activation.mockResolvedValue({ cohorts: shapeCohorts([], NOW), funnel: funnelSteps(funnelCounts([])) });
  m.leaving.mockResolvedValue({ total: 0, byReason: [], notes: [] });
  m.notices.mockResolvedValue({ count: 0, items: [] });
});

const renderPage = async () => render(await OperatorConsolePage({ searchParams: Promise.resolve({}) }));

describe("Operator console: activation and retention", () => {
  it("shows the weekly cohorts, blank where a window is still open, and the funnel", async () => {
    const rows = [
      row("2026-11-09", { signups: 4, built: 3, studied: 1, funnelSignedUp: 4, funnelBuilt: 3, funnelStudied: 1 }),
      row("2026-10-19", { signups: 5, built: 4, studied: 2, week1: 2, pro: 1, funnelSignedUp: 6, funnelBuilt: 5, funnelStudied: 3, funnelReturned: 2, funnelPro: 1 }),
    ];
    m.activation.mockResolvedValue({ cohorts: shapeCohorts(rows, NOW), funnel: funnelSteps(funnelCounts(rows)) });
    const { container } = await renderPage();

    const section = container.querySelector("section#activation") as HTMLElement;
    expect(section).not.toBeNull();
    expect(within(section).getByRole("heading", { level: 2, name: "Activation and retention" })).toBeTruthy();

    const cohortRows = within(section).getAllByTestId("cohort-row");
    expect(cohortRows).toHaveLength(8);
    const cells = (tr: HTMLElement) => [...tr.querySelectorAll("th, td")].map((cell) => cell.textContent?.trim());

    // This week: so far; week 1 and week 2 have not passed, so they stay blank (never 0%).
    expect(cells(cohortRows[0])).toEqual(["9 Nov 2026 so far", "4", "75% (3)", "25% (1)", "not yet", "not yet", "0% (0)"]);
    // A week nobody signed up in: dashes, and blank where its window is open.
    expect(cells(cohortRows[1])).toEqual(["2 Nov 2026", "0", "–", "–", "not yet", "not yet", "–"]);
    // 19 October: week 1 has passed for everyone, week 2 not yet.
    expect(cells(cohortRows[3])).toEqual(["19 Oct 2026", "5", "80% (4)", "40% (2)", "40% (2)", "not yet", "20% (1)"]);
    // Older weeks: both windows passed, so an empty week reads a dash rather than a blank.
    expect(cells(cohortRows[7])).toEqual(["21 Sept 2026", "0", "–", "–", "–", "–", "–"]);

    const steps = within(section).getAllByTestId("funnel-step").map((li) => li.textContent);
    expect(steps).toEqual([
      "Signed up10",
      "Built a workspace880% of the step before",
      "Studied450% of the step before",
      "Came back on a later day250% of the step before",
      "Pro, now or before150% of the step before",
    ]);
  });

  it("says so when the numbers cannot be loaded, and the rest of the console still renders", async () => {
    m.activation.mockResolvedValue(null);
    const { container } = await renderPage();
    const section = container.querySelector("section#activation") as HTMLElement;
    expect(within(section).getByText(/could not be loaded/)).toBeTruthy();
    expect(screen.getByRole("heading", { level: 2, name: "Accounts" })).toBeTruthy();
  });

  it("has no funnel to draw without signups in the last 30 days", async () => {
    m.activation.mockResolvedValue({ cohorts: shapeCohorts([], NOW), funnel: funnelSteps(funnelCounts([])) });
    const { container } = await renderPage();
    const section = container.querySelector("section#activation") as HTMLElement;
    expect(within(section).getByText("No signups in the last 30 days.")).toBeTruthy();
    expect(within(section).queryAllByTestId("funnel-step")).toHaveLength(0);
  });
});

describe("Operator console: why students leave", () => {
  it("counts the reasons and shows the latest notes", async () => {
    m.leaving.mockResolvedValue({
      total: 3,
      byReason: [
        { reason: "tooExpensive", count: 2 },
        { reason: "finished", count: 1 },
      ],
      notes: [{ note: "Exams are over", reason: "finished", plan: "free", tenure: "month", createdAt: NOW }],
    });
    const { container } = await renderPage();
    const section = container.querySelector("section#leaving") as HTMLElement;
    expect(within(section).getAllByTestId("leaving-reason")).toHaveLength(2);
    expect(within(section).getByText("It costs too much")).toBeTruthy();
    expect(within(section).getByText("Exams are over")).toBeTruthy();
    expect(within(section).getByText(/had the account under a month/)).toBeTruthy();
  });

  it("says when there are no answers yet, or when they cannot be loaded", async () => {
    let view = await renderPage();
    expect(within(view.container.querySelector("section#leaving") as HTMLElement).getByText("No answers in the last 90 days.")).toBeTruthy();
    view.unmount();
    m.leaving.mockResolvedValue(null);
    view = await renderPage();
    expect(within(view.container.querySelector("section#leaving") as HTMLElement).getByText(/could not be loaded/)).toBeTruthy();
  });
});

describe("Operator console: contract notices", () => {
  const notice = (over: Record<string, unknown>) => ({
    id: "notice_1",
    kind: "withdrawal",
    receivedAt: new Date("2026-11-13T14:30:00Z"),
    name: "Ada Lovelace",
    email: "ada@example.com",
    contractKind: "pack",
    contractRef: "cs_123",
    details: "Bought on 2 Nov",
    cancelType: null,
    reason: null,
    requestedEnd: null,
    locale: "de",
    userId: "user_1",
    ackStatus: "sent",
    operatorNotified: true,
    stripeOutcome: null,
    proEndsAt: null,
    ...over,
  });

  it("lists the open notices with what the operator needs, a Mark done button, and a count at the top", async () => {
    m.notices.mockResolvedValue({
      count: 2,
      items: [
        notice({}),
        notice({
          id: "notice_2",
          kind: "cancellation",
          name: "Grace Hopper",
          email: "grace@example.com",
          contractKind: "pro",
          contractRef: null,
          details: null,
          cancelType: "extraordinary",
          reason: "The service stopped working",
          userId: null,
          ackStatus: "failed",
          stripeOutcome: "failed",
        }),
      ],
    });
    const { container } = await renderPage();
    expect(screen.getByTestId("open-notices-count").textContent).toBe(
      "2 open withdrawal or cancellation notices to process",
    );
    const section = container.querySelector("section#contract-notices") as HTMLElement;
    const items = within(section).getAllByTestId("contract-notice");
    expect(items).toHaveLength(2);
    const first = items[0].textContent ?? "";
    for (const part of ["withdrawal", "13 Nov 2026, 14:30 UTC", "Ada Lovelace", "ada@example.com", "Credit pack (cs_123)", "Bought on 2 Nov", "user_1", "acknowledgement sent"]) {
      expect(first).toContain(part);
    }
    const second = items[1].textContent ?? "";
    for (const part of ["cancellation", "extraordinary, earliest possible date", "The service stopped working", "not signed in", "acknowledgement FAILED", "Stripe update FAILED"]) {
      expect(second).toContain(part);
    }
    expect(within(items[0]).getByRole("button", { name: "Mark done" })).toBeTruthy();
    expect((items[0].querySelector('input[name="id"]') as HTMLInputElement).value).toBe("notice_1");
  });

  it("says when there are none, or when they cannot be loaded, and the console still renders", async () => {
    let view = await renderPage();
    expect(within(view.container.querySelector("section#contract-notices") as HTMLElement).getByText("No open notices.")).toBeTruthy();
    expect(screen.queryByTestId("open-notices-count")).toBeNull();
    view.unmount();
    m.notices.mockRejectedValue(new Error("relation does not exist"));
    view = await renderPage();
    expect(
      within(view.container.querySelector("section#contract-notices") as HTMLElement).getByText(/could not be loaded/),
    ).toBeTruthy();
    expect(screen.getByRole("heading", { level: 2, name: "Accounts" })).toBeTruthy();
  });
});
