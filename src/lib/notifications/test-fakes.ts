/**
 * In-memory stand-ins for the dispatch's store and channels (tests only).
 * Every method yields to the event loop first, so two runs started together
 * really interleave, the way two overlapping scheduler calls would.
 */
import type { DailyStudyPlanItem } from "@/lib/agents/daily-study/types";
import type { Database, DatabaseRow, Workspace } from "@/lib/workspace/types";
import type { NotificationMessage, WeeklyRecap } from "./content";
import type { DueUser, LogClaim, LogStatus, NotificationChannel, NotificationStore } from "./dispatch";
import { DEFAULT_PREFERENCES, type NotificationPreferences } from "./preferences";
import type { NotificationKind } from "./schedule";

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

export interface LogRow extends LogClaim {
  id: string;
  status: LogStatus;
}

export class MemoryStore implements NotificationStore {
  users = new Map<string, { prefs: NotificationPreferences; nextCheckAt: Date | null; leaseUntil: Date | null }>();
  logs: LogRow[] = [];
  workspaces = new Map<string, Workspace[]>();
  plans = new Map<string, DailyStudyPlanItem[] | null>();
  days = new Map<string, string[]>();
  /** The week's totals per student (none: an empty week). */
  weeks = new Map<string, WeeklyRecap>();
  /** (userId, today) of every weekTotals read. */
  weekReads: { userId: string; today: string }[] = [];
  /** Simulate a lease that expired while another run still works (worst case). */
  ignoreLeases = false;
  workspaceLoads = 0;
  failFor = new Set<string>();

  addUser(userId: string, prefs: Partial<NotificationPreferences> = {}, nextCheckAt: Date | null = new Date(0)) {
    this.users.set(userId, { prefs: { ...DEFAULT_PREFERENCES, ...prefs }, nextCheckAt, leaseUntil: null });
  }

  async claimDueUsers(now: Date, limit: number, leaseUntil: Date): Promise<DueUser[]> {
    await tick();
    const due = [...this.users.entries()]
      .filter(
        ([, u]) =>
          u.nextCheckAt !== null &&
          u.nextCheckAt <= now &&
          (this.ignoreLeases || u.leaseUntil === null || u.leaseUntil < now),
      )
      .sort((a, b) => a[1].nextCheckAt!.getTime() - b[1].nextCheckAt!.getTime())
      .slice(0, limit);
    for (const [, u] of due) u.leaseUntil = leaseUntil;
    return due.map(([userId, u]) => ({ userId, prefs: u.prefs }));
  }

  async release(userId: string, nextCheckAt: Date | null) {
    await tick();
    const u = this.users.get(userId);
    if (u) Object.assign(u, { nextCheckAt, leaseUntil: null });
  }

  async unlease(userIds: string[]) {
    await tick();
    for (const userId of userIds) {
      const u = this.users.get(userId);
      if (u) u.leaseUntil = null;
    }
  }

  async countMessages(userId: string, localDate: string) {
    await tick();
    return this.logs.filter(
      (l) => l.userId === userId && l.localDate === localDate && l.message && (l.status === "pending" || l.status === "sent"),
    ).length;
  }

  async countShownSince(userId: string, kind: NotificationKind, fromLocalDate: string) {
    await tick();
    return this.logs.filter(
      (l) =>
        l.userId === userId &&
        l.kind === kind &&
        l.localDate >= fromLocalDate &&
        l.message &&
        (l.status === "pending" || l.status === "sent"),
    ).length;
  }

  async claim(entry: LogClaim) {
    await tick();
    // The unique (userId, dedupeKey) index.
    if (this.logs.some((l) => l.userId === entry.userId && l.dedupeKey === entry.dedupeKey)) return null;
    const id = `log${this.logs.length + 1}`;
    this.logs.push({ ...entry, id, status: "pending" });
    return id;
  }

  async finish(id: string, status: LogStatus, message: boolean) {
    await tick();
    const row = this.logs.find((l) => l.id === id);
    if (row) Object.assign(row, { status, message });
  }

