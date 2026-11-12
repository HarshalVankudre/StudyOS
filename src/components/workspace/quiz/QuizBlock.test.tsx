import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { QuizBlock as QuizData, QuizQuestion, Workspace } from "@/lib/workspace/types";
import { en } from "@/lib/i18n/dictionaries/en";
import { fmt } from "@/lib/i18n/interpolate";
import { pluralizer } from "@/lib/i18n/plural";

const h = vi.hoisted(() => ({
  recordReviewsAction: vi.fn(),
  update: vi.fn(),
  store: { workspace: null as unknown as Workspace, listeners: new Set<() => void>() },
}));
vi.mock("@/app/app/study-actions", () => ({
  recordReviewsAction: h.recordReviewsAction,
  getStudyStatsAction: vi.fn().mockResolvedValue(null),
  getStudyDashboardAction: vi.fn().mockResolvedValue(null),
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

import { QuizBlock } from "./QuizBlock";
import { useWorkspace } from "../WorkspaceContext";

const Q = en.quiz;

function Harness() {
  const { workspace } = useWorkspace();
  return <QuizBlock pageId="p1" block={workspace.pages[0].blocks[0] as QuizData} />;
}

function setQuiz(questions: QuizQuestion[], extra: Partial<QuizData> = {}) {
  h.store.workspace = {
    id: "w1",
    name: "WS",
    pages: [{ id: "p1", title: "P", blocks: [{ id: "quiz1", type: "quiz", title: "Cells", questions, ...extra }] }],
    databases: [],
  };
}
const quiz = () => h.store.workspace.pages[0].blocks[0] as QuizData;
const question = (id: string) => quiz().questions.find((q) => q.id === id)!;

const MCQ: QuizQuestion = {
  id: "m",
  kind: "mcq",
  prompt: "Powerhouse of the cell?",
  choices: ["Nucleus", "Mitochondria", "Ribosome"],
  answerIndex: 1,
  explanation: "It makes ATP.",
  source: { page: 4, label: "Lecture 2" },
};
const TF: QuizQuestion = { id: "t", kind: "true_false", prompt: "Plant cells have walls.", answerBool: true };
const SHORT: QuizQuestion = { id: "s", kind: "short", prompt: "Define osmosis.", answerText: "Diffusion of water" };
const DRAFT: QuizQuestion = { id: "d", kind: "mcq", prompt: "Half written", choices: ["", ""] };

/** Every quiz-answer count sent to the per-day study record. */
const quizAnswersRecorded = () =>
  h.recordReviewsAction.mock.calls.flatMap((c) => c[0] as { counts: { quizAnswers: number } }[]).reduce(
    (n, b) => n + b.counts.quizAnswers,
    0,
  );

beforeEach(() => {
  h.store.listeners.clear();
  h.update.mockReset();
  h.update.mockImplementation((mutator: (d: Workspace) => void) => {
    const draft = structuredClone(h.store.workspace);
    mutator(draft);
    h.store.workspace = draft;
    h.store.listeners.forEach((l) => l());
  });
  h.recordReviewsAction.mockReset();
  h.recordReviewsAction.mockResolvedValue({ ok: true });
});
afterEach(() => {
  vi.useRealTimers();
});

describe("QuizBlock — practice", () => {
  it("one question at a time with immediate feedback, then the score, the misses and a re-drill", async () => {
    const user = userEvent.setup();
    setQuiz([MCQ, TF, SHORT, DRAFT]);
    render(<Harness />);
    // The half-written question is not counted or taken.
    expect(screen.getByText("3 questions")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: Q.practice }));

    const dialog = screen.getByRole("dialog", { name: "Cells" });
    expect(within(dialog).getByText("1 / 3")).toBeInTheDocument();

    for (let i = 0; i < 3; i += 1) {
      const card = screen.getByTestId("practice-question");
      const prompt = within(card).getAllByTestId("rich")[0].textContent;
      if (prompt === MCQ.prompt) {
        // Mouse/touch: tap the right answer.
        await user.click(within(card).getByRole("button", { name: /Mitochondria/ }));
        expect(screen.getByText(Q.correct)).toBeInTheDocument();
        expect(screen.getByText("It makes ATP.")).toBeInTheDocument();
        expect(screen.getByTestId("source-chip")).toHaveTextContent("p. 4");
        // Locked once answered.
        expect(within(card).getByRole("button", { name: /Nucleus/ })).toBeDisabled();
      } else if (prompt === TF.prompt) {
        // Keyboard: 2 = False (wrong).
        await user.keyboard("2");
        expect(screen.getByText(Q.incorrect)).toBeInTheDocument();
      } else {
        await user.type(within(card).getByRole("textbox", { name: Q.typeAnswer }), "water moves");
        await user.click(within(card).getByRole("button", { name: Q.showModelAnswer }));
        expect(within(card).getByText("Diffusion of water")).toBeInTheDocument();
        await user.click(within(card).getByRole("button", { name: new RegExp(Q.markWrong) }));
        expect(screen.getByText(Q.incorrect)).toBeInTheDocument();
      }
      // Enter moves on (the Next button has focus).
      await user.keyboard("{Enter}");
    }

    expect(screen.getByTestId("quiz-score")).toHaveTextContent("33%");
    expect(screen.getByText("1 of 3 correct")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: Q.missedTitle })).toBeInTheDocument();
    expect(screen.getAllByTestId("review-item")).toHaveLength(2);

    // Saved in the block: per-question stats and one practice attempt.
    expect(question("m").stats).toMatchObject({ attempts: 1, correct: 1 });
    expect(question("t").stats).toMatchObject({ attempts: 1, correct: 0 });
    expect(question("s").stats).toMatchObject({ attempts: 1, correct: 0 });
    expect(question("d").stats).toBeUndefined();
    expect(quiz().attempts).toEqual([expect.objectContaining({ mode: "practice", score: 1, total: 3 })]);

    // Re-drill only the two missed questions.
    await user.click(screen.getByRole("button", { name: "Re-drill 2 missed" }));
    expect(screen.getByText("1 / 2")).toBeInTheDocument();
    for (let i = 0; i < 2; i += 1) {
      const card = screen.getByTestId("practice-question");
      const prompt = within(card).getAllByTestId("rich")[0].textContent;
      expect([TF.prompt, SHORT.prompt]).toContain(prompt);
      if (prompt === TF.prompt) {
        await user.keyboard("1");
      } else {
        await user.click(within(card).getByRole("button", { name: Q.showModelAnswer }));
        await user.keyboard("1"); // self-mark right
      }
      expect(screen.getByText(Q.correct)).toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: /Next|See results/ }));
    }
    expect(screen.getByTestId("quiz-score")).toHaveTextContent("100%");
    expect(screen.getByText(Q.allCorrect)).toBeInTheDocument();
    expect(question("t").stats).toMatchObject({ attempts: 2, correct: 1 });
    // A re-drill is not a full attempt at the quiz.
    expect(quiz().attempts).toHaveLength(1);

    await user.click(screen.getByRole("button", { name: Q.done }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByText("Last: 33%")).toBeInTheDocument();
    // Every answer counted as studying (3 + 2).
    await vi.waitFor(() => expect(quizAnswersRecorded()).toBe(5));
  });

  it("saves what was answered when practice is left early, without an attempt", async () => {
    const user = userEvent.setup();
    setQuiz([{ ...TF }]);
    render(<Harness />);
    await user.click(screen.getByRole("button", { name: Q.practice }));
    await user.keyboard("1");
    await user.click(screen.getByRole("button", { name: Q.close }));
    expect(question("t").stats).toMatchObject({ attempts: 1, correct: 1 });
    expect(quiz().attempts).toBeUndefined();
  });
});

