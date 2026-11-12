import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { QuizBlock, QuizQuestion, Workspace } from "@/lib/workspace/types";
import { en } from "@/lib/i18n/dictionaries/en";
import { fmt } from "@/lib/i18n/interpolate";
import { pluralizer } from "@/lib/i18n/plural";
import { EMPTY_STREAK } from "@/lib/study/streak";

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
vi.mock("../WorkspaceContext", async () => {
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
  RichText: ({ text }: { text: string }) => <div data-testid="rich">{text}</div>,
}));
vi.mock("@/components/workspace/materials/MaterialSourceViewer", () => ({
  MaterialSourceViewer: () => null,
}));

import { StudyLauncher } from "../StudyLauncher";
import { examKey } from "./examProgress";
import { quizItems } from "@/lib/study/quiz";

const Q = en.quiz;
const T = en.studyTools;

const tf = (id: string, prompt: string, stats?: QuizQuestion["stats"]): QuizQuestion => ({
  id,
  kind: "true_false",
  prompt,
  answerBool: true,
  ...(stats ? { stats } : {}),
});

function setWorkspace() {
  h.store.workspace = {
    id: "w1",
    name: "Semester",
    databases: [],
    pages: [
      {
        id: "p1",
        title: "Biology",
        blocks: [
          {
            id: "qa",
            type: "quiz",
            title: "Cells",
            questions: [tf("a1", "Missed often", { attempts: 6, correct: 0 }), tf("a2", "Known", { attempts: 6, correct: 6 })],
            attempts: [{ at: "2026-11-10T10:00:00.000Z", mode: "exam", score: 1, total: 2 }],
          },
        ],
      },
      {
        id: "p2",
        title: "Chemistry",
        blocks: [{ id: "qb", type: "quiz", title: "Acids", questions: [tf("b1", "Never tried")] }],
      },
    ],
  };
}
const quizAt = (page: number) => h.store.workspace.pages[page].blocks[0] as QuizBlock;

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
  h.getStudyStatsAction.mockReset().mockResolvedValue({ ...EMPTY_STREAK });
  h.getStudyDashboardAction.mockReset().mockResolvedValue(null);
});

describe("quizzes in the study hub", () => {
  it("shows up with only quizzes (no decks) and lists every quiz with its last score", async () => {
    const user = userEvent.setup();
    setWorkspace();
    render(<StudyLauncher />);
    await user.click(screen.getByRole("button", { name: T.openHub }));
    const hub = screen.getByRole("dialog", { name: T.studyHub });
    expect(within(hub).getByRole("heading", { name: Q.hubTitle })).toBeInTheDocument();
    expect(within(hub).getByText("Biology · 2 questions · Last: 50%")).toBeInTheDocument();
    expect(within(hub).getByText(`Chemistry · 1 question · ${Q.notTaken}`)).toBeInTheDocument();
    expect(within(hub).getByText(fmt(Q.weakMissed, { count: 1 }))).toBeInTheDocument();
  });

  it("practises weak questions drawn from every quiz and saves to each quiz", async () => {
    const user = userEvent.setup();
    setWorkspace();
    render(<StudyLauncher />);
    await user.click(screen.getByRole("button", { name: T.openHub }));
    await user.click(screen.getByRole("button", { name: Q.weakStart }));
    expect(screen.queryByRole("dialog", { name: T.studyHub })).not.toBeInTheDocument();
    const session = screen.getByRole("dialog", { name: Q.weakSession });
    expect(within(session).getByText("1 / 3")).toBeInTheDocument();
    // The weakest question comes first, labelled with its quiz.
    expect(screen.getByTestId("practice-question")).toHaveTextContent("Missed often");
    expect(screen.getByTestId("practice-question")).toHaveTextContent("Cells");
    for (let i = 0; i < 3; i += 1) {
      await user.keyboard("1");
      await user.keyboard("{Enter}");
    }
    expect(screen.getByTestId("quiz-score")).toHaveTextContent("100%");
    expect(quizAt(0).questions[0].stats).toMatchObject({ attempts: 7, correct: 1 });
    expect(quizAt(1).questions[0].stats).toMatchObject({ attempts: 1, correct: 1 });
    // Mixed rounds are not attempts at any one quiz.
    expect(quizAt(0).attempts).toHaveLength(1);
    expect(quizAt(1).attempts).toBeUndefined();
  });

  it("shows an exam left unfinished on this device and resumes it (QA round 3)", async () => {
    const user = userEvent.setup();
    setWorkspace();
    // Node's own localStorage shadows jsdom's here: a plain in-memory one.
    const data = new Map<string, string>();
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: {
        getItem: (k: string) => data.get(k) ?? null,
        setItem: (k: string, v: string) => void data.set(k, String(v)),
        removeItem: (k: string) => void data.delete(k),
      },
    });
    window.localStorage.setItem(
      examKey("w1", "p2", "qb"),
      JSON.stringify({
        v: 1,
        questions: quizItems("p2", quizAt(1)).map((item) => ({ ...item, key: `p2:qb:${item.questionId}` })),
        answers: [],
        deadline: null,
        savedAt: Date.now(),
      }),
    );
    render(<StudyLauncher />);
    await user.click(screen.getByRole("button", { name: T.openHub }));
    const hub = screen.getByRole("dialog", { name: T.studyHub });
    expect(
      within(hub).getByText(`Chemistry · 1 question · ${fmt(Q.examInProgressAnswered, { answered: 0, total: 1 })}`),
    ).toBeInTheDocument();
    expect(within(hub).queryByRole("button", { name: `${Q.exam}: Acids` })).not.toBeInTheDocument();
    await user.click(within(hub).getByRole("button", { name: `${Q.resumeExam}: Acids` }));
    expect(screen.getByText(en.safety.examResumed)).toBeInTheDocument();
    data.clear();
  });

  it("starts one quiz as an exam from the hub", async () => {
    const user = userEvent.setup();
    setWorkspace();
    render(<StudyLauncher />);
    await user.click(screen.getByRole("button", { name: T.openHub }));
    await user.click(screen.getByRole("button", { name: `${Q.exam}: Acids` }));
    expect(screen.getByRole("dialog", { name: "Acids" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: Q.examSetupTitle })).toBeInTheDocument();
  });
});
