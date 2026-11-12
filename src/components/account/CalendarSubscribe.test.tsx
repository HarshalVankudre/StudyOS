import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { en } from "@/lib/i18n/dictionaries/en";

vi.mock("@/lib/i18n/client", () => ({ useI18n: () => ({ dict: en }) }));
vi.mock("@/app/app/calendar-actions", () => ({ resetCalendarFeedAction: vi.fn() }));

import { CalendarSubscribe, withCompleted } from "./CalendarSubscribe";

const URL_ = "https://studyos.app/api/calendar/tok123";

describe("CalendarSubscribe", () => {
  it("offers the feed without completed items, and a link that includes them on request", async () => {
    render(<CalendarSubscribe initialUrl={URL_} />);
    const field = screen.getByRole("textbox", { name: en.calendar.urlLabel });
    expect(field).toHaveValue(URL_);
    expect(screen.getByText(en.calendar.completedHint)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: en.calendar.addToCalendar })).toHaveAttribute(
      "href",
      "webcal://studyos.app/api/calendar/tok123",
    );

    await userEvent.click(screen.getByRole("checkbox", { name: en.calendar.includeCompleted }));
    expect(field).toHaveValue(`${URL_}?completed=1`);
    expect(screen.getByRole("link", { name: en.calendar.addToCalendar })).toHaveAttribute(
      "href",
      "webcal://studyos.app/api/calendar/tok123?completed=1",
    );
  });

  it("adds the parameter to a link that already has a query", () => {
    expect(withCompleted("https://x.test/c/t?a=1")).toBe("https://x.test/c/t?a=1&completed=1");
  });
});
