import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { FocusLauncherContext } from "@/components/focus/launcher";
import type { AgendaData } from "@/lib/agenda/agenda";
import type { AgendaItem } from "@/lib/agenda/build";
import { formatDay, formatLongDay, formatWeekday } from "@/lib/agents/daily-study/present";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { en } from "@/lib/i18n/dictionaries/en";
import { fmt } from "@/lib/i18n/interpolate";
import { pluralizer } from "@/lib/i18n/plural";
import { AgendaView } from "./AgendaView";

const A = en.agenda;
const TODAY = "2026-11-13";
const i18n = { dict: en, locale: "en", t: fmt, plural: pluralizer("en") };
const ALL = { course: null, showDone: false };
const long = (day: string) => formatLongDay(day, "en");

function item(o: Partial<AgendaItem> & Pick<AgendaItem, "id" | "date" | "title">): AgendaItem {
  return {
    kind: "deadline",
    time: null,
    done: false,
    workspaceId: "bio",
    workspaceName: "Biology",
    workspaceIcon: "🧬",
    subject: null,
    source: "Assignments",
    href: `/app/bio?page=home&db=db&row=${o.id}`,
    ...o,
  };
}

function data(items: AgendaItem[], o: Partial<AgendaData> = {}): AgendaData {
  return {
    today: TODAY,
    timeZone: "Europe/Berlin",
    courses: [
      { id: "bio", name: "Biology", icon: "🧬" },
      { id: "art", name: "Art history", icon: null },
    ],
    items,
    partial: false,
    ...o,
  };
}

const filled = data([
  item({ id: "deadline:bio:db:late", date: "2026-11-10", title: "Lab report" }),
  item({ id: "deadline:bio:db:today", date: TODAY, title: "Reading log", time: "09:30" }),
  item({ id: "exam:bio:db:mid", date: "2026-11-14", title: "Midterm", kind: "exam" }),
  item({ id: "deadline:art:db:essay", date: "2026-11-17", title: "Museum essay", workspaceId: "art", workspaceName: "Art history", workspaceIcon: null }),
  item({ id: "deadline:bio:db:done", date: "2026-11-17", title: "Problem set 3", done: true }),
]);

