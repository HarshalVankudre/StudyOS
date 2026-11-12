import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Flashcard, Workspace } from "@/lib/workspace/types";
import { en } from "@/lib/i18n/dictionaries/en";
import { fmt } from "@/lib/i18n/interpolate";
import { pluralizer } from "@/lib/i18n/plural";

const h = vi.hoisted(() => ({
  ctx: {
    workspace: null as unknown as Workspace,
    status: "saved" as string,
    retrySave: vi.fn(),
  },
}));
vi.mock("./WorkspaceContext", () => ({ useWorkspace: () => h.ctx }));
vi.mock("@/lib/i18n/client", () => ({
  useI18n: () => ({ dict: en, t: fmt, plural: pluralizer("en"), locale: "en", dir: "ltr" }),
}));
vi.mock("@/components/RichText", () => ({
  RichText: ({ text }: { text: string }) => <div>{text}</div>,
}));

import { StudySession, type ReviewItem } from "./StudySession";

function workspaceWith(card: Flashcard): Workspace {
  return {
    id: "w1",
    name: "W",
    pages: [{ id: "p1", title: "P", blocks: [{ id: "deck", type: "flashcards", cards: [card] }] }],
    databases: [],
  };
}

const sessionCard: Flashcard = { id: "c1", front: "Front at start", back: "Back" };

beforeEach(() => {
  h.ctx.status = "saved";
  h.ctx.retrySave.mockReset();
  h.ctx.workspace = workspaceWith(sessionCard);
});

const items = (): ReviewItem[] => [{ pageId: "p1", blockId: "deck", card: sessionCard }];

describe("StudySession and the workspace (finding 11)", () => {
  it("shows a save problem inside the full-screen session, with Retry", async () => {
    const user = userEvent.setup();
    h.ctx.status = "error";
    render(<StudySession items={items()} title="Deck" onClose={() => {}} />);
    expect(screen.getByRole("alert")).toHaveTextContent(en.safety.sessionNotSaving);
    await user.click(screen.getByRole("button", { name: en.safety.retry }));
    expect(h.ctx.retrySave).toHaveBeenCalled();
  });

  it("shows nothing extra while saving works", () => {
    render(<StudySession items={items()} title="Deck" onClose={() => {}} />);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("shows and grades the card as it is now, not as it was when the session started", async () => {
    const user = userEvent.setup();
    // Meanwhile (another device, the AI agent) the card was edited and reviewed.
    h.ctx.workspace = workspaceWith({
      ...sessionCard,
      front: "Front edited elsewhere",
      state: "review",
      stability: 10,
      difficulty: 5,
      reps: 4,
      intervalDays: 10,
      dueAt: "2026-01-01",
      lastReviewedAt: "2025-12-22T10:00:00.000Z",
    });
    const onGrade = vi.fn();
    render(<StudySession items={items()} title="Deck" onGrade={onGrade} onClose={() => {}} />);
    expect(screen.getByText("Front edited elsewhere")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: new RegExp(en.study.showAnswer) }));
    await user.click(screen.getByRole("button", { name: new RegExp(en.study.grades.good) }));
    const [item, grade, next, at] = onGrade.mock.calls[0];
    expect(item.card.id).toBe("c1");
    expect(grade).toBe("good");
    expect(next.reps).toBe(5); // built on the live card's 4 reviews
    expect(at).toBeInstanceOf(Date);
  });
});

describe("StudySession progress (QA round 2: stuck at 1 / 18)", () => {
  it("moves the counter and the bar with every new card graded, even when the cards come back", async () => {
    const user = userEvent.setup();
    const cards: Flashcard[] = [1, 2, 3].map((n) => ({ id: `n${n}`, front: `Front ${n}`, back: `Back ${n}` }));
    h.ctx.workspace = {
      id: "w1",
      name: "W",
      pages: [{ id: "p1", title: "P", blocks: [{ id: "deck", type: "flashcards", cards }] }],
      databases: [],
    };
    const queue: ReviewItem[] = cards.map((card) => ({ pageId: "p1", blockId: "deck", card }));
    render(<StudySession items={queue} title="Deck" onGrade={() => {}} onClose={() => {}} />);
    const counter = () => screen.getByTestId("session-counter").textContent;
    const bar = () => Number(screen.getByRole("progressbar").getAttribute("aria-valuenow"));
    expect(counter()).toBe("1 / 3");
    expect(bar()).toBe(0);

    for (const expected of ["2 / 3", "3 / 3"]) {
      const before = bar();
      await user.click(screen.getByRole("button", { name: new RegExp(en.study.showAnswer) }));
      await user.click(screen.getByRole("button", { name: new RegExp(en.study.grades.good) }));
      expect(counter()).toBe(expected);
      expect(bar()).toBeGreaterThan(before);
    }
    // All three seen; a new card graded Good comes back for a learning step.
    await user.click(screen.getByRole("button", { name: new RegExp(en.study.showAnswer) }));
    await user.click(screen.getByRole("button", { name: new RegExp(en.study.grades.good) }));
    expect(counter()).toBe("3 / 3");
    expect(screen.getByText(en.studyTools.repeatCard)).toBeInTheDocument();
  });
});
