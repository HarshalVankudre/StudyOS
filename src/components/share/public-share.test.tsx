import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { en } from "@/lib/i18n/dictionaries/en";
import { toPublicPage } from "@/lib/share/public-view";
import { sharedPage, sharedWorkspace, TOKEN } from "@/lib/share/share-fixture";

const m = vi.hoisted(() => ({ save: vi.fn(), report: vi.fn(), push: vi.fn() }));

// Markdown rendering is covered by rehype-share.test.tsx; here it is plain text.
vi.mock("./ShareRichText", () => ({
  ShareRichText: ({ text }: { text: string }) => <span>{text}</span>,
  ShareOriginsProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock("@/app/s/actions", () => ({ saveSharedCopyAction: m.save, reportShareAction: m.report }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: m.push }) }));
vi.mock("@/lib/i18n/client", async () => {
  const { en } = await import("@/lib/i18n/dictionaries/en");
  const { fmt } = await import("@/lib/i18n/interpolate");
  const { pluralizer } = await import("@/lib/i18n/plural");
  return { useI18n: () => ({ dict: en, t: fmt, plural: pluralizer("en"), dir: "ltr", locale: "en" }) };
});

import { PublicBlocks } from "./PublicBlocks";
import { PublicFlashcards, shuffledOrder } from "./PublicFlashcards";
import { PublicQuiz } from "./PublicQuiz";
import { ReportShareButton } from "./ReportShareButton";
import { returnToSave, SaveCopyCard } from "./SaveCopyCard";

const S = en.share;
const Q = en.quiz;
const fetchSpy = vi.fn();

beforeEach(() => {
  m.save.mockReset();
  m.report.mockReset();
  m.push.mockReset();
  fetchSpy.mockReset();
  vi.stubGlobal("fetch", fetchSpy);
});
afterEach(() => vi.unstubAllGlobals());

const cards = [
  { front: "What is a cell?", back: "The unit of life" },
  { front: "Powerhouse?", back: "Mitochondria" },
  { front: "DNA lives in?", back: "The nucleus" },
];

describe("flashcards on a shared page", () => {
  it("flip, go back and forth, and record nothing", async () => {
    const user = userEvent.setup();
    render(<PublicFlashcards title="Cells" cards={cards} token={TOKEN} />);
    expect(screen.getByText("What is a cell?")).toBeInTheDocument();
    expect(screen.getByRole("group", { name: /Card 1 of 3/ })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: S.showAnswer }));
    expect(screen.getByText("The unit of life")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: S.showQuestion })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: S.next }));
    expect(screen.getByText("Powerhouse?")).toBeInTheDocument();
    expect(screen.getAllByText("Card 2 of 3").length).toBeGreaterThan(0);
    await user.click(screen.getByRole("button", { name: S.previous }));
    expect(screen.getByText("What is a cell?")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: S.previous })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: S.shuffle }));
    expect(screen.getAllByText("Card 1 of 3").length).toBeGreaterThan(0);
    expect(screen.getByText(S.practiceNote)).toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("never put a card's rich content inside a button", () => {
    const { container } = render(<PublicFlashcards cards={cards} token={TOKEN} />);
    expect(container.querySelector("button span")?.textContent ?? "").not.toContain("What is a cell?");
    for (const button of container.querySelectorAll("button")) {
      expect(button.textContent).not.toContain("What is a cell?");
    }
  });

  it("shuffle into a new order holding every card", () => {
    let seed = 0.42;
    const random = () => {
      seed = (seed * 9301 + 49297) % 233280 / 233280;
      return seed;
    };
    const order = shuffledOrder(5, [0, 1, 2, 3, 4], random);
    expect([...order].sort()).toEqual([0, 1, 2, 3, 4]);
    expect(order).not.toEqual([0, 1, 2, 3, 4]);
    expect(shuffledOrder(1, [0])).toEqual([0]);
  });
});

describe("a quiz on a shared page", () => {
  const questions = toPublicPage(sharedPage(), sharedWorkspace(), { token: TOKEN, today: "2026-11-13" }).blocks.find(
    (b) => b.type === "quiz",
  );
  if (questions?.type !== "quiz") throw new Error("fixture has a quiz");

  it("is practised one question at a time with a score at the end, recording nothing", async () => {
    const user = userEvent.setup();
    render(<PublicQuiz title="Check" questions={questions.questions} token={TOKEN} />);

    // Multiple choice: a wrong answer shows the right one and the explanation.
    await user.click(screen.getByRole("button", { name: /3/ }));
    expect(screen.getByText(Q.incorrect)).toBeInTheDocument();
    expect(screen.getByText("math")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: Q.next }));

    // True / false.
    await user.click(screen.getByRole("button", { name: new RegExp(Q.trueLabel) }));
    expect(screen.getByText(Q.correct)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: Q.next }));

    // Written answer: compare with the model answer, then mark it.
    await user.type(screen.getByRole("textbox", { name: Q.typeAnswer }), "smallest living unit");
    await user.click(screen.getByRole("button", { name: Q.showModelAnswer }));
    expect(screen.getByText("Unit of life")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: Q.markRight }));
    await user.click(screen.getByRole("button", { name: Q.seeResults }));

    expect(screen.getByText("2 of 3 right")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: S.startOver }));
    expect(screen.getByText("Question 1 of 3")).toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("keeps a choice's rich text beside its button, named by it, and picks it from the text too", async () => {
    const user = userEvent.setup();
    const { container } = render(<PublicQuiz questions={questions.questions} token={TOKEN} />);
    const choice = screen.getByRole("button", { name: "4" });
    // The button holds only its marker; the choice's Markdown is a sibling.
    expect(choice.textContent).toBe("2");
    for (const button of container.querySelectorAll("button")) expect(button.textContent).not.toContain("4");
    await user.click(screen.getByText("4"));
    expect(screen.getByText(Q.correct)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "4" })).toBeDisabled();
  });
});