describe("QuizBlock — exam", () => {
  it("timer, no feedback until submission, then a score and a review of every answer", async () => {
    const user = userEvent.setup();
    setQuiz([MCQ, TF, SHORT]);
    render(<Harness />);
    await user.click(screen.getByRole("button", { name: Q.exam }));
    expect(screen.getByText(fmt(Q.examSetupBody, { count: 3 }))).toBeInTheDocument();
    await user.click(screen.getByRole("radio", { name: "20 min" }));
    await user.click(screen.getByRole("button", { name: Q.startExam }));

    expect(screen.getByRole("timer")).toHaveTextContent(/^(20:00|19:5\d)$/);
    const questions = screen.getAllByTestId("exam-question");
    expect(questions).toHaveLength(3);
    const byPrompt = (p: string) => questions.find((q) => within(q).getAllByTestId("rich")[0].textContent === p)!;

    // Choices by touch/click; no feedback is shown.
    await user.click(within(byPrompt(MCQ.prompt)).getByRole("radio", { name: /Mitochondria/ }));
    expect(screen.queryByText(Q.correct)).not.toBeInTheDocument();
    // Number keys inside a question pick a choice.
    fireEvent.keyDown(within(byPrompt(TF.prompt)).getByRole("radio", { name: Q.trueLabel }), { key: "2" });
    expect(within(byPrompt(TF.prompt)).getByRole("radio", { name: Q.falseLabel })).toBeChecked();
    expect(screen.getByLabelText("2 of 3 answered")).toBeInTheDocument();

    // Submitting with an unanswered question asks first.
    await user.click(screen.getByRole("button", { name: Q.submit }));
    expect(screen.getByRole("alert")).toHaveTextContent(fmt(Q.unansweredWarning, { count: 1 }));
    await user.click(screen.getByRole("button", { name: Q.keepWorking }));
    await user.type(within(byPrompt(SHORT.prompt)).getByRole("textbox"), "water diffuses");
    await user.click(screen.getByRole("button", { name: Q.submit }));

    // Results: 1 of 3 so far, the written answer waits for a self-mark.
    expect(screen.getByText("1 of 3 correct")).toBeInTheDocument();
    expect(screen.getByText(fmt(Q.markPending, { count: 1 }))).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: Q.reviewTitle })).toBeInTheDocument();
    const review = screen.getAllByTestId("review-item");
    expect(review).toHaveLength(3);
    expect(screen.getByText("It makes ATP.")).toBeInTheDocument();
    // Saved at submission (closing the tab now loses nothing); the written
    // answer is not in the stats until it is marked.
    expect(quiz().attempts).toEqual([expect.objectContaining({ mode: "exam", score: 1, total: 3 })]);
    expect(question("m").stats).toMatchObject({ attempts: 1, correct: 1 });
    expect(question("s").stats).toBeUndefined();
    // Re-run on a newer document if the workspace changed meanwhile.
    expect(h.update).toHaveBeenLastCalledWith(expect.any(Function), expect.objectContaining({ rebase: "rerun" }));

    const shortItem = review.find((r) => within(r).queryByText(SHORT.prompt))!;
    await user.click(within(shortItem).getByRole("button", { name: new RegExp(Q.markRight) }));
    expect(screen.getByText("2 of 3 correct")).toBeInTheDocument();
    // The same attempt, updated (not a second one).
    expect(quiz().attempts).toEqual([expect.objectContaining({ mode: "exam", score: 2, total: 3 })]);
    expect(question("m").stats).toMatchObject({ attempts: 1, correct: 1 });
    expect(question("t").stats).toMatchObject({ attempts: 1, correct: 0 });
    expect(question("s").stats).toMatchObject({ attempts: 1, correct: 1 });

    await user.click(screen.getByRole("button", { name: "Re-drill 1 missed" }));
    expect(screen.getByTestId("practice-question")).toHaveTextContent(TF.prompt);
  });

  it("submits by itself when the time is up, counting blanks as missed", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    setQuiz([MCQ, TF]);
    render(<Harness />);
    await user.click(screen.getByRole("button", { name: Q.exam }));
    await user.click(screen.getByRole("radio", { name: "10 min" }));
    await user.click(screen.getByRole("button", { name: Q.startExam }));
    await user.click(screen.getAllByRole("radio", { name: /Mitochondria/ })[0]);
    await act(async () => {
      vi.advanceTimersByTime(10 * 60_000 + 2_000);
    });
    expect(screen.getByText(Q.timeUp)).toBeInTheDocument();
    expect(screen.getByText("1 of 2 correct")).toBeInTheDocument();
    expect(quiz().attempts).toEqual([expect.objectContaining({ mode: "exam", score: 1, total: 2 })]);
    expect(question("t").stats).toMatchObject({ attempts: 1, correct: 0 });
  });

  it("answers saved while another tab changed the quiz are re-run on the newer version, never counted twice", async () => {
    const user = userEvent.setup();
    setQuiz([MCQ, TF]);
    render(<Harness />);
    await user.click(screen.getByRole("button", { name: Q.exam }));
    await user.click(screen.getByRole("button", { name: Q.startExam }));
    await user.click(screen.getAllByRole("radio", { name: /Mitochondria/ })[0]);
    await user.click(screen.getAllByRole("radio", { name: Q.trueLabel })[0]);
    await user.click(screen.getByRole("button", { name: Q.submit }));
    const [mutator, options] = h.update.mock.calls.at(-1)!;
    // Re-run on a newer document, and described as data for recovery from a draft.
    expect(options).toMatchObject({ rebase: "rerun", replay: { name: "quizRun" } });

    // The engine replays the mutator on a newer document (another device
    // answered the MCQ once and the agent renamed the quiz) ...
    const newer = structuredClone(h.store.workspace);
    const q = (newer.pages[0].blocks[0] as QuizData);
    q.title = "Renamed by the agent";
    q.questions[0].stats = { attempts: 1, correct: 0, lastAnsweredAt: "2026-11-01T09:00:00.000Z" };
    q.attempts = [];
    mutator(newer);
    const merged = newer.pages[0].blocks[0] as QuizData;
    expect(merged.title).toBe("Renamed by the agent");
    expect(merged.questions[0].stats).toMatchObject({ attempts: 2, correct: 1 });
    expect(merged.attempts).toEqual([expect.objectContaining({ mode: "exam", score: 2, total: 2 })]);
    // ... and again on a document that already holds it (a lost save reply).
    mutator(newer);
    expect((newer.pages[0].blocks[0] as QuizData).questions[0].stats).toMatchObject({ attempts: 2, correct: 1 });
    expect((newer.pages[0].blocks[0] as QuizData).attempts).toHaveLength(1);
  });

  it("asks before leaving a running exam", async () => {
    const user = userEvent.setup();
    setQuiz([MCQ]);
    render(<Harness />);
    await user.click(screen.getByRole("button", { name: Q.exam }));
    await user.click(screen.getByRole("button", { name: Q.startExam }));
    expect(screen.queryByRole("timer")).not.toBeInTheDocument(); // "No timer" is the default
    await user.click(screen.getByRole("button", { name: Q.close }));
    expect(screen.getByRole("alertdialog", { name: Q.leaveExamQ })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: Q.stay }));
    expect(screen.getByRole("dialog", { name: "Cells" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: Q.close }));
    await user.click(screen.getByRole("button", { name: Q.leave }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(question("m").stats).toBeUndefined();
  });
});

