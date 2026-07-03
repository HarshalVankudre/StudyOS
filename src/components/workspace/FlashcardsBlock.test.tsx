import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Workspace, FlashcardsBlock as Deck } from "@/lib/workspace/types";

const h = vi.hoisted(() => ({
  recordStudyReviewAction: vi.fn().mockResolvedValue(undefined),
  update: vi.fn(),
}));
const recordStudyReviewAction = h.recordStudyReviewAction;
const update = h.update;
vi.mock("@/app/app/study-actions", () => ({
  recordStudyReviewAction: h.recordStudyReviewAction,
}));

// A mutable workspace the mocked context mutates via `update`, so assertions
// can inspect the SM-2 scheduling the review wrote back.
let workspace: Workspace;
vi.mock("./WorkspaceContext", () => ({
  useWorkspace: () => ({ workspace, update: h.update }),
}));

const dict = {
  common: { cancel: "Cancel" },
  study: {
    untitledDeck: "Flashcards",
    deckTitlePlaceholder: "Deck title…",
    stats: { cards: "{count} cards", due: "{count} due", mature: "{count} learned" },
    studyDue: "Study {count} due",
    allCaughtUp: "All caught up",
    editCards: "Edit cards",
    doneEditing: "Done",
    addCard: "+ Add card",
    deleteCard: "Delete card",
    emptyDeck: "No cards yet.",
    frontPlaceholder: "Front",
    backPlaceholder: "Back",
    showAnswer: "Show answer",
    tapToReveal: "Tap to reveal",
    spaceKey: "Space",
    grades: { again: "Again", hard: "Hard", good: "Good", easy: "Easy" },
    doneTitle: "Session complete",
    doneSummary: "You reviewed {count} cards.",
    doneAgain: "{count} need another look soon.",
    finish: "Done",
  },
};
vi.mock("@/lib/i18n/client", () => ({
  useI18n: () => ({
    dict,
    t: (s: string, vars: Record<string, unknown>) =>
      s.replace(/\{(\w+)\}/g, (_, k) => String(vars[k])),
  }),
}));

import { FlashcardsBlock } from "./FlashcardsBlock";

function deckWith(cards: Deck["cards"]): Deck {
  return { id: "deck1", type: "flashcards", title: "Bio", cards };
}
function withWorkspace(block: Deck) {
  workspace = {
    id: "w1",
    name: "WS",
    pages: [{ id: "p1", title: "P", blocks: [block] }],
    databases: [],
  };
  return block;
}

beforeEach(() => {
  update.mockReset();
  update.mockImplementation((mutator: (d: Workspace) => void) => mutator(workspace));
  recordStudyReviewAction.mockClear();
});

describe("FlashcardsBlock", () => {
  it("shows deck stats and a due count for new cards", () => {
    const block = withWorkspace(
      deckWith([
        { id: "c1", front: "ATP?", back: "energy" },
        { id: "c2", front: "DNA?", back: "genes" },
      ]),
    );
    render(<FlashcardsBlock pageId="p1" block={block} />);
    expect(screen.getByText("2 cards")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Study 2 due" })).toBeInTheDocument();
  });

  it("runs a review: flip, grade Good, and persist SM-2 state", async () => {
    const user = userEvent.setup();
    const block = withWorkspace(
      deckWith([{ id: "c1", front: "ATP?", back: "the energy currency" }]),
    );
    render(<FlashcardsBlock pageId="p1" block={block} />);

    await user.click(screen.getByRole("button", { name: "Study 1 due" }));
    // Front shown, answer hidden.
    expect(screen.getByText("ATP?")).toBeInTheDocument();
    expect(screen.queryByText("the energy currency")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Show answer/ }));
    expect(screen.getByText("the energy currency")).toBeInTheDocument();

    // Recorded the review once (streak).
    // Grade Good → schedules the card and advances the session.
    const grade = screen.getByRole("button", { name: /Good/ });
    await user.click(grade);

    expect(recordStudyReviewAction).toHaveBeenCalledTimes(1);
    const card = workspace.pages[0].blocks[0] as Deck;
    expect(card.cards[0].reps).toBe(1);
    expect(card.cards[0].dueAt).toBeTruthy();
    expect(screen.getByText("Session complete")).toBeInTheDocument();
  });

  it("keeps the session mounted through completion after the last card leaves the due queue", async () => {
    // Regression: the render guard used to be `studying && items.length > 0`,
    // which unmounted the session the moment the last card was graded (items
    // recomputes to empty), so the "Session complete" screen never showed.
    const user = userEvent.setup();
    const block = withWorkspace(deckWith([{ id: "c1", front: "Q", back: "A" }]));
    const { rerender } = render(<FlashcardsBlock pageId="p1" block={block} />);
    await user.click(screen.getByRole("button", { name: "Study 1 due" }));
    await user.click(screen.getByRole("button", { name: /Show answer/ }));
    await user.click(screen.getByRole("button", { name: /Good/ }));
    // Grading scheduled the card into the future; reflect the parent re-render
    // that production performs (the deck now has 0 due cards).
    rerender(
      <FlashcardsBlock pageId="p1" block={workspace.pages[0].blocks[0] as Deck} />,
    );
    expect(screen.getByText("Session complete")).toBeInTheDocument();
  });

  it("disables study when nothing is due", () => {
    const future = "2999-01-01";
    const block = withWorkspace(
      deckWith([
        { id: "c1", front: "Q", back: "A", reps: 3, intervalDays: 30, dueAt: future },
      ]),
    );
    render(<FlashcardsBlock pageId="p1" block={block} />);
    expect(screen.getByRole("button", { name: "All caught up" })).toBeDisabled();
  });

  it("adds a card through the editor", async () => {
    const user = userEvent.setup();
    const block = withWorkspace(deckWith([{ id: "c1", front: "Q", back: "A" }]));
    render(<FlashcardsBlock pageId="p1" block={block} />);
    await user.click(screen.getByRole("button", { name: "Edit cards" }));
    await user.click(screen.getByRole("button", { name: "+ Add card" }));
    const deck = workspace.pages[0].blocks[0] as Deck;
    expect(deck.cards).toHaveLength(2);
  });
});