describe("the blocks of a shared page", () => {
  const view = toPublicPage(sharedPage(), sharedWorkspace(), { token: TOKEN, today: "2026-11-13" });

  it("render text, lists, a table, an image through the share route and a neutral placeholder", () => {
    const { container } = render(<PublicBlocks blocks={view.blocks} token={TOKEN} />);
    expect(screen.getByRole("heading", { name: "Overview", level: 2 })).toBeInTheDocument();
    const lists = container.querySelectorAll("ol, ul");
    expect(lists.length).toBeGreaterThanOrEqual(2);
    expect(screen.getByRole("checkbox", { name: "done thing" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "done thing" })).toBeDisabled();
    const table = screen.getByRole("table");
    expect(within(table).getAllByRole("columnheader").map((th) => th.textContent)).toEqual(["Title", "Status", "Course"]);
    expect(within(table).getByText("Lab report")).toBeInTheDocument();
    expect(container.querySelector("img")?.getAttribute("src")).toBe(`/s/${TOKEN}/asset/asset_block`);
    expect(screen.getByText(S.hiddenComponent)).toBeInTheDocument();
    expect(container.textContent).not.toContain("My GPA");
  });

  it("say so when the page is empty", () => {
    render(<PublicBlocks blocks={[]} token={TOKEN} />);
    expect(screen.getByText(S.empty)).toBeInTheDocument();
  });
});

describe("Save a copy", () => {
  it("leads a signed-out visitor to sign up and back to this page", () => {
    render(<SaveCopyCard token={TOKEN} signedIn={false} returning={false} />);
    const back = encodeURIComponent(returnToSave(TOKEN));
    expect(screen.getByRole("link", { name: S.save.signUp })).toHaveAttribute("href", `/sign-up?redirect_url=${back}`);
    expect(screen.getByRole("link", { name: S.save.signIn })).toHaveAttribute("href", `/sign-in?redirect_url=${back}`);
    expect(returnToSave(TOKEN)).toBe(`/s/${TOKEN}?save=1`);
  });

  it("copies the page for a signed-in visitor and opens the new workspace", async () => {
    const user = userEvent.setup();
    m.save.mockResolvedValue({ ok: true, workspaceId: "ws_new" });
    render(<SaveCopyCard token={TOKEN} signedIn returning />);
    expect(screen.getByText(S.save.welcomeBack)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: S.save.button }));
    expect(m.save).toHaveBeenCalledWith(TOKEN);
    expect(m.push).toHaveBeenCalledWith("/app/ws_new");
  });

  it("explains a refusal", async () => {
    const user = userEvent.setup();
    m.save.mockResolvedValue({ ok: false, error: "limit" });
    render(<SaveCopyCard token={TOKEN} signedIn returning={false} />);
    await user.click(screen.getByRole("button", { name: S.save.button }));
    expect(await screen.findByRole("alert")).toHaveTextContent(S.save.errors.limit);
    expect(m.push).not.toHaveBeenCalled();
  });
});

describe("Report this page", () => {
  it("needs a reason, then sends it with the optional message", async () => {
    const user = userEvent.setup();
    m.report.mockResolvedValue({ ok: true });
    render(<ReportShareButton token={TOKEN} />);
    await user.click(screen.getByRole("button", { name: S.report.link }));
    await user.click(screen.getByRole("button", { name: S.report.send }));
    expect(m.report).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("Pick a reason");
    await user.click(screen.getByRole("radio", { name: S.report.reasons.copyright }));
    await user.type(screen.getByRole("textbox", { name: S.report.messageLabel }), "These are my slides");
    await user.click(screen.getByRole("button", { name: S.report.send }));
    expect(m.report).toHaveBeenCalledWith({ token: TOKEN, reason: "copyright", message: "These are my slides" });
    expect(await screen.findByText(S.report.thanksTitle)).toBeInTheDocument();
  });

  it("says when there were too many reports", async () => {
    const user = userEvent.setup();
    m.report.mockResolvedValue({ ok: false, error: "rate_limited" });
    render(<ReportShareButton token={TOKEN} />);
    await user.click(screen.getByRole("button", { name: S.report.link }));
    await user.click(screen.getByRole("radio", { name: S.report.reasons.spam }));
    await user.click(screen.getByRole("button", { name: S.report.send }));
    expect(await screen.findByRole("alert")).toHaveTextContent(S.report.errors.rateLimited);
  });
});