describe("QuizBlock — authoring", () => {
  it("adds, edits, reorders and deletes questions; half-written ones are skipped", async () => {
    const user = userEvent.setup();
    setQuiz([]);
    render(<Harness />);
    expect(screen.queryByRole("button", { name: Q.practice })).not.toBeInTheDocument();

    // The empty quiz offers "Add question": a blank multiple-choice question.
    await user.click(screen.getByRole("button", { name: Q.addQuestion }));
    const first = screen.getByRole("listitem", { name: "Question 1" });
    expect(within(first).getByText(Q.issues.prompt)).toBeInTheDocument();
    // Text is written per typing burst: after a pause or on leaving the field.
    await user.type(within(first).getByRole("textbox", { name: /^Question \(Question 1\)/ }), "2 + 2 = ?");
    await user.tab();
    expect(within(first).getByText(Q.issues.choices)).toBeInTheDocument();
    await user.type(within(first).getByRole("textbox", { name: "Choice 1 (Question 1)" }), "3");
    await user.type(within(first).getByRole("textbox", { name: "Choice 2 (Question 1)" }), "4");
    await user.tab();
    expect(within(first).getByText(Q.issues.answer)).toBeInTheDocument();
    // Still saved as it is: half-written questions are allowed while editing.
    expect(question(quiz().questions[0].id).prompt).toBe("2 + 2 = ?");
    await user.click(within(first).getByRole("radio", { name: "Make choice 2 the correct answer (Question 1)" }));
    expect(within(first).queryByText(Q.issues.answer)).not.toBeInTheDocument();
    expect(quiz().questions[0]).toMatchObject({ choices: ["3", "4"], answerIndex: 1 });
    expect(screen.getByRole("button", { name: Q.practice })).toBeInTheDocument();

    // A third choice, then remove the first: the answer stays on "4".
    await user.click(within(first).getByRole("button", { name: Q.addChoice }));
    await user.type(within(first).getByRole("textbox", { name: "Choice 3 (Question 1)" }), "5");
    await user.click(within(first).getByRole("button", { name: "Remove choice 1 (Question 1)" }));
    expect(quiz().questions[0]).toMatchObject({ choices: ["4", "5"], answerIndex: 0 });

    // Add a true/false question and a short one.
    await user.click(screen.getByRole("button", { name: Q.kinds.true_false }));
    const second = screen.getByRole("listitem", { name: "Question 2" });
    await user.type(within(second).getByRole("textbox", { name: /^Question \(Question 2\)/ }), "The sky is green.");
    await user.click(within(second).getByRole("radio", { name: Q.falseLabel }));
    expect(quiz().questions[1]).toMatchObject({ kind: "true_false", answerBool: false });
    await user.click(screen.getByRole("button", { name: Q.kinds.short }));
    expect(screen.getByText(fmt(Q.incompleteSkipped, { count: 1 }))).toBeInTheDocument();
    expect(screen.getByText("2 questions")).toBeInTheDocument();

    // Change a question's type.
    await user.click(within(second).getByRole("radio", { name: /^Short answer/ }));
    expect(quiz().questions[1]).toMatchObject({ kind: "short", prompt: "The sky is green." });
    expect(quiz().questions[1].answerBool).toBeUndefined();

    // Reorder.
    await user.click(screen.getByRole("button", { name: "Move up (Question 2)" }));
    expect(quiz().questions.map((q) => q.prompt)).toEqual(["The sky is green.", "2 + 2 = ?", ""]);

    // Deleting a question with content asks first; an empty one goes at once.
    await user.click(screen.getByRole("button", { name: "Delete question (Question 1)" }));
    expect(screen.getByRole("alertdialog", { name: Q.confirmDelete })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: Q.keep }));
    expect(quiz().questions).toHaveLength(3);
    await user.click(screen.getByRole("button", { name: "Delete question (Question 1)" }));
    await user.click(screen.getByRole("button", { name: Q.confirmDeleteYes }));
    expect(quiz().questions.map((q) => q.prompt)).toEqual(["2 + 2 = ?", ""]);
    await user.click(screen.getByRole("button", { name: "Delete question (Question 2)" }));
    expect(quiz().questions.map((q) => q.prompt)).toEqual(["2 + 2 = ?"]);

    // Preview renders the question as students will see it.
    await user.click(screen.getByRole("button", { name: Q.preview }));
    expect(screen.getAllByTestId("rich").map((r) => r.textContent)).toEqual(["2 + 2 = ?", "4", "5"]);
  });
});

