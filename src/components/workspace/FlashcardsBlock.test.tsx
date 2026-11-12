import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Workspace, FlashcardsBlock as Deck, Flashcard } from "@/lib/workspace/types";
import { en } from "@/lib/i18n/dictionaries/en";
import { fmt } from "@/lib/i18n/interpolate";
import { pluralizer } from "@/lib/i18n/plural";
import { isoDay } from "@/lib/study/srs";
import { shiftDay } from "@/lib/study/days";

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

// A tiny store standing in for WorkspaceContext: `update` applies the mutator
// to a copy and re-renders subscribers, like the real editor.
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
// Streamdown needs browser layout APIs; render card text verbatim.
vi.mock("@/components/RichText", () => ({
  RichText: ({ text }: { text: string }) => <div data-testid="rich">{text}</div>,
}));

import { FlashcardsBlock } from "./FlashcardsBlock";
import { useWorkspace } from "./WorkspaceContext";

function Harness() {
  const { workspace } = useWorkspace();
  return <FlashcardsBlock pageId="p1" block={workspace.pages[0].blocks[0] as Deck} />;
}

function setDeck(cards: Flashcard[]) {
  h.store.workspace = {
    id: "w1",
    name: "WS",
    pages: [{ id: "p1", title: "P", blocks: [{ id: "deck1", type: "flashcards", title: "Bio", cards }] }],
    databases: [],
  };
}
const deck = () => h.store.workspace.pages[0].blocks[0] as Deck;
const T = en.studyTools;
const TODAY = isoDay(new Date());

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

describe("FlashcardsBlock — review session", () => {
  it("shows deck stats and a due count for new cards", () => {
    setDeck([
      { id: "c1", front: "ATP?", back: "energy" },
      { id: "c2", front: "DNA?", back: "genes" },
    ]);
    render(<Harness />);
    expect(screen.getByText("2 cards")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Study 2 due" })).toBeInTheDocument();
  });

  it("reviews a new card through its learning step, persists FSRS state and summarises", async () => {
    const user = userEvent.setup();
    setDeck([{ id: "c1", front: "ATP?", back: "the energy currency" }]);
    render(<Harness />);

    await user.click(screen.getByRole("button", { name: "Study 1 due" }));
    expect(screen.getByRole("dialog", { name: "Bio" })).toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: "Bio" })).toHaveAttribute("aria-valuenow", "0");
    expect(screen.getByText("ATP?")).toBeInTheDocument();
    expect(screen.queryByText("the energy currency")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Show answer/ }));
    expect(screen.getByText("the energy currency")).toBeInTheDocument();
    // Every grade shows the interval it would schedule.
    expect(screen.getByRole("button", { name: /Again\s*1m/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Good\s*10m/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Easy\s*\d+d/ })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Good/ }));
    let card = deck().cards[0];
    expect(card.state).toBe("learning");
    expect(card.reps).toBe(1);
    expect(card.stability).toBeGreaterThan(0);
    expect(card.dueAt).toBe(TODAY);
    // The first answer is recorded at once (it lights up the streak).
    expect(h.recordReviewsAction).toHaveBeenCalledTimes(1);
    expect(h.recordReviewsAction.mock.calls[0][0][0]).toMatchObject({
      workspaceId: "w1",
      localDate: TODAY,
      counts: { reviews: 1, good: 1, newCards: 1, practice: 0 },
    });

    // The learning step brings the card back in the same session.
    expect(screen.queryByText(en.study.doneTitle)).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Show answer/ }));
    await user.click(screen.getByRole("button", { name: /Good/ }));
    card = deck().cards[0];
    expect(card.state).toBe("review");
    expect(card.dueAt! > TODAY).toBe(true);

    expect(screen.getByText(en.study.doneTitle)).toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: "Bio" })).toHaveAttribute("aria-valuenow", "100");
    const reviewed = screen.getByText(T.summaryReviewed).parentElement!;
    expect(within(reviewed).getByText("1")).toBeInTheDocument();
    expect(screen.getByText(new RegExp(`${T.dueTomorrow}|In \\d+ days`))).toBeInTheDocument();
  });

  it("supports the keyboard: Space flips, 1-4 grade", async () => {
    const user = userEvent.setup();
    setDeck([{ id: "c1", front: "Q", back: "A" }]);
    render(<Harness />);
    await user.click(screen.getByRole("button", { name: "Study 1 due" }));
    await user.keyboard(" ");
    expect(screen.getByText("A")).toBeInTheDocument();
    await user.keyboard("4"); // easy: graduates at once
    expect(deck().cards[0].state).toBe("review");
    expect(screen.getByText(en.study.doneTitle)).toBeInTheDocument();
  });

  it("closes the review session with Escape", async () => {
    const user = userEvent.setup();
    setDeck([{ id: "c1", front: "Q", back: "A" }]);
    render(<Harness />);
    await user.click(screen.getByRole("button", { name: "Study 1 due" }));
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "Bio" })).not.toBeInTheDocument();
  });

  it("skips blank cards", async () => {
    const user = userEvent.setup();
    setDeck([
      { id: "c1", front: "Q", back: "A" },
      { id: "blank", front: "half-written", back: "" },
    ]);
    render(<Harness />);
    await user.click(screen.getByRole("button", { name: "Study 1 due" }));
    expect(screen.getByText("1 / 1")).toBeInTheDocument();
    expect(screen.queryByText("half-written")).not.toBeInTheDocument();
  });

  it("migrates an SM-2 card on review without resetting its progress", async () => {
    const user = userEvent.setup();
    setDeck([
      { id: "c1", front: "Q", back: "A", ease: 2.5, reps: 5, intervalDays: 40, dueAt: TODAY, lastReviewedAt: new Date(Date.now() - 40 * 86_400_000).toISOString() },
    ]);
    render(<Harness />);
    await user.click(screen.getByRole("button", { name: "Study 1 due" }));
    await user.click(screen.getByRole("button", { name: /Show answer/ }));
    await user.click(screen.getByRole("button", { name: /Good/ }));
    const card = deck().cards[0];
    expect(card.state).toBe("review");
    expect(card.intervalDays!).toBeGreaterThan(40);
  });
});

