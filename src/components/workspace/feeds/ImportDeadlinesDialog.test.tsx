import { readFileSync } from "node:fs";
import path from "node:path";
import { useCallback, useState } from "react";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "@/lib/i18n/client";
import { en } from "@/lib/i18n/dictionaries/en";
import { readFeed } from "@/lib/feeds/normalize";
import type { FeedInfo } from "@/lib/feeds/types";
import type { Database, Workspace } from "@/lib/workspace/types";
import { WorkspaceProvider } from "../WorkspaceContext";
import { ImportDeadlinesButton } from "./ImportDeadlinesButton";

const actions = vi.hoisted(() => ({
  listFeedsAction: vi.fn(),
  previewFeedAction: vi.fn(),
  connectFeedAction: vi.fn(),
  recordFeedSyncAction: vi.fn(),
  fetchFeedForSyncAction: vi.fn(),
  releaseFeedAction: vi.fn(),
  updateFeedSettingsAction: vi.fn(),
  disconnectFeedAction: vi.fn(),
}));
vi.mock("@/app/app/feed-actions", () => actions);

const F = en.feeds;
const canvasText = readFileSync(path.join(process.cwd(), "src/lib/feeds/fixtures/canvas.ics"), "utf8");
const LINK = "webcal://canvas.university.edu/feeds/calendars/user_8hT3kQ0aZx1Yc2Vb7Nn4Mm5Ll6Kk.ics";

let latest: Workspace;

function Harness({ initial }: { initial: Workspace }) {
  const [workspace, setWorkspace] = useState(initial);
  const update = useCallback((mutator: (draft: Workspace) => void) => {
    setWorkspace((prev) => {
      const next = structuredClone(prev);
      mutator(next);
      latest = next;
      return next;
    });
  }, []);
  return (
    <I18nProvider locale="en" dictionary={en}>
      <WorkspaceProvider value={{ workspace, update, status: "saved", rev: 0, agentBusy: false, setAgentBusy: () => {} }}>
        <ImportDeadlinesButton db={workspace.databases[0]} />
      </WorkspaceProvider>
    </I18nProvider>
  );
}

function assignments(rows: Database["rows"] = []): Database {
  return {
    id: "db",
    name: "Assignments",
    properties: [
      { id: "name", name: "Assignment", type: "text" },
      { id: "course", name: "Course", type: "select", options: [{ id: "eng", label: "ENG 102" }] },
      { id: "due", name: "Due", type: "date" },
      { id: "link", name: "Link", type: "url" },
    ],
    rows,
    views: [{ id: "v", name: "All", type: "table" }],
  };
}

function renderWith(db: Database) {
  latest = { id: "ws1", name: "Fall", pages: [], databases: [db] };
  return render(<Harness initial={latest} />);
}

const feedInfo = (over: Partial<FeedInfo> = {}): FeedInfo => ({
  id: "feed_1",
  databaseId: "db",
  label: "canvas.university.edu",
  platform: "canvas",
  lastSyncedAt: new Date(Date.now() - 2 * 3_600_000).toISOString(),
  lastAttemptAt: null,
  lastError: null,
  lastSummary: null,
  mapping: null,
  series: [],
  stale: false,
  ...over,
});

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-12T15:00:00Z"));
  for (const fn of Object.values(actions)) fn.mockReset();
  actions.listFeedsAction.mockResolvedValue([]);
  const read = readFeed(canvasText);
  if (!read.ok) throw new Error("fixture");
  actions.previewFeedAction.mockResolvedValue({ ok: true, feed: read.feed, label: "canvas.university.edu", connectedFeedId: null });
  actions.connectFeedAction.mockResolvedValue({ ok: true, feed: feedInfo({ lastSyncedAt: null }) });
  actions.recordFeedSyncAction.mockResolvedValue(feedInfo());
});
afterEach(() => vi.useRealTimers());

async function openDialog(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: F.button }));
  return screen.findByRole("dialog");
}

