import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

// RichText pulls in Streamdown; render it as a passthrough so the preview's
// text is directly assertable and no browser layout APIs are needed.
vi.mock("streamdown", () => ({
  Streamdown: ({ children }: { children: string }) => (
    <div data-testid="md">{children}</div>
  ),
}));
vi.mock("@/lib/streamdown-plugins", () => ({ streamdownPlugins: {} }));

import { BlockText } from "./BlockText";

describe("BlockText", () => {
  it("renders the value typeset when idle", () => {
    render(<BlockText value="hello" onCommit={vi.fn()} />);
    expect(screen.getByTestId("md")).toHaveTextContent("hello");
    // In idle mode the read-mode div has role="textbox" but no <input> is rendered.
    expect(screen.queryByDisplayValue("hello")).not.toBeInTheDocument();
  });

  it("shows the placeholder when empty and idle", () => {
    render(<BlockText value="" onCommit={vi.fn()} placeholder="Type here" />);
    expect(screen.getByText("Type here")).toBeInTheDocument();
  });

  it("reveals a raw input with a live preview on focus, and commits on blur", async () => {
    const user = userEvent.setup();
    const onCommit = vi.fn();
    render(<BlockText value="hello" onCommit={onCommit} />);

    await user.click(screen.getByText("hello"));
    // After entering edit mode, query the input specifically by its element type.
    const input = screen.getByDisplayValue("hello") as HTMLInputElement;
    expect(input.tagName).toBe("INPUT");
    expect(input.value).toBe("hello");

    await user.clear(input);
    await user.type(input, "world $x$");
    // Live preview reflects the draft as it is typed.
    expect(screen.getByTestId("md")).toHaveTextContent("world $x$");

    await user.tab(); // blur
    expect(onCommit).toHaveBeenCalledWith("world $x$");
    // Back to read mode showing the committed value.
    expect(screen.queryByDisplayValue("world $x$")).not.toBeInTheDocument();
    expect(screen.getByTestId("md")).toHaveTextContent("hello");
  });

  it("does not call onCommit when blurring without changing the text", async () => {
    const user = userEvent.setup();
    const onCommit = vi.fn();
    render(<BlockText value="hello" onCommit={onCommit} placeholder="Type here" />);

    // Click to enter edit mode.
    await user.click(screen.getByRole("textbox", { name: "Type here" }));
    // Verify we are in edit mode (input is present).
    expect(screen.getByDisplayValue("hello")).toBeInTheDocument();

    // Blur immediately without typing anything.
    await user.tab();

    // onCommit must NOT have been called since draft === value.
    expect(onCommit).not.toHaveBeenCalled();
  });
});
