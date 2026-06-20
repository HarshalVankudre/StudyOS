import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

// Render Streamdown as a passthrough so we can assert exactly what text
// RichText feeds it (i.e. that sanitize ran). The real Streamdown needs
// browser layout APIs we don't exercise here.
vi.mock("streamdown", () => ({
  Streamdown: ({ children }: { children: string }) => (
    <div data-testid="md">{children}</div>
  ),
}));
// Stub the plugin set so the @streamdown/* factories never load in jsdom.
vi.mock("@/lib/streamdown-plugins", () => ({ streamdownPlugins: {} }));

import { RichText } from "./RichText";

describe("RichText", () => {
  it("converts stray LaTeX text commands to Markdown before rendering", () => {
    render(<RichText text={"Use \\texttt{SELECT} now"} />);
    expect(screen.getByTestId("md")).toHaveTextContent("Use `SELECT` now");
  });

  it("leaves real math regions untouched for KaTeX", () => {
    render(<RichText text={"x $\\wedge$ y"} />);
    expect(screen.getByTestId("md")).toHaveTextContent("x $\\wedge$ y");
  });
});
