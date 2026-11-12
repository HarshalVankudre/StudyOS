import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Workspace, Flashcard } from "@/lib/workspace/types";
import { en } from "@/lib/i18n/dictionaries/en";
import { fmt } from "@/lib/i18n/interpolate";
import { pluralizer } from "@/lib/i18n/plural";
import { isoDay } from "@/lib/study/srs";
import { shiftDay } from "@/lib/study/days";
import { EMPTY_STREAK, type StreakStatus } from "@/lib/study/streak";
import type { StudyDashboard } from "@/app/app/study-actions";

const h = vi.hoisted(() => ({
  recordReviewsAction: vi.fn(),
  getStudyStatsAction: vi.fn(),
  getStudyDashboardAction: vi.fn(),
  update: vi.fn(),
  store: { workspace: null as unknown as Workspace, listeners: new Set<() => void>() },
}));
vi.mock("@/app/app/study-actions", () => ({
  recordReviewsAction: h.recordReviewsAction,
  getStudyStatsAction: h.getStudyStatsAction,
  getStudyDashboardAction: h.getStudyDashboardAction,
}));
vi.mock("./WorkspaceContext", async () => {
  const React = await import("react");
  return {
    useWorkspace: () => {
      const [, force] = React.useReducer((x: number) => x + 1, 0);
      React.useEffect(() => {
        h.store.listeners.add(force);
        return () => void h.store.listeners.delete(force);
      }, []);
      return { workspace: h.store.workspace, update: h.update };
    },
  };
});
vi.mock("@/lib/i18n/client", () => ({
  useI18n: () => ({ dict: en, t: fmt, plural: pluralizer("en"), locale: "en", dir: "ltr" }),
}));
vi.mock("@/components/RichText", () => ({
  RichText: ({ text }: { text: string }) => <div>{text}</div>,
}));

import { StudyLauncher } from "./StudyLauncher";

const T = en.studyTools;
const TODAY = isoDay(new Date());
const later: Partial<Flashcard> = {
  state: "review",
  stability: 30,
  difficulty: 5,
  reps: 3,
  intervalDays: 30,
  dueAt: shiftDay(TODAY, 9),
  lastReviewedAt: new Date().toISOString(),
};

function setWorkspace(deckA: Flashcard[], deckB: Flashcard[]) {
  h.store.workspace = {
    id: "w1",
    name: "Semester",
    pages: [
      { id: "p1", title: "Bio", blocks: [{ id: "d1", type: "flashcards", title: "Bio", cards: deckA }] },
      { id: "p2", title: "Chem", blocks: [{ id: "d2", type: "flashcards", title: "Chem", cards: deckB }] },
    ],
    databases: [],
  };
}
const cardsOf = (page: number) => {
  const b = h.store.workspace.pages[page].blocks[0];
  return b.type === "flashcards" ? b.cards : [];
};

function streak(o: Partial<StreakStatus>): StreakStatus {
  return { ...EMPTY_STREAK, ...o };
}

beforeEach(() => {
  h.store.listeners.clear();
  h.update.mockReset();
  h.update.mockImplementation((mutator: (d: Workspace) => void) => {
    const draft = structuredClone(h.store.workspace);
    mutator(draft);
    h.store.workspace = draft;
    h.store.listeners.forEach((l) => l());
  });
  h.recordReviewsAction.mockReset().mockResolvedValue({ ok: true });
  h.getStudyStatsAction.mockReset().mockResolvedValue(streak({}));
  h.getStudyDashboardAction.mockReset().mockResolvedValue(null);
});

