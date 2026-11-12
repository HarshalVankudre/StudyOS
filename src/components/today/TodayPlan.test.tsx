import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "@/lib/i18n/client";
import { en } from "@/lib/i18n/dictionaries/en";
import { de } from "@/lib/i18n/dictionaries/de";
import type { DailyStudyPlanItem, TodayPlanView } from "@/lib/agents/daily-study/types";

const mocks = vi.hoisted(() => ({
  setTodayItemAction: vi.fn(),
  rebuildTodayAction: vi.fn(),
  refresh: vi.fn(),
  toast: vi.fn(),
}));

vi.mock("@/app/app/agents/actions", () => ({
  setTodayItemAction: mocks.setTodayItemAction,
  rebuildTodayAction: mocks.rebuildTodayAction,
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock("sonner", () => ({ toast: mocks.toast }));

import { TodayPlan } from "./TodayPlan";

function item(overrides: Partial<DailyStudyPlanItem>): DailyStudyPlanItem {
  return {
    id: "task:ws:p:todo",
    kind: "task",
    mode: "finish",
    title: "Email the tutor",
    workspaceName: "Semester HQ",
    section: "Home",
    target: { workspaceId: "ws", pageId: "p", blockId: "todo" },
    minutes: 15,
    reason: { code: "open_task" },
    completed: false,
    ...overrides,
  };
}

const essay = item({
  id: "deadline:ws:db:essay",
  kind: "deadline",
  mode: "session",
  title: "History essay",
  section: "Assignments",
  target: { workspaceId: "ws", pageId: "tracker", databaseId: "db", rowId: "essay" },
  minutes: 45,
  reason: { code: "start_early", days: 4, effortMinutes: 240 },
  dueDate: "2026-11-16",
  weight: 25,
  startHere: true,
  carry: { from: "2026-11-10", count: 1 },
});
const deck = item({
  id: "flashcards:ws:bio:deck",
  kind: "flashcards",
  mode: "study",
  title: "Cell biology",
  section: "Biology",
  target: { workspaceId: "ws", pageId: "bio", blockId: "deck" },
  minutes: 20,
  reason: { code: "cards_due", count: 12 },
  dueCount: 12,
  progress: { done: 4, total: 12 },
});
const todo = item({});

function plan(overrides: Partial<TodayPlanView> = {}): TodayPlanView {
  return {
    id: "plan-1",
    localDate: "2026-11-12",
    timeZone: "Europe/Berlin",
    items: [essay, deck, todo],
    details: {
      budgetMinutes: 90,
      workload: {
        overloaded: true,
        days: 4,
        neededMinutes: 420,
        availableMinutes: 270,
        startToday: ["History essay"],
      },
      exams: [
        {
          id: "exam:ws:db:mid",
          title: "Biology midterm",
          workspaceName: "Semester HQ",
          date: "2026-11-15",
          days: 3,
          major: true,
          target: { workspaceId: "ws", pageId: "tracker", databaseId: "db", rowId: "mid" },
        },
      ],
      progress: {},
      previousDate: "2026-11-09",
      carried: 1,
    },
    sourceCount: 1,
    candidateCount: 5,
    generatedAt: "2026-11-12T07:00:00.000Z",
    ...overrides,
  };
}

function renderToday(p: TodayPlanView | null = plan(), dict = en, locale: "en" | "de" = "en") {
  return render(
    <I18nProvider locale={locale} dictionary={dict}>
      <TodayPlan plan={p} dailyMinutes={60} />
    </I18nProvider>,
  );
}

beforeEach(() => {
  mocks.setTodayItemAction.mockResolvedValue({ ok: true, completed: true, wroteThrough: true });
  mocks.rebuildTodayAction.mockResolvedValue({ ok: true });
});

describe("TodayPlan", () => {
  it("shows a calm plan: time, reasons, deep links, exam countdown and an early workload heads-up", () => {
    renderToday();
    expect(screen.getByRole("heading", { level: 1, name: "Today" })).toBeInTheDocument();
    expect(screen.getByText("0 of 3 done")).toBeInTheDocument();
    expect(screen.getByText(/3 things · about 1 h 20 min/)).toBeInTheDocument();

    const list = screen.getByRole("list", { name: "Today’s plan" });
    const rows = within(list).getAllByRole("listitem");
    expect(rows).toHaveLength(3);

    // Item 1: a work session toward an essay, rolled forward from Tuesday.
    const first = within(rows[0]);
    expect(first.getByText("Start here")).toBeInTheDocument();
    expect(first.getByRole("link", { name: "Open History essay" })).toHaveAttribute(
      "href",
      "/app/ws?page=tracker&db=db&row=essay",
    );
    expect(first.getByText("45 min")).toBeInTheDocument();
    expect(first.getByText(/About 4 h of work left before Nov 16/)).toBeInTheDocument();
    expect(first.getByText(/Worth 25% of the grade\. Moved from Tuesday/)).toBeInTheDocument();

    // Item 2: flashcards that check themselves off as the student studies.
    const second = within(rows[1]);
    expect(second.getByRole("link", { name: "Open Review Cell biology" })).toHaveAttribute(
      "href",
      "/app/ws?page=bio&block=deck",
    );
    expect(second.getByText("12 cards are ready for review.")).toBeInTheDocument();
    expect(second.getByText("4 of 12 cards")).toBeInTheDocument();
    expect(second.getByText("Checks itself off when you study")).toBeInTheDocument();

    expect(screen.getByText("Welcome back. Your plan rebuilt itself around what’s still ahead.")).toBeInTheDocument();
    expect(screen.getByText("Heads-up: the next 4 days are full")).toBeInTheDocument();
    expect(screen.getByText("Good to start today: “History essay”")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Biology midterm\s*in 3 days/ })).toHaveAttribute(
      "href",
      "/app/ws?page=tracker&db=db&row=mid",
    );
  });

  it("checks an item off through the server, optimistically, and says when the workspace was updated", async () => {
    const user = userEvent.setup();
    let resolve: (v: unknown) => void = () => {};
    mocks.setTodayItemAction.mockReturnValue(new Promise((r) => (resolve = r)));
    renderToday();

    const box = screen.getByRole("checkbox", { name: "Mark “Email the tutor” done" });
    expect(box).toHaveAttribute("aria-checked", "false");
    await user.click(box);
    expect(box).toHaveAttribute("aria-checked", "true");
    expect(mocks.setTodayItemAction).toHaveBeenCalledWith({
      planId: "plan-1",
      itemId: "task:ws:p:todo",
      completed: true,
      finish: false,
    });
    await act(async () => resolve({ ok: true, completed: true, wroteThrough: true }));
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith(en.today.doneSynced));
    expect(mocks.refresh).toHaveBeenCalled();
  });

  it("can be unchecked, and a failed save is reported without scolding", async () => {
    const user = userEvent.setup();
    mocks.setTodayItemAction.mockResolvedValue({ ok: false, reason: "conflict" });
    renderToday(plan({ items: [{ ...todo, completed: true }] }));
    const box = screen.getByRole("checkbox", { name: "Mark “Email the tutor” not done" });
    await user.click(box);
    expect(mocks.setTodayItemAction).toHaveBeenCalledWith(expect.objectContaining({ completed: false }));
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith(en.today.conflict));
    // The optimistic change falls back to the saved state.
    await waitFor(() => expect(box).toHaveAttribute("aria-checked", "true"));
  });

  it("lets a work session finish the assignment in the workspace", async () => {
    const user = userEvent.setup();
    renderToday();
    await user.click(screen.getByRole("button", { name: "Mark “History essay” finished in your workspace" }));
    expect(mocks.setTodayItemAction).toHaveBeenCalledWith({
      planId: "plan-1",
      itemId: "deadline:ws:db:essay",
      completed: true,
      finish: true,
    });
  });

  it("rebuilds from today around the time the student has", async () => {
    const user = userEvent.setup();
    renderToday();
    await user.click(screen.getByRole("button", { name: "Rebuild from today" }));
    const group = screen.getByRole("radiogroup", { name: "How much time do you have today?" });
    await user.click(within(group).getByRole("radio", { name: "30 min" }));
    await user.click(screen.getByRole("button", { name: "Rebuild my plan" }));
    expect(mocks.rebuildTodayAction).toHaveBeenCalledWith(expect.objectContaining({ minutes: 30 }));
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalled());
  });

  it("offers to plan the day when there is no plan yet", async () => {
    const user = userEvent.setup();
    renderToday(null);
    await user.click(screen.getByRole("button", { name: "Plan my day" }));
    expect(mocks.rebuildTodayAction).toHaveBeenCalledWith(expect.objectContaining({ minutes: undefined }));
  });

  it("celebrates a finished day quietly", () => {
    renderToday(plan({ items: [{ ...todo, completed: true }] }));
    expect(screen.getByText("That’s today done")).toBeInTheDocument();
  });

  it("re-renders the whole plan in the student's language", () => {
    renderToday(plan(), de, "de");
    expect(screen.getByRole("heading", { level: 1, name: "Heute" })).toBeInTheDocument();
    expect(screen.getByText("12 Karten sind zum Wiederholen bereit.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Cell biology wiederholen öffnen" })).toBeInTheDocument();
    expect(screen.getByText("Hinweis: Die nächsten 4 Tage sind voll")).toBeInTheDocument();
    // The student's own titles are never translated.
    expect(screen.getAllByText("History essay").length).toBeGreaterThan(0);
  });
});