describe("Import deadlines", () => {
  it("previews a pasted link, lets the student choose, and imports through the workspace update", async () => {
    const user = userEvent.setup();
    renderWith(assignments());
    const dialog = await openDialog(user);
    // Instructions for each platform are there.
    expect(within(dialog).getByText(F.helpTitle)).toBeInTheDocument();

    await user.type(within(dialog).getByLabelText(F.linkLabel), LINK);
    await user.click(within(dialog).getByRole("button", { name: F.preview }));
    expect(actions.previewFeedAction).toHaveBeenCalledWith(
      "ws1",
      "https://canvas.university.edu/feeds/calendars/user_8hT3kQ0aZx1Yc2Vb7Nn4Mm5Ll6Kk.ics",
    );
    await within(dialog).findByText(/Found 5 events in/);

    // Upcoming deadlines are chosen, earlier ones are not.
    expect(within(dialog).getByRole("checkbox", { name: /Essay 2: Argument Analysis/ })).toBeChecked();
    expect(within(dialog).getByRole("checkbox", { name: /Reading Response 1/ })).not.toBeChecked();
    // Columns were detected.
    expect(within(dialog).getByLabelText(F.field.due)).toHaveValue("due");
    expect(within(dialog).getByLabelText(F.field.course)).toHaveValue("course");

    // The student unticks one.
    await user.click(within(dialog).getByRole("checkbox", { name: /Midterm Exam/ }));
    await user.click(within(dialog).getByRole("button", { name: "Import 3" }));

    await within(dialog).findByText(F.doneTitle);
    expect(actions.connectFeedAction).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: "ws1", databaseId: "db", platform: "canvas" }),
    );
    const rows = latest.databases[0].rows;
    expect(rows.map((r) => r.cells.name).sort()).toEqual([
      "Essay 2: Argument Analysis",
      "Lab 9: Recursion, Part 2",
      "Problem Set 7",
    ]);
    expect(rows.find((r) => r.cells.name === "Essay 2: Argument Analysis")!.cells.course).toBe("eng");
    expect(rows.every((r) => r.source?.feed === "feed_1")).toBe(true);
    const record = actions.recordFeedSyncAction.mock.calls[0];
    expect(record[0]).toBe("feed_1");
    expect(record[1].considered).toHaveLength(5);
    expect(record[1].summary.added).toBe(3);
    // The link is not kept in the workspace.
    expect(JSON.stringify(latest)).not.toContain("user_8hT3kQ0aZx1Yc2Vb7Nn4Mm5Ll6Kk");
  });

  it("explains an expired link", async () => {
    actions.previewFeedAction.mockResolvedValueOnce({ ok: false, error: "link_expired" });
    const user = userEvent.setup();
    renderWith(assignments());
    const dialog = await openDialog(user);
    await user.type(within(dialog).getByLabelText(F.linkLabel), LINK);
    await user.click(within(dialog).getByRole("button", { name: F.preview }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(F.errors.link_expired);
  });

  it("checks a mistyped link before sending it anywhere", async () => {
    const user = userEvent.setup();
    renderWith(assignments());
    const dialog = await openDialog(user);
    await user.type(within(dialog).getByLabelText(F.linkLabel), "ftp://lms/feed");
    await user.click(within(dialog).getByRole("button", { name: F.preview }));
    expect(within(dialog).getByRole("alert")).toHaveTextContent(F.errors.unsupported_link);
    expect(actions.previewFeedAction).not.toHaveBeenCalled();
  });

  it("imports an uploaded .ics file without connecting anything", async () => {
    const user = userEvent.setup();
    const { container } = renderWith(assignments());
    const dialog = await openDialog(user);
    const input = container.ownerDocument.querySelector<HTMLInputElement>('input[type="file"]')!;
    await user.upload(input, new File([canvasText], "calendar.ics", { type: "text/calendar" }));
    await within(dialog).findByText(/Found 5 events in Alex Rivera Calendar/);
    await user.click(within(dialog).getByRole("button", { name: "Import 4" }));
    await within(dialog).findByText(F.doneTitle);
    expect(actions.connectFeedAction).not.toHaveBeenCalled();
    expect(actions.recordFeedSyncAction).not.toHaveBeenCalled();
    expect(latest.databases[0].rows.every((r) => r.source?.feed === "file")).toBe(true);
  });

  describe("re-importing a file", () => {
    const vevent = (uid: string, summary: string, dates: string) =>
      `BEGIN:VEVENT\r\nUID:${uid}\r\nSUMMARY:${summary}\r\n${dates}DTSTAMP:20261112T081500Z\r\nEND:VEVENT\r\n`;
    const cal = (...events: string[]) =>
      `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:icalendar-ruby\r\nX-WR-CALNAME:QA Calendar\r\n${events.join("")}END:VCALENDAR\r\n`;
    const hw = (day: string) => vevent("event-assignment-4011", "Homework 11 [ENG 102-01 FA26]", `DTSTART:${day}T225900Z\r\n`);
    const week = vevent(
      "event-calendar-event-7002",
      "Reading week - no lectures [ENG 102-01 FA26]",
      "DTSTART;VALUE=DATE:20261130\r\nDTEND;VALUE=DATE:20261205\r\n",
    );
    const ps = vevent("event-assignment-3005", "Problem Set 5 [ENG 102-01 FA26]", "DTSTART:20261117T225900Z\r\n");

    async function upload(user: ReturnType<typeof userEvent.setup>, container: HTMLElement, text: string) {
      const dialog = await openDialog(user);
      const input = container.ownerDocument.querySelector<HTMLInputElement>('input[type="file"]')!;
      await user.upload(input, new File([text], "calendar.ics", { type: "text/calendar" }));
      await within(dialog).findByText(/Found \d+ events? in QA Calendar/);
      return dialog;
    }

    it("offers a changed date even when nothing is new, and applies it", async () => {
      const user = userEvent.setup();
      const { container } = renderWith(assignments());
      // First import: Homework 11 on Nov 27, Problem Set 5, and the reading week is left out.
      let dialog = await upload(user, container, cal(ps, hw("20261127"), week));
      expect(within(dialog).getByRole("checkbox", { name: /Homework 11/ })).toBeChecked();
      expect(within(dialog).getByRole("checkbox", { name: /Reading week/ })).not.toBeChecked();
      await user.click(within(dialog).getByRole("button", { name: "Import 2" }));
      await within(dialog).findByText(F.doneTitle);
      expect(latest.databases[0].rows.find((r) => r.cells.name === "Homework 11")!.cells.due).toBe("2026-11-27");
      await user.click(within(dialog).getAllByRole("button", { name: F.close })[0]);
      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

      // Second file: only the date moved.
      dialog = await upload(user, container, cal(ps, hw("20261203"), week));
      const changed = within(dialog).getByRole("region", { name: /Changed in your calendar/ });
      const box = within(changed).getByRole("checkbox", { name: /Homework 11/ });
      expect(box).toBeChecked();
      expect(box).toBeEnabled();
      expect(within(changed).getByText("Date changed: Fri, Nov 27 → Thu, Dec 3")).toBeInTheDocument();
      expect(within(dialog).getByRole("checkbox", { name: /Problem Set 5/ })).toBeDisabled();
      await user.click(within(dialog).getByRole("button", { name: "Update 1" }));
      await within(dialog).findByText("Updated 1 deadline in Assignments.");
      expect(latest.databases[0].rows.find((r) => r.cells.name === "Homework 11")!.cells.due).toBe("2026-12-03");
      expect(latest.databases[0].rows).toHaveLength(2);
    });

    it("keeps a changed date when the student unticks it, and says a file never flags missing rows", async () => {
      const user = userEvent.setup();
      const { container } = renderWith(assignments());
      let dialog = await upload(user, container, cal(ps, hw("20261127")));
      await user.click(within(dialog).getByRole("button", { name: "Import 2" }));
      await within(dialog).findByText(F.doneTitle);
      await user.click(within(dialog).getAllByRole("button", { name: F.close })[0]);
      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

      dialog = await upload(user, container, cal(hw("20261203")));
      expect(within(dialog).getByText(/1 upcoming deadline from an earlier file isn’t in this one\./)).toHaveTextContent(F.fileSnapshot);
      await user.click(within(dialog).getByRole("checkbox", { name: /Homework 11/ }));
      expect(within(dialog).getByRole("button", { name: F.nothingSelected })).toBeDisabled();
      expect(latest.databases[0].rows.find((r) => r.cells.name === "Homework 11")!.cells.due).toBe("2026-11-27");
      expect(latest.databases[0].rows.every((r) => !r.source?.missingSince)).toBe(true);
    });

    it("groups what does not look like coursework, unticked, and warns about a general calendar", async () => {
      const user = userEvent.setup();
      const { container } = renderWith(assignments());
      const holidays = ["Thanksgiving Day", "Christmas Day", "New Year's Day", "Boxing Day", "Diwali", "Veterans Day"].map((name, i) =>
        vevent(`h${i}@holidays`, name, `DTSTART;VALUE=DATE:202612${String(i + 10)}\r\nDTEND;VALUE=DATE:202612${String(i + 11)}\r\n`),
      );
      const dialog = await upload(user, container, cal(...holidays));
      expect(within(dialog).getByText(F.generalCalendar)).toBeInTheDocument();
      const boxes = within(dialog).getAllByRole("checkbox");
      expect(boxes).toHaveLength(6);
      for (const b of boxes) expect(b).not.toBeChecked();
      expect(within(dialog).getByText(`${F.groups.other} · 6`)).toBeInTheDocument();
      expect(within(dialog).getByRole("button", { name: F.nothingSelected })).toBeDisabled();
    });
  });

  it("shows a connected calendar's last sync, and disconnects only after confirming", async () => {
    actions.listFeedsAction.mockResolvedValue([
      feedInfo({
        lastSummary: {
          at: new Date().toISOString(),
          added: 2,
          updated: 1,
          flagged: 0,
          restored: 0,
          linked: 0,
          keptEdits: 0,
          titles: { added: ["Lab 10", "Lab 11"], updated: ["Essay 2"], flagged: [], restored: [] },
        },
      }),
    ]);
    actions.disconnectFeedAction.mockResolvedValue(true);
    const user = userEvent.setup();
    renderWith(assignments());
    const dialog = await openDialog(user);
    expect(await within(dialog).findByText(/Last synced 2 hours ago/)).toHaveTextContent("2 new · 1 updated");

    await user.click(within(dialog).getByRole("button", { name: F.disconnect }));
    expect(actions.disconnectFeedAction).not.toHaveBeenCalled();
    const confirm = within(dialog).getByRole("alertdialog");
    await user.click(within(confirm).getByRole("button", { name: F.confirm }));
    expect(actions.disconnectFeedAction).toHaveBeenCalledWith("feed_1");
    await waitFor(() => expect(within(dialog).queryByText(F.connectedTitle)).not.toBeInTheDocument());
  });

  it("flags rows gone from the calendar and lets the student keep or delete them", async () => {
    const user = userEvent.setup();
    renderWith(
      assignments([
        { id: "r1", cells: { name: "Old quiz" }, source: { kind: "ical", feed: "feed_1", key: "k1", missingSince: "2026-11-10" } },
        { id: "r2", cells: { name: "Cancelled lab" }, source: { kind: "ical", feed: "feed_1", key: "k2", missingSince: "2026-11-10" } },
      ]),
    );
    await user.click(screen.getByRole("button", { name: "Import deadlines (2 need a look)" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(F.flaggedTitle)).toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: "Keep “Old quiz” as your own" }));
    expect(latest.databases[0].rows.find((r) => r.id === "r1")!.source).toBeUndefined();

    await user.click(within(dialog).getByRole("button", { name: "Delete “Cancelled lab”" }));
    expect(latest.databases[0].rows.map((r) => r.id)).toEqual(["r1"]);
  });
});