describe("StudyLauncher", () => {
  it("reviews due cards from every deck in one session", async () => {
    const user = userEvent.setup();
    setWorkspace(
      [{ id: "a1", front: "Bio Q", back: "Bio A" }],
      [
        { id: "b1", front: "Chem Q", back: "Chem A" },
        { id: "b2", front: "Later", back: "x", ...later },
      ],
    );
    render(<StudyLauncher />);
    await user.click(screen.getByRole("button", { name: "Study 2 due" }));
    expect(screen.getByRole("dialog", { name: "Semester" })).toBeInTheDocument();
    for (let i = 0; i < 2; i++) {
      await user.click(screen.getByRole("button", { name: /Show answer/ }));
      await user.click(screen.getByRole("button", { name: /Easy/ }));
    }
    expect(screen.getByText(en.study.doneTitle)).toBeInTheDocument();
    expect(cardsOf(0)[0].state).toBe("review");
    expect(cardsOf(1)[0].state).toBe("review");
    expect(cardsOf(1)[1]).toEqual({ id: "b2", front: "Later", back: "x", ...later });
  });

  it("practises all decks when nothing is due, leaving the schedule alone", async () => {
    const user = userEvent.setup();
    setWorkspace(
      [{ id: "a1", front: "Bio Q", back: "Bio A", ...later }],
      [{ id: "b1", front: "Chem Q", back: "Chem A", ...later }],
    );
    render(<StudyLauncher />);
    expect(screen.queryByRole("button", { name: /Study \d+ due/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: T.openHub }));
    const hub = screen.getByRole("dialog", { name: T.studyHub });
    expect(within(hub).getByText(T.caughtUpHint)).toBeInTheDocument();
    await user.click(within(hub).getByRole("button", { name: T.practiceAll }));
    expect(screen.getByText("1 / 2")).toBeInTheDocument();
    for (let i = 0; i < 2; i++) {
      await user.click(screen.getByRole("button", { name: /Show answer/ }));
      await user.click(screen.getByRole("button", { name: /Good/ }));
    }
    expect(screen.getByText(T.scheduleUnchanged)).toBeInTheDocument();
    expect(h.update).not.toHaveBeenCalled();
  });

  it("shows the streak with freezes and the statistics for this workspace and overall", async () => {
    const user = userEvent.setup();
    setWorkspace([{ id: "a1", front: "Q", back: "A", ...later }], []);
    h.getStudyStatsAction.mockResolvedValue(streak({ current: 12, longest: 12, freezes: 1, atRisk: false }));
    const dash = (forecast: StudyDashboard["forecast"]): StudyDashboard => ({
      today: TODAY,
      streak: streak({ current: 12, longest: 12, freezes: 1, towardFreeze: 5, frozenDays: [] }),
      perDay: Array.from({ length: 28 }, (_, i) => ({ day: shiftDay(TODAY, i - 27), reviews: i === 27 ? 7 : 0, practice: 0 })),
      retention: 0.9,
      reviews30: 7,
      forecast,
    });
    h.getStudyDashboardAction.mockImplementation(async ({ workspaceId }: { workspaceId?: string }) =>
      dash(workspaceId ? null : { points: [{ day: TODAY, count: 4 }], newWaiting: 3 }),
    );
    render(<StudyLauncher />);
    const chip = await screen.findByRole("button", { name: `12-day streak · ${T.openHub}` });
    await user.click(chip);
    const hub = screen.getByRole("dialog", { name: T.studyHub });
    expect(await within(hub).findByText("90%")).toBeInTheDocument();
    expect(within(hub).getByText("12-day streak")).toBeInTheDocument();
    expect(within(hub).getByText("Streak freezes: 1")).toBeInTheDocument();
    expect(h.getStudyDashboardAction).toHaveBeenLastCalledWith(expect.objectContaining({ workspaceId: "w1" }));
    // This workspace's forecast comes from its own cards (due in 9 days).
    expect(within(hub).getByText(T.dueNext)).toBeInTheDocument();

    await user.click(within(hub).getByRole("radio", { name: T.allWorkspaces }));
    await waitFor(() =>
      expect(h.getStudyDashboardAction).toHaveBeenLastCalledWith(expect.objectContaining({ workspaceId: undefined })),
    );
    expect(await within(hub).findByText("3 new cards waiting")).toBeInTheDocument();
  });

  it("warns when the streak is at risk and welcomes back after one ended", async () => {
    const user = userEvent.setup();
    setWorkspace([{ id: "a1", front: "Q", back: "A", ...later }], []);
    h.getStudyStatsAction.mockResolvedValue(streak({ current: 4, atRisk: true }));
    h.getStudyDashboardAction.mockResolvedValue({
      today: TODAY,
      streak: streak({ current: 0, longest: 9, ended: { length: 9, on: shiftDay(TODAY, -1) } }),
      perDay: [],
      retention: null,
      reviews30: 0,
      forecast: null,
    } satisfies StudyDashboard);
    render(<StudyLauncher />);
    await user.click(await screen.findByRole("button", { name: `4-day streak · ${T.openHub}` }));
    expect(await screen.findByText(fmt(T.streakEnded, { count: 9 }))).toBeInTheDocument();
  });
});