describe("FlashcardsBlock — practice (cram) mode", () => {
  const notDue: Flashcard[] = [
    { id: "c1", front: "Q1", back: "A1", state: "review", stability: 30, difficulty: 5, reps: 3, intervalDays: 30, dueAt: shiftDay(TODAY, 20), lastReviewedAt: new Date().toISOString() },
    { id: "c2", front: "Q2", back: "A2", state: "review", stability: 30, difficulty: 5, reps: 3, intervalDays: 30, dueAt: shiftDay(TODAY, 25), lastReviewedAt: new Date().toISOString() },
  ];

  it("lets the student study when nothing is due, without touching the schedule", async () => {
    const user = userEvent.setup();
    setDeck(structuredClone(notDue));
    render(<Harness />);
    expect(screen.queryByRole("button", { name: /Study \d+ due/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: T.practice }));
    expect(screen.getAllByText(T.practiceBanner).length).toBeGreaterThan(0);

    // Grade buttons show no intervals in practice.
    await user.click(screen.getByRole("button", { name: /Show answer/ }));
    expect(screen.getByRole("button", { name: /Good/ }).textContent).not.toMatch(/\d+d/);

    // "Again" brings the card back at the end of the practice round.
    await user.click(screen.getByRole("button", { name: /Again/ }));
    await user.click(screen.getByRole("button", { name: /Show answer/ }));
    await user.click(screen.getByRole("button", { name: /Hard/ }));
    await user.click(screen.getByRole("button", { name: /Show answer/ }));
    await user.click(screen.getByRole("button", { name: /Good/ }));

    expect(screen.getByText(en.study.doneTitle)).toBeInTheDocument();
    expect(screen.getByText(T.scheduleUnchanged)).toBeInTheDocument();
    const hard = screen.getByText(T.summaryHard).parentElement!;
    expect(within(hard).getByText("2")).toBeInTheDocument();
    // The schedule is exactly as before.
    expect(h.update).not.toHaveBeenCalled();
    expect(deck().cards).toEqual(notDue);
    // Practice is recorded for the streak, separately from reviews.
    expect(h.recordReviewsAction.mock.calls[0][0][0].counts).toMatchObject({ practice: 1, reviews: 0 });
  });
});

describe("FlashcardsBlock — editing", () => {
  it("adds a card and focuses its front, edits multi-line text, reorders and deletes", async () => {
    const user = userEvent.setup();
    setDeck([{ id: "c1", front: "Q", back: "A" }]);
    render(<Harness />);
    await user.click(screen.getByRole("button", { name: en.study.editCards }));
    await user.click(screen.getByRole("button", { name: T.addCard }));
    expect(deck().cards).toHaveLength(2);
    const front2 = screen.getByRole("textbox", { name: "Front (Card 2)" });
    expect(front2).toHaveFocus();
    await user.type(front2, "Line one{Enter}line two");
    // Typing is one write per burst (after a pause or on leaving the field),
    // not one per key.
    expect(front2).toHaveValue("Line one\nline two");
    expect(deck().cards[1].front).toBe("");
    await user.tab();
    expect(deck().cards[1].front).toBe("Line one\nline two");

    await user.click(screen.getByRole("button", { name: "Move up (Card 2)" }));
    expect(deck().cards.map((c) => c.front)).toEqual(["Line one\nline two", "Q"]);
    expect(screen.getByRole("button", { name: "Move up (Card 1)" })).toBeDisabled();

    await user.click(screen.getByRole("button", { name: `${en.study.deleteCard} (Card 1)` }));
    expect(deck().cards.map((c) => c.id)).toEqual(["c1"]);
  });

  it("previews Markdown and math as rendered card content", async () => {
    const user = userEvent.setup();
    setDeck([{ id: "c1", front: "**Area**", back: "$\\pi r^2$" }]);
    render(<Harness />);
    await user.click(screen.getByRole("button", { name: en.study.editCards }));
    await user.click(screen.getByRole("button", { name: T.preview }));
    expect(screen.getAllByTestId("rich").map((n) => n.textContent)).toEqual(["**Area**", "$\\pi r^2$"]);
  });
});