describe("Import deadlines when calendar links are switched off (no FEED_URL_KEY)", () => {
  it("explains it is a one-time import, never connects, and still imports the chosen events", async () => {
    const read = readFeed(canvasText);
    if (!read.ok) throw new Error("fixture");
    actions.previewFeedAction.mockResolvedValue({
      ok: true,
      feed: read.feed,
      label: "canvas.university.edu",
      connectedFeedId: null,
      canConnect: false,
    });
    const user = userEvent.setup();
    renderWith(assignments());
    const dialog = await openDialog(user);
    await user.type(within(dialog).getByLabelText(F.linkLabel), LINK);
    await user.click(within(dialog).getByRole("button", { name: F.preview }));
    await within(dialog).findByText(F.linksOffNote);
    expect(within(dialog).queryByRole("checkbox", { name: F.keepInSync })).toBeNull();
    const importButton = within(dialog).getAllByRole("button").find((b) => /^Import \d+$/.test(b.textContent ?? ""));
    expect(importButton).toBeDefined();
    await user.click(importButton!);
    await within(dialog).findByText(F.doneTitle);
    expect(actions.connectFeedAction).not.toHaveBeenCalled();
    expect(within(dialog).queryByText(F.doneSynced)).toBeNull();
    expect(latest.databases[0].rows.length).toBeGreaterThan(0);
  });
});
