import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { FocusLauncherContext } from "@/components/focus/launcher";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { en } from "@/lib/i18n/dictionaries/en";
import { fmt } from "@/lib/i18n/interpolate";
import { pluralizer } from "@/lib/i18n/plural";
import { buildInsights, type InsightPeriod, type InsightsInput } from "@/lib/study/insights";
import { InsightsView } from "./InsightsView";

const I = en.insights;
const TODAY = "2026-11-13";
const i18n = { dict: en, locale: "en", t: fmt, plural: pluralizer("en") };

function insights(o: Partial<InsightsInput> = {}) {
  return buildInsights({
    period: "7d",
    today: TODAY,
    timeZone: "Europe/Berlin",
    studyDays: [],
    focusDays: [],
    courseStudy: [],
    courseFocus: [],
    courses: [],
    focusStarts: [],
    streakDays: [],
    ...o,
  });
}

const zero = { reviews: 0, practice: 0, newCards: 0, reviewTotal: 0, reviewPassed: 0, quizAnswers: 0, quizCorrect: 0 };

function filled(period: InsightPeriod = "7d") {
  return insights({
    period,
    studyDays: [
      { ...zero, localDate: "2026-11-12", reviews: 40, newCards: 6, reviewTotal: 20, reviewPassed: 16, quizAnswers: 8, quizCorrect: 6 },
      { ...zero, localDate: "2026-11-02", reviews: 10 },
    ],
    focusDays: [
      { localDate: "2026-11-12", seconds: 50 * 60, sessions: 3 },
      { localDate: "2026-11-10", seconds: 25 * 60, sessions: 2 },
      { localDate: "2026-11-01", seconds: 55 * 60, sessions: 2 },
    ],
    courses: [{ id: "ws_bio", name: "Biology", icon: "🧬" }],
    courseStudy: [{ workspaceId: "ws_bio", reviews: 40, practice: 0, quizAnswers: 8, quizCorrect: 6 }],
    courseFocus: [
      { workspaceId: "ws_bio", seconds: 60 * 60 },
      { workspaceId: null, seconds: 15 * 60 },
    ],
    // Five sessions, mostly in the Berlin morning (UTC+1).
    focusStarts: [
      { startedAt: new Date("2026-11-12T07:00:00Z"), seconds: 25 * 60 },
      { startedAt: new Date("2026-11-12T08:00:00Z"), seconds: 15 * 60 },
      { startedAt: new Date("2026-11-12T09:00:00Z"), seconds: 10 * 60 },
      { startedAt: new Date("2026-11-10T19:00:00Z"), seconds: 15 * 60 },
      { startedAt: new Date("2026-11-10T20:00:00Z"), seconds: 10 * 60 },
    ],
    streakDays: ["2026-11-10", "2026-11-11", "2026-11-12", TODAY],
  });
}

