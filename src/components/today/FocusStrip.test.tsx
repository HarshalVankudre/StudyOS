import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { FocusLauncherContext } from "@/components/focus/launcher";
import { I18nProvider } from "@/lib/i18n/client";
import { en } from "@/lib/i18n/dictionaries/en";
import { summarizeFocus } from "@/lib/study/focus";
import { FocusStrip } from "./FocusStrip";

const summary = summarizeFocus(
  [
    { localDate: "2026-11-12", seconds: 1500 },
    { localDate: "2026-11-10", seconds: 3600 },
  ],
  "2026-11-12",
);

describe("FocusStrip: the way into insights", () => {
  it("links the last week to the insights page in the signed-in app", () => {
    render(
      <I18nProvider locale="en" dictionary={en}>
        <FocusLauncherContext.Provider value={{ open: vi.fn(), activeItemKey: null }}>
          <FocusStrip summary={summary} />
        </FocusLauncherContext.Provider>
      </I18nProvider>,
    );
    const link = screen.getByRole("link", { name: "Last 7 days: 1 h 25 min of focus. Open your insights" });
    expect(link).toHaveAttribute("href", "/app/insights");
    // The bars themselves are unchanged inside it.
    expect(within(link).getAllByRole("listitem")).toHaveLength(7);
  });

  it("shows the week without a link where there is no timer (outside the app)", () => {
    render(
      <I18nProvider locale="en" dictionary={en}>
        <FocusStrip summary={summary} />
      </I18nProvider>,
    );
    expect(screen.getByRole("list", { name: en.focus.weekLabel })).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });
});
