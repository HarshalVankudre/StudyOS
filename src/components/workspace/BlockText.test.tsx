import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

// RichText pulls in Streamdown; render it as a passthrough so the typeset
// text is directly assertable and no browser layout APIs are needed.
vi.mock("streamdown", () => ({
  Streamdown: ({ children }: { children: string }) => <div data-testid="md">{children}</div>,
}));
vi.mock("@/lib/streamdown-plugins", () => ({ streamdownPlugins: {}, streamdownRehypePlugins: [] }));

import { BlockText } from "./BlockText";
import { COMMIT_DELAY_MS } from "./editor/useCommittedDraft";

const box = () => screen.getByRole("textbox") as HTMLTextAreaElement;

afterEach(() => {
  vi.useRealTimers();
});

describe("BlockText", () => {
  it("typesets Markdown and math at rest, through the shared renderer", () => {
    render(<BlockText value="**bold** and $x^2$" onCommit={vi.fn()} label="Text" />);
    expect(screen.getByTestId("md")).toHaveTextContent("**bold** and $x^2$");
  });

  it("skips the Markdown pipeline for plain text but keeps its line breaks", () => {
    const { container } = render(<BlockText value={"line one\nline two"} onCommit={vi.fn()} />);
    expect(screen.queryByTestId("md")).not.toBeInTheDocument();
    expect(container.querySelector(".whitespace-pre-line")?.textContent).toBe("line one\nline two");
  });

  it("edits the raw source in a textarea, and shows the placeholder when empty", async () => {
    const user = userEvent.setup();
    render(<BlockText value="" onCommit={vi.fn()} placeholder="Type here" label="Text" />);
    const el = box();
    expect(el.tagName).toBe("TEXTAREA");
    expect(el).toHaveAttribute("placeholder", "Type here");
    await user.click(el);
    expect(el).toHaveFocus();
  });

  it("keeps multi-line text through an edit round trip (Shift+Enter)", async () => {
    const user = userEvent.setup();
    const onCommit = vi.fn();
    render(<BlockText value={"first\nsecond"} onCommit={onCommit} onEnter={() => null} />);
    const el = box();
    await user.click(el);
    expect(el.value).toBe("first\nsecond");
    el.setSelectionRange(el.value.length, el.value.length);
    await user.keyboard("{Shift>}{Enter}{/Shift}third");
    await user.tab();
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith("first\nsecond\nthird");
  });

  it("commits once per typing burst (after a pause), not per keystroke", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const onCommit = vi.fn();
    render(<BlockText value="" onCommit={onCommit} />);
    await user.click(box());
    await user.keyboard("hello");
    expect(onCommit).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(COMMIT_DELAY_MS + 50);
    });
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith("hello");
    // Nothing new to save on blur.
    await user.tab();
    expect(onCommit).toHaveBeenCalledTimes(1);
  });

  it("does not commit when focus leaves without a change", async () => {
    const user = userEvent.setup();
    const onCommit = vi.fn();
    render(<BlockText value="hello" onCommit={onCommit} />);
    await user.click(box());
    await user.tab();
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("saves typing that is still pending when the block unmounts", async () => {
    const user = userEvent.setup();
    const onCommit = vi.fn();
    const { unmount } = render(<BlockText value="" onCommit={onCommit} />);
    await user.click(box());
    await user.keyboard("draft");
    unmount();
    expect(onCommit).toHaveBeenCalledWith("draft");
  });

  it("splits at the caret on Enter and keeps what the parent stored", async () => {
    const user = userEvent.setup();
    const onEnter = vi.fn(() => "ab");
    const onCommit = vi.fn();
    render(<BlockText value="abcd" onCommit={onCommit} onEnter={onEnter} />);
    const el = box();
    await user.click(el);
    el.setSelectionRange(2, 2);
    await user.keyboard("{Enter}");
    expect(onEnter).toHaveBeenCalledWith("ab", "cd");
    expect(el.value).toBe("ab");
    await user.tab();
    // The parent already stored "ab" as part of the split.
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("reports Backspace at the start and Delete at the end", async () => {
    const user = userEvent.setup();
    const onBackspaceAtStart = vi.fn(() => true);
    const onDeleteAtEnd = vi.fn(() => true);
    render(
      <BlockText
        value="xy"
        onCommit={vi.fn()}
        onBackspaceAtStart={onBackspaceAtStart}
        onDeleteAtEnd={onDeleteAtEnd}
      />,
    );
    const el = box();
    await user.click(el);
    el.setSelectionRange(1, 1);
    await user.keyboard("{Backspace}");
    expect(onBackspaceAtStart).not.toHaveBeenCalled();
    expect(el.value).toBe("y");
    el.setSelectionRange(0, 0);
    await user.keyboard("{Backspace}");
    expect(onBackspaceAtStart).toHaveBeenCalledWith("y");
    el.setSelectionRange(1, 1);
    await user.keyboard("{Delete}");
    expect(onDeleteAtEnd).toHaveBeenCalledWith("y");
  });

  it("follows the stored value when it changes elsewhere and nothing is being typed", () => {
    const { rerender } = render(<BlockText value="old" onCommit={vi.fn()} />);
    rerender(<BlockText value="new from AI" onCommit={vi.fn()} />);
    expect(box().value).toBe("new from AI");
  });

  it("follows an undo while focused without losing focus", async () => {
    const user = userEvent.setup();
    const onCommit = vi.fn();
    const { rerender } = render(<BlockText value="v2" onCommit={onCommit} />);
    await user.click(box());
    rerender(<BlockText value="v1" onCommit={onCommit} />);
    expect(box().value).toBe("v1");
    expect(box()).toHaveFocus();
    await user.tab();
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("keeps typing that is not yet saved when the stored value changes underneath", async () => {
    const user = userEvent.setup();
    const onCommit = vi.fn();
    const { rerender } = render(<BlockText value="a" onCommit={onCommit} />);
    await user.click(box());
    await user.keyboard("b");
    rerender(<BlockText value="other" onCommit={onCommit} />);
    expect(box().value).toBe("ab");
    await user.tab();
    expect(onCommit).toHaveBeenCalledWith("ab");
  });
});