describe("InsightsView", () => {
  it("welcomes a new student with a way to start, and no numbers yet", () => {
    render(<InsightsView insights={insights()} period="7d" i18n={i18n} />);
    expect(screen.getByRole("heading", { level: 1, name: I.title })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: I.emptyTitle })).toBeInTheDocument();
    expect(screen.getByText(I.emptyBody)).toBeInTheDocument();
    // Without a timer the focus button leads to Today, like the review link.
    expect(screen.getByRole("link", { name: I.startFocus })).toHaveAttribute("href", "/app");
    expect(screen.getByRole("link", { name: I.reviewCards })).toHaveAttribute("href", "/app");
    expect(screen.queryByRole("link", { name: I.downloadAria })).not.toBeInTheDocument();
    expect(screen.queryByText(I.focusTime)).not.toBeInTheDocument();
    expect(screen.queryByText(I.streakTitle)).not.toBeInTheDocument();
  });

  it("starts a focus session right here when the timer is around", async () => {
    const user = userEvent.setup();
    const open = vi.fn();
    render(
      <FocusLauncherContext.Provider value={{ open, activeItemKey: null }}>
        <InsightsView insights={insights()} period="7d" i18n={i18n} />
      </FocusLauncherContext.Provider>,
    );
    await user.click(screen.getByRole("button", { name: I.startFocus }));
    expect(open).toHaveBeenCalledTimes(1);
  });

  it("is kind about a quiet stretch and still shows the streak's best", () => {
    render(
      <InsightsView insights={insights({ streakDays: ["2026-10-01", "2026-10-02", "2026-10-03"] })} period="7d" i18n={i18n} />,
    );
    expect(screen.getByRole("heading", { name: I.quietTitle })).toBeInTheDocument();
    expect(screen.getByText(I.quietBody)).toBeInTheDocument();
    expect(screen.getByText(I.streakNone)).toBeInTheDocument();
    expect(screen.getByText("Best: 3 days")).toBeInTheDocument();
  });

  it("switches periods through linkable pills", () => {
    render(<InsightsView insights={insights()} period="30d" i18n={i18n} />);
    const nav = screen.getByRole("navigation", { name: I.periodLabel });
    expect(within(nav).getByRole("link", { name: I.periods.d30 })).toHaveAttribute("aria-current", "page");
    expect(within(nav).getByRole("link", { name: I.periods.d7 })).toHaveAttribute("href", "/app/insights?period=7d");
    expect(within(nav).getByRole("link", { name: I.periods.d90 })).not.toHaveAttribute("aria-current");
  });

  it("shows the numbers, how they changed, the streak, the best time and each course", () => {
    const { container } = render(<InsightsView insights={filled()} period="7d" i18n={i18n} />);
    const tile = (key: string) => container.querySelector(`[data-tile="${key}"]`) as HTMLElement;

    // 75 min this week against 55 the week before.
    expect(within(tile("focus")).getByText("1 h 15 min")).toBeInTheDocument();
    expect(within(tile("focus")).getByText("Up 20 min from the 7 days before")).toBeInTheDocument();
    expect(within(tile("days")).getByText("2 of 7")).toBeInTheDocument();
    expect(within(tile("days")).getByText("Same as the 7 days before")).toBeInTheDocument();
    expect(within(tile("cards")).getByText("40")).toBeInTheDocument();
    expect(within(tile("cards")).getByText("6 new cards")).toBeInTheDocument();
    expect(within(tile("cards")).getByText("Up 30 from the 7 days before")).toBeInTheDocument();
    expect(within(tile("recall")).getByText("80%")).toBeInTheDocument();
    // No learned-card reviews the week before: nothing to compare the rate with.
    expect(within(tile("recall")).getByText(I.noPrevious)).toBeInTheDocument();
    expect(within(tile("quiz")).getByText("75%")).toBeInTheDocument();
    expect(within(tile("quiz")).getByText("From 8 answers")).toBeInTheDocument();

    // The chart is described by a table for screen readers: one row per day.
    const table = screen.getByRole("table", { name: I.chartDaily });
    expect(within(table).getAllByRole("row")).toHaveLength(8);
    expect(within(table).getByRole("rowheader", { name: /Nov 12/ })).toBeInTheDocument();

    expect(screen.getByText("4-day streak")).toBeInTheDocument();
    expect(screen.getByText(I.streakToday)).toBeInTheDocument();
    expect(screen.getByText(I.bestTime.morning)).toBeInTheDocument();
    expect(screen.getByText("Based on 5 focus sessions")).toBeInTheDocument();

    const courses = screen.getByRole("region", { name: I.coursesTitle });
    const bio = within(courses).getByRole("link", { name: /Biology/ });
    expect(bio).toHaveAttribute("href", "/app/ws_bio");
    expect(within(bio).getByText("40 cards · 75% right on quizzes")).toBeInTheDocument();
    expect(within(bio).getByText("1 h")).toBeInTheDocument();
    expect(within(courses).getByText(I.other)).toBeInTheDocument();
    expect(within(courses).getByText(I.otherHint)).toBeInTheDocument();

    expect(screen.getByRole("link", { name: I.downloadAria })).toHaveAttribute("href", "/app/insights/export?period=7d");
    expect(screen.getByText(/Days follow your time zone, Europe\/Berlin\./)).toBeInTheDocument();
  });

  it("shows weeks for 90 days", () => {
    render(<InsightsView insights={filled("90d")} period="90d" i18n={i18n} />);
    const table = screen.getByRole("table", { name: I.chartWeekly });
    expect(within(table).getByRole("columnheader", { name: I.tableWeek })).toBeInTheDocument();
    expect(within(table).getAllByRole("row")).toHaveLength(14);
  });

  it("says so when the numbers could not be read", () => {
    render(<InsightsView insights={null} period="7d" i18n={i18n} />);
    expect(screen.getByRole("alert")).toHaveTextContent(I.loadFailed);
    expect(screen.queryByRole("link", { name: I.downloadAria })).not.toBeInTheDocument();
  });

  it("renders in Arabic with the student's digits", () => {
    const ar = getDictionary("ar");
    render(
      <InsightsView
        insights={filled()}
        period="7d"
        i18n={{ dict: ar, locale: "ar", t: fmt, plural: pluralizer("ar") }}
      />,
    );
    expect(screen.getByRole("heading", { level: 1, name: ar.insights.title })).toBeInTheDocument();
    const forty = new Intl.NumberFormat("ar").format(40);
    expect(screen.getAllByText(forty).length).toBeGreaterThan(0);
  });
});