describe("AgendaView", () => {
  it("sends a student without workspaces to the generator", () => {
    render(<AgendaView data={data([], { courses: [] })} params={ALL} i18n={i18n} />);
    expect(screen.getByRole("heading", { level: 1, name: A.title })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: A.noWorkspacesTitle })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: en.app.emptyGenerate })).toHaveAttribute("href", "/generate");
    expect(screen.queryByRole("navigation", { name: A.weekLabel })).not.toBeInTheDocument();
  });

  it("says so kindly when the next two weeks are clear", () => {
    render(<AgendaView data={data([])} params={ALL} i18n={i18n} />);
    expect(screen.getByRole("heading", { name: A.emptyTitle })).toBeInTheDocument();
    expect(screen.getByText(A.emptyBody)).toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: A.weekLabel })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: A.calendarLink })).toHaveAttribute("href", "/app/settings#calendar");
  });

  it("offers every course back when one course has nothing", () => {
    render(<AgendaView data={data([])} params={{ course: "art", showDone: false }} i18n={i18n} />);
    expect(screen.getByRole("heading", { name: fmt(A.emptyCourse, { course: "Art history" }) })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: A.showAll })).toHaveAttribute("href", "/app/agenda");
  });

  it("shows overdue, today, tomorrow and later days, each item linking into its workspace", () => {
    render(<AgendaView data={filled} params={ALL} i18n={i18n} />);
    expect(screen.getByText(/4 things on your agenda/)).toBeInTheDocument();

    const headings = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
    expect(headings).toEqual([
      A.overdue,
      `${A.today}${long(TODAY)}`,
      `${A.tomorrow}${long("2026-11-14")}`,
      long("2026-11-17"),
    ]);

    const overdue = screen.getByRole("region", { name: A.overdue });
    expect(within(overdue).getByText(fmt(A.wasDue, { date: `${formatWeekday("2026-11-10", "en")}, ${formatDay("2026-11-10", "en")}` }))).toBeInTheDocument();
    expect(within(overdue).getByRole("link", { name: fmt(en.today.openAria, { title: "Lab report" }) })).toHaveAttribute(
      "href",
      "/app/bio?page=home&db=db&row=deadline:bio:db:late",
    );

    const today = screen.getByRole("region", { name: /^Today/ });
    expect(within(today).getByText("9:30 AM")).toBeInTheDocument();
    expect(within(today).getByText(A.kindDeadline)).toBeInTheDocument();
    const tomorrow = screen.getByRole("region", { name: /^Tomorrow/ });
    expect(within(tomorrow).getByText(A.kindExam)).toBeInTheDocument();
    expect(within(tomorrow).getByText("Midterm")).toBeInTheDocument();

    // Done work stays out unless asked for.
    expect(screen.queryByText("Problem set 3")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: A.showDone })).toHaveAttribute("href", "/app/agenda?done=1");
  });

  it("tags an administrative deadline as a Frist", () => {
    const de = getDictionary("de");
    const registration = item({ id: "deadline:bio:db:anm", date: TODAY, title: "Prüfungsanmeldung", formality: true });
    render(<AgendaView data={data([registration])} params={ALL} i18n={{ dict: de, locale: "de", t: fmt, plural: pluralizer("de") }} />);
    expect(screen.getByText("Frist")).toBeInTheDocument();
    expect(screen.queryByText(de.agenda.kindDeadline)).not.toBeInTheDocument();
  });

  it("puts fourteen days at a glance, the busy ones jumping to their section", () => {
    render(<AgendaView data={filled} params={ALL} i18n={i18n} />);
    const strip = screen.getByRole("navigation", { name: A.weekLabel });
    expect(within(strip).getAllByRole("listitem")).toHaveLength(14);
    const busy = within(strip).getAllByRole("link");
    expect(busy.map((a) => a.getAttribute("href"))).toEqual([
      "#agenda-2026-11-13",
      "#agenda-2026-11-14",
      "#agenda-2026-11-17",
    ]);
    expect(busy[0]).toHaveAttribute("aria-current", "date");
    expect(busy[0]).toHaveAccessibleName(`${long(TODAY)}: 1 item`);
    expect(within(strip).getByText(`${long("2026-11-15")}: ${A.nothingDue}`)).toBeInTheDocument();
    expect(document.getElementById("agenda-2026-11-17")).not.toBeNull();
  });

  it("filters by course and keeps the done switch in the link", () => {
    render(<AgendaView data={filled} params={{ course: "art", showDone: true }} i18n={i18n} />);
    const filter = screen.getByRole("navigation", { name: A.filterLabel });
    expect(within(filter).getByRole("link", { name: A.allCourses })).toHaveAttribute("href", "/app/agenda?done=1");
    const art = within(filter).getByRole("link", { name: "Art history" });
    expect(art).toHaveAttribute("aria-current", "page");
    expect(within(filter).getByRole("link", { name: /Biology/ })).toHaveAttribute("href", "/app/agenda?course=bio&done=1");
    expect(screen.getByRole("link", { name: A.hideDone })).toHaveAttribute("href", "/app/agenda?course=art");
    expect(screen.getByText("Museum essay")).toBeInTheDocument();
    expect(screen.queryByText("Midterm")).not.toBeInTheDocument();
  });

  it("shows done work when asked, crossed out and without a focus button", () => {
    const open = vi.fn();
    render(
      <FocusLauncherContext.Provider value={{ open, activeItemKey: null }}>
        <AgendaView data={filled} params={{ course: null, showDone: true }} i18n={i18n} />
      </FocusLauncherContext.Provider>,
    );
    const doneLink = screen.getByRole("link", { name: fmt(en.today.openAria, { title: "Problem set 3" }) });
    expect(doneLink.className).toContain("line-through");
    const row = doneLink.closest("li")!;
    expect(within(row).getByText(A.done)).toBeInTheDocument();
    expect(within(row).queryByRole("button")).not.toBeInTheDocument();
  });

  it("starts a focus session on an item the way Today does", async () => {
    const user = userEvent.setup();
    const open = vi.fn();
    render(
      <FocusLauncherContext.Provider value={{ open, activeItemKey: "exam:bio:db:mid" }}>
        <AgendaView data={filled} params={ALL} i18n={i18n} />
      </FocusLauncherContext.Provider>,
    );
    await user.click(
      screen.getByRole("button", { name: fmt(en.focus.itemAria, { title: "Reading log", course: "Biology" }) }),
    );
    expect(open).toHaveBeenCalledWith({
      label: "Reading log",
      course: "Biology",
      workspaceId: "bio",
      itemKey: "deadline:bio:db:today",
    });
    // The item already on the clock says so.
    expect(screen.getByRole("button", { name: en.focus.expand })).toHaveTextContent(en.focus.itemActive);
  });

  it("has no Focus buttons where there is no timer", () => {
    render(<AgendaView data={filled} params={ALL} i18n={i18n} />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("tells the student when it could not load", () => {
    render(<AgendaView data={null} params={ALL} i18n={i18n} />);
    expect(screen.getByRole("alert")).toHaveTextContent(A.loadFailed);
  });

  it("renders in Arabic with the student's digits and mirrored, side-neutral layout", () => {
    const ar = getDictionary("ar");
    const { container } = render(
      <AgendaView data={filled} params={ALL} i18n={{ dict: ar, locale: "ar", t: fmt, plural: pluralizer("ar") }} />,
    );
    expect(screen.getByRole("heading", { level: 1, name: ar.agenda.title })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: ar.agenda.overdue })).toBeInTheDocument();
    expect(screen.getByText(new RegExp(`${new Intl.NumberFormat("ar").format(4)} عناصر في أجندتك`))).toBeInTheDocument();
    // Arrows flip in RTL, and nothing is pinned to a physical side.
    expect(container.querySelector("svg.lucide-arrow-up-right")?.getAttribute("class")).toContain("rtl:-scale-x-100");
    const classes = [...container.querySelectorAll("[class]")].flatMap((el) => el.getAttribute("class")!.split(/\s+/));
    expect(classes.filter((c) => /^(ml|mr|pl|pr|left|right)-|^text-(left|right)$/.test(c))).toEqual([]);
  });
});