describe("TodayPlan: QA round 2", () => {
  const finalExam = (id: string, workspaceName: string, course?: string) => ({
    id,
    title: "Final exam",
    workspaceName,
    ...(course ? { course } : {}),
    date: "2026-12-11",
    days: 29,
    major: true,
    target: { workspaceId: "ws", pageId: "tracker", databaseId: "db", rowId: id },
  });

  it("names the course on exam chips that share a title", () => {
    renderToday(
      plan({
        details: {
          ...plan().details,
          exams: [finalExam("f1", "Semester HQ", "MATH 221"), finalExam("f2", "Semester HQ", "CHEM 210")],
        },
      }),
    );
    expect(screen.getByRole("link", { name: /Final exam\s*MATH 221\s*in 29 days/ })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Final exam\s*CHEM 210\s*in 29 days/ })).toBeInTheDocument();
  });

  it("falls back to the workspace name when same-titled exams have no course", () => {
    renderToday(
      plan({ details: { ...plan().details, exams: [finalExam("f1", "Fall HQ"), finalExam("f2", "Pharmacy")] } }),
    );
    expect(screen.getByRole("link", { name: /Final exam\s*Fall HQ/ })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Final exam\s*Pharmacy/ })).toBeInTheDocument();
  });

  it("says when a review session leaves cards for later days", () => {
    const bounded = { ...deck, reason: { code: "cards_due" as const, count: 33, readyCount: 60 }, dueCount: 33, progress: undefined };
    renderToday(plan({ items: [bounded] }));
    expect(screen.getByText(/33 of the 60 cards ready today\. The rest can wait for another day\./)).toBeInTheDocument();
  });
});