describe("QuizBlock — an exam left unfinished (QA round 3)", () => {
  beforeEach(() => {
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
  });

  it("says the exam is in progress and resumes it after the tab was closed", async () => {
    const user = userEvent.setup();
    setQuiz([MCQ, TF]);
    const first = render(<Harness />);
    expect(screen.getByText(Q.notTaken)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: Q.exam }));
    await user.click(screen.getByRole("button", { name: Q.startExam }));
    const questions = screen.getAllByTestId("exam-question");
    const mcq = questions.find((q) => within(q).queryByRole("radio", { name: /Mitochondria/ }))!;
    await user.click(within(mcq).getByRole("radio", { name: /Mitochondria/ }));
    // The tab closes mid-exam: nothing is submitted or left on purpose.
    first.unmount();

    render(<Harness />);
    expect(screen.queryByText(Q.notTaken)).not.toBeInTheDocument();
    expect(screen.getByText(Q.examInProgress)).toBeInTheDocument();
    expect(screen.getByTestId("quiz-exam-in-progress")).toHaveTextContent(
      fmt(Q.examInProgressAnswered, { answered: 1, total: 2 }),
    );
    await user.click(screen.getByRole("button", { name: Q.resumeExam }));
    expect(screen.getByText(en.safety.examResumed)).toBeInTheDocument();
    expect(screen.getByLabelText("1 of 2 answered")).toBeInTheDocument();

    // Submitted: the block no longer offers it back.
    await user.click(screen.getByRole("button", { name: Q.submit }));
    await user.click(screen.getByRole("button", { name: Q.submitAnyway }));
    expect(screen.queryByText(Q.examInProgress)).not.toBeInTheDocument();
  });
});