  async loadWorkspaces(userId: string) {
    await tick();
    if (this.failFor.has(userId)) throw new Error("database unavailable");
    this.workspaceLoads += 1;
    return this.workspaces.get(userId) ?? [];
  }

  async todayPlan(userId: string) {
    await tick();
    return this.plans.has(userId) ? this.plans.get(userId)! : [];
  }

  async studyDays(userId: string) {
    await tick();
    return this.days.get(userId) ?? [];
  }

  async weekTotals(userId: string, today: string): Promise<WeeklyRecap> {
    await tick();
    this.weekReads.push({ userId, today });
    return this.weeks.get(userId) ?? { focusMinutes: 0, cards: 0, quizAnswers: 0, activeDays: 0 };
  }
}

export class FakeChannel implements NotificationChannel {
  devices = new Map<string, number>();
  sent: { userId: string; message: NotificationMessage }[] = [];
  /** Delivers to nobody (every device or address refused it). */
  failing = new Set<string>();
  /** Throws while delivering (a bug, a database error). */
  throwing = new Set<string>();
  /** Turned on but not deliverable right now (see NotificationChannel.standby). */
  waiting = new Map<string, "retry" | "wait">();

  constructor(readonly name = "fake") {}

  async reachable(userId: string) {
    await tick();
    return (this.devices.get(userId) ?? 0) > 0;
  }

  async standby(userId: string) {
    await tick();
    return this.waiting.get(userId) ?? null;
  }

  async deliver(userId: string, message: NotificationMessage) {
    await tick();
    this.sent.push({ userId, message });
    if (this.throwing.has(userId)) throw new Error(`${this.name} channel broke`);
    return { delivered: this.failing.has(userId) ? 0 : (this.devices.get(userId) ?? 0) };
  }
}

// ---- Workspace fixtures -------------------------------------------------------

export interface RowSpec {
  id: string;
  title: string;
  due: string;
  done?: boolean;
  exam?: boolean;
  course?: "bio" | "hist";
  hours?: number;
}

export function courseworkDatabase(rows: RowSpec[]): Database {
  return {
    id: "db1",
    name: "Coursework",
    properties: [
      { id: "title", name: "Assignment", type: "text" },
      { id: "due", name: "Due", type: "date" },
      {
        id: "status",
        name: "Status",
        type: "status",
        options: [
          { id: "todo", label: "To do" },
          { id: "done", label: "Done" },
        ],
      },
      {
        id: "course",
        name: "Course",
        type: "select",
        options: [
          { id: "bio", label: "Biology 101" },
          { id: "hist", label: "History 210" },
        ],
      },
      {
        id: "type",
        name: "Type",
        type: "select",
        options: [
          { id: "exam", label: "Exam" },
          { id: "hw", label: "Homework" },
        ],
      },
      { id: "hours", name: "Estimate (hours)", type: "number" },
    ],
    rows: rows.map(
      (r): DatabaseRow => ({
        id: r.id,
        cells: {
          title: r.title,
          due: r.due,
          status: r.done ? "done" : "todo",
          type: r.exam ? "exam" : "hw",
          ...(r.course ? { course: r.course } : {}),
          ...(r.hours !== undefined ? { hours: r.hours } : {}),
        },
      }),
    ),
    views: [{ id: "table", name: "Table", type: "table" }],
  };
}

export function semester(rows: RowSpec[]): Workspace {
  return {
    id: "ws1",
    name: "Fall semester",
    homePageId: "home",
    pages: [{ id: "home", title: "Home", blocks: [{ id: "v1", type: "database_view", databaseId: "db1", viewId: "table" }] }],
    databases: [courseworkDatabase(rows)],
  };
}

export function planItem(overrides: Partial<DailyStudyPlanItem> & { id: string; title: string }): DailyStudyPlanItem {
  return {
    kind: "task",
    mode: "finish",
    workspaceName: "Fall semester",
    section: "Home",
    target: { workspaceId: "ws1", pageId: "home", blockId: `b-${overrides.id}` },
    minutes: 20,
    reason: { code: "open_task" },
    completed: false,
    ...overrides,
  };
}