describe("FlashcardsBlock — import and export", () => {
  it("previews pasted Quizlet text, skips duplicates and imports the rest", async () => {
    const user = userEvent.setup();
    setDeck([{ id: "c1", front: "ATP", back: "energy" }]);
    render(<Harness />);
    await user.click(screen.getByRole("button", { name: T.importExport }));
    await user.click(screen.getByRole("button", { name: T.importCards }));
    const dialog = screen.getByRole("dialog", { name: T.importTitle });
    const box = within(dialog).getByRole("textbox", { name: T.pasteLabel });
    await user.click(box);
    await user.paste("Term\tDefinition\natp\tdupe\nDNA\tgenes\n\nRNA\tmessenger");
    expect(within(dialog).getByText(T.headerSkipped)).toBeInTheDocument();
    expect(within(dialog).getByText(T.status.duplicate)).toBeInTheDocument();
    expect(within(dialog).getAllByText(T.status.new)).toHaveLength(2);
    await user.click(within(dialog).getByRole("button", { name: "Import 2 cards" }));
    expect(deck().cards.map((c) => c.front)).toEqual(["ATP", "DNA", "RNA"]);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Imported 2 cards");
  });

  it("imports an uploaded CSV with quoted fields, and explains .apkg files", async () => {
    // A student can still pick "All files" in the browser's file dialog.
    const user = userEvent.setup({ applyAccept: false });
    setDeck([]);
    render(<Harness />);
    await user.click(screen.getByRole("button", { name: T.importExport }));
    await user.click(screen.getByRole("button", { name: T.importCards }));
    const dialog = screen.getByRole("dialog", { name: T.importTitle });
    const input = within(dialog).getByLabelText(T.uploadFile, { selector: "input" });

    await user.upload(input, new File(["x"], "deck.apkg"));
    expect(within(dialog).getByRole("alert")).toHaveTextContent(T.apkgNote);

    const csv = 'front,back\n"Newton\'s 2nd law","F = ma, where ""a"" is acceleration"\n"Multi\nline",answer\n';
    await user.upload(input, new File([csv], "deck.csv", { type: "text/csv" }));
    await user.click(await within(dialog).findByRole("button", { name: "Import 2 cards" }));
    expect(deck().cards.map((c) => [c.front, c.back])).toEqual([
      ["Newton's 2nd law", 'F = ma, where "a" is acceleration'],
      ["Multi\nline", "answer"],
    ]);
  });

  it("downloads an Anki-ready file", async () => {
    const user = userEvent.setup();
    let blob: Blob | null = null;
    const create = vi.fn((b: Blob) => {
      blob = b;
      return "blob:x";
    });
    Object.assign(URL, { createObjectURL: create, revokeObjectURL: vi.fn() });
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    setDeck([{ id: "c1", front: "Q", back: "A" }]);
    render(<Harness />);
    await user.click(screen.getByRole("button", { name: T.importExport }));
    await user.click(screen.getByRole("button", { name: T.exportAnki }));
    expect(click).toHaveBeenCalled();
    expect(await blob!.text()).toBe("#separator:tab\n#html:true\n#columns:Front\tBack\nQ\tA\n");
    expect(screen.getByRole("status")).toHaveTextContent("Bio-anki.txt");
  });
});

describe("FlashcardsBlock — welcome back", () => {
  it("offers to spread a big overdue pile and keeps today to a daily load", async () => {
    const user = userEvent.setup();
    const overdue: Flashcard[] = Array.from({ length: 80 }, (_, i) => ({
      id: `c${i}`,
      front: `Q${i}`,
      back: "A",
      state: "review",
      stability: 5 + i,
      difficulty: 5,
      reps: 3,
      intervalDays: 5,
      dueAt: shiftDay(TODAY, -12),
      lastReviewedAt: new Date(Date.now() - 17 * 86_400_000).toISOString(),
    }));
    setDeck(overdue);
    render(<Harness />);
    expect(screen.getByRole("region", { name: T.welcomeTitle })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: T.spreadOut }));
    const dueToday = deck().cards.filter((c) => c.dueAt! <= TODAY);
    expect(dueToday).toHaveLength(50);
    // Memory state is untouched; only due days moved.
    expect(deck().cards.every((c) => c.intervalDays === 5 && c.reps === 3)).toBe(true);
    expect(screen.queryByRole("region", { name: T.welcomeTitle })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Study 50 due" })).toBeInTheDocument();
  });
});
