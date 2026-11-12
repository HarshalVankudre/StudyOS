/**
 * Test helper for sync-sim.test.ts: seeded random concurrent histories of the
 * real engine against the real store and version service.
 *
 * WHAT A HISTORY CONTAINS (by configuration, see CONFIGS):
 *  - two or three editor tabs, on separate devices or sharing one browser's
 *    storage (drafts taken over, edits handed over to a tab that woke up);
 *  - typing, deleting, new blocks, moves, deletions, cell values, undo/redo;
 *  - flashcard reviews and quiz answers (the real re-run edits), text edits
 *    in cards and questions, grading-scheme edits, calendar-feed syncs;
 *  - the AI agent (a server-side strict merge from a stale snapshot) and
 *    server-side check-offs from the Today view;
 *  - per tab: replies lost after the save landed, offline for seconds or for
 *    ten minutes, requests frozen on their way that arrive later (also after
 *    the tab died), a tab frozen in the background;
 *  - tabs closed (goodbye), crashed (none), hidden and shown again (the
 *    back/forward cache), reopened, with drafts recovered;
 *  - a rolling deploy: saves and reads handled by instances of older builds
 *    (no save log, or the previous format), and drafts in older formats.
 *
 * WHAT IS CHECKED once everything has settled (every count must be 0):
 *  - every tab shows what the server has, and nothing is stuck unsaved;
 *  - every marker a student typed, IN ANY TAB, WHETHER OR NOT IT EVER REACHED
 *    THE SERVER, is in the final document, unless someone deleted it on
 *    purpose or a banner offered it back by its text (an `overwritten` or
 *    `unapplied` entry holding that very marker);
 *  - no marker is in one block twice; a marker in two blocks is a marked
 *    kept copy;
 *  - a marker deleted on purpose is not back, unless its block is a marked
 *    copy (or the block a copy belongs to), or a banner named that very item
 *    (`report.where`: brought back or kept; `overwritten` / `unapplied` for
 *    text that is not a block's), or an undo or redo restored it on purpose;
 *  - the value of a cell is the one set last (undo takes a write back), unless
 *    a banner named that cell with the lost value (`overwritten`, `unapplied`
 *    or `replaced`), and the tab whose saved value was replaced was told
 *    too, on its own screen;
 *  - every block and grading category created is there unless deleted on
 *    purpose; every calendar event is in the table exactly once;
 *  - every flashcard review and quiz answer made is recorded exactly once,
 *    and the card's schedule is the one that reviewing in time order gives;
 *  - the final document is valid and has no duplicate ids.
 */
import { applyFeedEvents } from "@/lib/feeds/sync";
import { scheduleOf } from "@/lib/study/review-log";
import { RUN_RESULTS_REPLAY, applyRunResults, runResultsReplay, runResultsReplayer } from "@/lib/study/quiz";
import type { Grade } from "@/lib/study/srs";
import * as store from "@/lib/workspace/store";
import { deepEqual, diff, pathKey } from "@/lib/workspace/changes";
import { safeParseWorkspace } from "@/lib/workspace/schema";
import type { Block, Flashcard, Workspace } from "@/lib/workspace/types";
import { applyGrade, gradeOptions, gradeReplayer } from "../study/gradeEdit";
import { TAB_ALIVE_MS, draftKey } from "../workspace-sync";
import {
  MemoryStorage,
  Server,
  advance,
  crash,
  db,
  freeze,
  newNet,
  openTab,
  thaw,
  type Build,
  type Net,
  type Tab,
} from "./harness";

export interface SimConfig {
  tabs: 2 | 3;
  /** All tabs in one browser (true), on separate devices (false), or either (null). */
  sameDevice: boolean | null;
  agent?: boolean;
  feed?: boolean;
  checkoff?: boolean;
  grading?: boolean;
  cards?: boolean;
  offline?: boolean;
  freeze?: boolean;
  /** Tabs hidden and shown again (back/forward cache, a cancelled leave prompt). */
  comeBack?: boolean;
  /** A rolling deploy: requests handled by older builds; drafts in older formats. */
  deploy?: boolean;
  /** No faults at all (what merging alone does). */
  calm?: boolean;
}

export const CONFIGS: Record<string, SimConfig> = {
  "two devices": { tabs: 2, sameDevice: false, agent: true },
  "one browser": { tabs: 2, sameDevice: true, comeBack: true, freeze: true },
  "three tabs": { tabs: 3, sameDevice: null, agent: true, comeBack: true },
  "offline and frozen": { tabs: 3, sameDevice: null, offline: true, freeze: true, comeBack: true },
  "study edits": { tabs: 2, sameDevice: null, cards: true, grading: true, offline: true },
  "server writers": { tabs: 2, sameDevice: null, agent: true, feed: true, checkoff: true },
  "rolling deploy": { tabs: 2, sameDevice: null, deploy: true, offline: true, comeBack: true },
  "no faults": { tabs: 3, sameDevice: null, calm: true, cards: true, grading: true, feed: true, agent: true },
  everything: {
    tabs: 3,
    sameDevice: null,
    agent: true,
    feed: true,
    checkoff: true,
    grading: true,
    cards: true,
    offline: true,
    freeze: true,
    comeBack: true,
    deploy: true,
  },
};

/** Counts that must all be zero. */
export interface SimFailures {
  diverged: number;
  stuck: number;
  lostTyped: number;
  lostBlock: number;
  dupInBlock: number;
  dupUnmarked: number;
  resurrectedSilent: number;
  valueLostUntold: number;
  replacedUntold: number;
  reviewsWrong: number;
  answersWrong: number;
  feedDup: number;
  lostCategory: number;
  invalidDoc: number;
}

export interface SimStats {
  histories: number;
  steps: number;
  failures: SimFailures;
  /** What the histories exercised (to see that a zero is not a gap). */
  coverage: Record<string, number>;
  examples: string[];
}

export function emptyStats(): SimStats {
  return {
    histories: 0,
    steps: 0,
    failures: {
      diverged: 0,
      stuck: 0,
      lostTyped: 0,
      lostBlock: 0,
      dupInBlock: 0,
      dupUnmarked: 0,
      resurrectedSilent: 0,
      valueLostUntold: 0,
      replacedUntold: 0,
      reviewsWrong: 0,
      answersWrong: 0,
      feedDup: 0,
      lostCategory: 0,
      invalidDoc: 0,
    },
    coverage: {},
    examples: [],
  };
}

/** mulberry32 */
function rng(seed: number) {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const MARK = /\[[A-Z]+\d+\]/g;
const GRADE_NAMES: Grade[] = ["again", "hard", "good", "easy"];

type Loose = Record<string, unknown>;
const loose = (v: unknown) => v as Loose;
const textOf = (b: Block): string | null => {
  const text = loose(b).text;
  return typeof text === "string" ? text : null;
};
const json = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

function initial(): Workspace {
  return {
    id: "w1",
    name: "W",
    pages: [
      {
        id: "p1",
        title: "Home",
        blocks: [
          { id: "b1", type: "paragraph", text: "the cell is the unit of life" },
          { id: "b2", type: "paragraph", text: "energy flows and matter cycles" },
          { id: "b3", type: "todo", text: "read chapter three", checked: false },
        ],
      },
      {
        id: "p2",
        title: "Cards",
        blocks: [
          { id: "deck", type: "flashcards", cards: [{ id: "c1", front: "what is a cell", back: "the unit of life" }] },
          { id: "quiz", type: "quiz", questions: [{ id: "q1", kind: "true_false", prompt: "cells are alive", answerBool: true }] },
        ],
      },
    ],
    databases: [
      {
        id: "d1",
        name: "T",
        properties: [
          { id: "n", name: "N", type: "text" },
          { id: "x", name: "X", type: "number" },
          { id: "due", name: "Due", type: "date" },
        ],
        rows: [
          { id: "r1", cells: { n: "row one", x: 0 } },
          { id: "r2", cells: { n: "row two", x: 0 } },
        ],
        views: [{ id: "v1", name: "All", type: "table" }],
      },
    ],
  } as unknown as Workspace;
}

interface Place {
  marker: string;
  /** The item holding it: a block, card, question, row or category id. */
  item: string;
  /** In a block marked as a kept copy. */
  kept: boolean;
}

const marksIn = (text: unknown): string[] => (typeof text === "string" ? (text.match(MARK) ?? []) : []);

function places(w: Workspace): Place[] {
  const out: Place[] = [];
  const add = (text: unknown, item: string, kept = false) => {
    for (const marker of marksIn(text)) out.push({ marker, item, kept });
  };
  for (const p of w.pages) {
    for (const b of p.blocks) {
      add(textOf(b), b.id, Boolean(loose(b).keptFrom));
      if (b.type === "flashcards") for (const c of b.cards) add(c.front, c.id);
      if (b.type === "quiz") for (const q of b.questions) add(q.prompt, q.id);
    }
  }
  for (const d of w.databases) {
    for (const r of d.rows) add(r.cells.n, r.id);
    for (const c of d.grading?.categories ?? []) add(c.name, c.id);
  }
  return out;
}
const markersOf = (w: Workspace) => places(w).map((p) => p.marker);
const cellOf = (w: Workspace, row: string) => w.databases[0]?.rows.find((r) => r.id === row)?.cells.x;
const cardOf = (w: Workspace): Flashcard | undefined => {
  const deck = w.pages[1]?.blocks.find((b) => b.id === "deck");
  return deck?.type === "flashcards" ? deck.cards.find((c) => c.id === "c1") : undefined;
};
const questionOf = (w: Workspace) => {
  const quiz = w.pages[1]?.blocks.find((b) => b.id === "quiz");
  return quiz?.type === "quiz" ? quiz.questions.find((q) => q.id === "q1") : undefined;
};
const CARD = { pageId: "p2", blockId: "deck", cardId: "c1" };

/** One random history of `config`; adds to `stats`. */
export async function runHistory(index: number, seed: number, config: SimConfig, stats: SimStats): Promise<void> {
  const rnd = rng(seed * 100_003 + index);
  const pick = <T>(a: readonly T[]): T => a[Math.floor(rnd() * a.length)];
  const chance = (p: number) => rnd() < p;
  const cover = (k: string, n = 1) => (stats.coverage[k] = (stats.coverage[k] ?? 0) + n);

  const start = initial();
  const server = new Server(start);
  const trace = process.env.SYNC_SIM_TRACE === String(index);
  server.trace = trace;
  const say = (what: string) => {
    if (trace) console.info(`STEP t=${Date.now() % 1e7} ${what}`);
  };
  /** Every version the server held, when, and which tab's save produced it ("" when not an editor's). */
  const versions: Array<{ doc: Workspace; at: number; by: string }> = [{ doc: server.doc(), at: Date.now(), by: "" }];
  db.onWrite = (row) => versions.push({ doc: JSON.parse(String(row.data)) as Workspace, at: Date.now(), by: server.writer });

  const names = ["A", "B", "C"].slice(0, config.tabs);
  const storages = names.map(() => new MemoryStorage());
  const sameDevice = config.sameDevice ?? chance(0.35);
  const storageOf = (i: number) => (sameDevice ? storages[0] : storages[i]);
  const generation = names.map(() => 0);
  const nets: Net[] = names.map(() => newNet());
  /** Every tab ever opened, by name, with what it showed. */
  const everyTab = new Map<string, Tab>();
  const nameOf = (i: number) => `sim-tab-${names[i]}-${generation[i]}`;
  const replayers = { grade: gradeReplayer, [RUN_RESULTS_REPLAY]: runResultsReplayer };
  const makeTab = (i: number): Tab => {
    const tab = openTab(server, { storage: storageOf(i), tabId: nameOf(i), net: nets[i], deps: { replayers } });
    everyTab.set(tab.tabId, tab);
    return tab;
  };

  let counter = 0;
  /** marker -> the tab that typed it, and when. */
  const typed = new Map<string, { tab: string; at: number }>();
  /** marker -> who deleted it on purpose -> when (first time). */
  const deletions = new Map<string, Map<string, number>>();
  // Counted: a word a tab deleted twice (it showed again after the tab's
  // edits were taken over while it was silent) and undid once stays deleted.
  const deleteCount = new Map<string, number>();
  const markDeleted = (m: string, who: string) => {
    const by = deletions.get(m) ?? new Map<string, number>();
    if (!by.has(who)) by.set(who, Date.now());
    deletions.set(m, by);
    deleteCount.set(`${m}@${who}`, (deleteCount.get(`${m}@${who}`) ?? 0) + 1);
  };
  const unmarkDeleted = (m: string, who: string) => {
    const left = (deleteCount.get(`${m}@${who}`) ?? 0) - 1;
    deleteCount.set(`${m}@${who}`, Math.max(0, left));
    if (left <= 0) deletions.get(m)?.delete(who);
  };
  /** marker -> who brought it back on purpose (undo/redo) -> when (every time). */
  const restoredBy = new Map<string, Map<string, number[]>>();
  const createdBlocks = new Set<string>();
  /** block -> who deleted it on purpose (a person: undoing takes back only one's own deletion). */
  const blockDeleters = new Map<string, Set<string>>();
  const deletedBlocks = {
    add: (id: string, person: string) => void blockDeleters.set(id, (blockDeleters.get(id) ?? new Set<string>()).add(person)),
    delete: (id: string, person: string) => void blockDeleters.get(id)?.delete(person),
    has: (id: string) => (blockDeleters.get(id)?.size ?? 0) > 0,
  };
  /** row -> every value written on purpose: by which tab, when (undone ones are taken out). */
  const writes = new Map<string, Array<{ value: unknown; tab: string; at: number }>>();
  const withdrawn = new Map<string, Array<{ value: unknown; tab: string }>>();
  const noteWrite = (row: string, value: unknown, tab: string) =>
    writes.set(row, [...(writes.get(row) ?? []), { value, tab, at: Date.now() }]);
  /** An undo (or a redo) changed a cell from `was` to `now` in `tab`. */
  const noteUndone = (row: string, was: unknown, now: unknown, tab: string, isUndo: boolean) => {
    // (By person: a tab undoes what it recovered from that person's closed tab.)
    const person = (name: string) => name.split("-")[2];
    const list = writes.get(row) ?? [];
    if (!isUndo) {
      // Redo makes a write again (it is what the student wants as of now).
      withdrawn.set(row, (withdrawn.get(row) ?? []).filter((w) => w.value !== now));
      noteWrite(row, now, tab);
      return;
    }
    // Undo takes writes back: the one that set `was`, and those the same
    // person made before it since the cell held `now` (one undo step can hold
    // several: a tab undoing what it recovered from another tab's draft).
    const iWas = list.map((w) => w.value).lastIndexOf(was);
    if (iWas < 0) return;
    const owner = person(list[iWas].tab);
    const iNow = list.slice(0, iWas).map((w) => w.value).lastIndexOf(now);
    const gone = list.filter((w, i) => i > iNow && i <= iWas && person(w.tab) === owner);
    writes.set(row, list.filter((w) => !gone.includes(w)));
    withdrawn.set(row, [...(withdrawn.get(row) ?? []), ...gone.map((w) => ({ value: w.value, tab: w.tab }))]);
  };
  const reviews: Array<{ grade: Grade; at: Date }> = [];
  const answers: Array<{ at: string; correct: boolean }> = [];
  // Undo takes a review or an answer back (in part, when others were merged
  // in since): then only "nothing counted twice" can be checked for it.
  let reviewsUndone = false;
  let answersUndone = false;
  const addedCategories = new Set<string>();
  /** category -> who removed it on purpose (undo takes back only one's own removal). */
  const categoryRemovers = new Map<string, Set<string>>();
  const removedCategories = {
    add: (id: string, person: string) => void categoryRemovers.set(id, (categoryRemovers.get(id) ?? new Set<string>()).add(person)),
    delete: (id: string, person: string) => void categoryRemovers.get(id)?.delete(person),
    has: (id: string) => (categoryRemovers.get(id)?.size ?? 0) > 0,
  };
  let feedEvents: Array<Record<string, unknown>> = [];
  const feedSeen = new Set<string>();
  let agent: { base: Workspace; apply: (fn: (d: Workspace) => void) => Promise<unknown> } | null = null;
  let agentOwner = -1;

  // A deploy in progress leaves drafts written by earlier builds behind.
  if (config.deploy && chance(0.5)) {
    counter += 1;
    const m = `[O${counter}]`;
    typed.set(m, { tab: "old-build", at: Date.now() });
    const mine = json(start);
    loose(mine.pages[0].blocks[0]).text = `${textOf(start.pages[0].blocks[0])} ${m}`;
    const version = pick([2, 3] as const);
    storages[0].setItem(
      draftKey("w1", "oldbuildtab1"),
      JSON.stringify({
        v: version,
        id: "w1",
        tabId: "oldbuildtab1",
        baseVersion: 1,
        savedAt: Date.now(),
        ops: diff(start, mine),
        ctx: { ".pages#p1.blocks#b1": { item: mine.pages[0].blocks[0], prev: null } },
        ...(version === 3 && chance(0.5) ? { sends: [{ saveId: "oldbuildsave1", ops: [] }] } : {}),
      }),
    );
    cover("oldFormatDrafts");
  }

  const tabs: Array<Tab | null> = names.map((_, i) => makeTab(i));

  const steps = 25 + Math.floor(rnd() * 45);
  for (let step = 0; step < steps; step += 1) {
    stats.steps += 1;
    const ti = Math.floor(rnd() * config.tabs);
    const tab = tabs[ti];
    if (!tab) continue;
    const net = nets[ti];
    if (net.frozen) {
      // The student comes back to a frozen tab: it wakes.
      if (chance(0.5)) {
        thaw(net);
        tab.heartbeat();
        void tab.checkRemote();
      } else continue;
    }
    const who = names[ti];
    const self = tab.tabId;
    // The tab the student acts in is shown; background tabs of a desktop say
    // they are alive now and then, a phone's do not.
    tab.heartbeat();
    if (!sameDevice) for (const t of tabs) if (t && t !== tab && chance(0.3)) t.heartbeat();
    const ws = tab.workspace;
    const r = rnd();
    const textBlocks = ws.pages[0].blocks.filter((b) => textOf(b) !== null);

    if (r < 0.2 && textBlocks.length) {
      const block = pick(textBlocks);
      counter += 1;
      const m = `[${who}${counter}]`;
      typed.set(m, { tab: self, at: Date.now() });
      const words = (textOf(block) ?? "").split(" ");
      words.splice(Math.floor(rnd() * (words.length + 1)), 0, m);
      const text = words.join(" ");
      say(`${self} types ${m} in ${block.id}`);
      tab.update((d) => {
        const x = d.pages[0].blocks.find((y) => y.id === block.id);
        if (x && textOf(x) !== null) loose(x).text = text;
      }, `f-${block.id}`);
    } else if (r < 0.26) {
      const ms = markersOf(ws);
      if (ms.length) {
        const m = pick(ms);
        markDeleted(m, self);
        say(`${self} deletes ${m}`);
        const strip = (t: string) => t.replace(` ${m}`, "").replace(`${m} `, "").replace(m, "");
        tab.update((d) => {
          for (const p of d.pages) {
            for (const x of p.blocks) {
              const t = textOf(x);
              if (t !== null) loose(x).text = strip(t);
              if (x.type === "flashcards") for (const c of x.cards) c.front = strip(c.front);
              if (x.type === "quiz") for (const q of x.questions) q.prompt = strip(q.prompt);
            }
          }
          for (const database of d.databases) {
            for (const row of database.rows) if (typeof row.cells.n === "string") row.cells.n = strip(row.cells.n);
            for (const c of database.grading?.categories ?? []) c.name = strip(c.name) || "x";
          }
        });
      }
    } else if (r < 0.32) {
      counter += 1;
      const id = `${who.toLowerCase()}blk${counter}`;
      const m = `[${who}${counter}]`;
      typed.set(m, { tab: self, at: Date.now() });
      createdBlocks.add(id);
      const pos = Math.floor(rnd() * (ws.pages[0].blocks.length + 1));
      say(`${self} adds block ${id} ${m}`);
      tab.update((d) => void d.pages[0].blocks.splice(pos, 0, { id, type: "paragraph", text: `new ${m}` } as Block));
    } else if (r < 0.35) {
      const blocks = ws.pages[0].blocks;
      if (blocks.length > 1) {
        const block = pick(blocks);
        deletedBlocks.add(block.id, who);
        say(`${self} deletes block ${block.id}`);
        for (const m of marksIn(textOf(block))) markDeleted(m, self);
        tab.update((d) => void (d.pages[0].blocks = d.pages[0].blocks.filter((x) => x.id !== block.id)));
      }
    } else if (r < 0.38) {
      const blocks = ws.pages[0].blocks;
      if (blocks.length > 1) {
        const id = blocks[Math.floor(rnd() * blocks.length)].id;
        const to = Math.floor(rnd() * blocks.length);
        tab.update((d) => {
          const arr = d.pages[0].blocks;
          const i = arr.findIndex((x) => x.id === id);
          if (i < 0) return;
          const [x] = arr.splice(i, 1);
          arr.splice(Math.min(to, arr.length), 0, x);
        });
      }
    } else if (r < 0.45) {
      const row = pick(["r1", "r2"]);
      counter += 1;
      const value = counter * 10 + ti;
      if (ws.databases[0]?.rows.some((x) => x.id === row)) {
        noteWrite(row, value, self);
        say(`${self} sets ${row}=${value}`);
        tab.update((d) => {
          const x = d.databases[0].rows.find((y) => y.id === row);
          if (x) x.cells.x = value;
        });
      }
    } else if (r < 0.5) {
      // A flashcard review: the real edit, keyed by the moment of the answer.
      if (reviews.length < 7 && cardOf(ws)) {
        counter += 1;
        const at = new Date(Date.now() + counter);
        const grade = pick(GRADE_NAMES);
        reviews.push({ grade, at });
        say(`${self} reviews ${grade}`);
        tab.update((d) => applyGrade(d, CARD, grade, at), gradeOptions(CARD, grade, at));
      }
    } else if (r < 0.53) {
      // A quiz run: one answer to q1.
      counter += 1;
      const at = new Date(Date.now() + counter).toISOString();
      const correct = chance(0.5);
      if (answers.length < 12) {
        answers.push({ at, correct });
        say(`${self} answers ${correct} at ${at}`);
        const results = [{ pageId: "p2", blockId: "quiz", questionId: "q1", key: "k", correct }];
        tab.update((d) => applyRunResults(d, results, undefined, at), {
          rebase: "rerun",
          replay: runResultsReplay(results, undefined, at),
        });
      }
    } else if (r < 0.58 && config.cards) {
      // Text in a card, a question, a row's name; or a new card.
      counter += 1;
      const m = `[${who}${counter}]`;
      const k = rnd();
      const n = counter;
      const before = markersOf(tab.workspace).length;
      say(`${self} card/quiz/row text ${m}`);
      tab.update((d) => {
        const deck = d.pages[1]?.blocks.find((x) => x.id === "deck");
        const quiz = d.pages[1]?.blocks.find((x) => x.id === "quiz");
        if (k < 0.3 && deck?.type === "flashcards" && deck.cards.length) {
          const c = deck.cards[Math.floor(k * 100) % deck.cards.length];
          c.front = `${c.front} ${m}`;
        } else if (k < 0.5 && deck?.type === "flashcards") deck.cards.push({ id: `card${n}`, front: `card ${m}`, back: "b" });
        else if (k < 0.75 && quiz?.type === "quiz" && quiz.questions.length) quiz.questions[0].prompt = `${quiz.questions[0].prompt} ${m}`;
        else {
          const row = d.databases[0]?.rows[Math.floor(k * 100) % Math.max(1, d.databases[0].rows.length)];
          if (row && typeof row.cells.n === "string") row.cells.n = `${row.cells.n} ${m}`;
        }
      });
      if (markersOf(tab.workspace).length > before) typed.set(m, { tab: self, at: Date.now() });
    } else if (r < 0.63 && config.grading) {
      counter += 1;
      const k = rnd();
      const n = counter;
      const m = `[${who}${counter}]`;
      const has = (ws.databases[0]?.grading?.categories.length ?? 0) > 0;
      say(`${self} grading k=${k.toFixed(2)} ${m}`);
      if (k < 0.45 || !has) {
        const id = `cat-${who}${n}`;
        addedCategories.add(id);
        typed.set(m, { tab: self, at: Date.now() });
        tab.update((d) => {
          const database = d.databases[0];
          database.grading ??= { categories: [] };
          database.grading.categories.push({ id, course: "*", name: `Cat ${m}`, weight: 10 });
        });
      } else if (k < 0.7) {
        tab.update((d) => {
          const cats = d.databases[0].grading?.categories ?? [];
          if (cats.length) cats[Math.floor(k * 100) % cats.length].weight = (n % 90) + 1;
        });
      } else if (k < 0.85) {
        const row = pick(["r1", "r2"]);
        tab.update((d) => {
          const grading = d.databases[0].grading;
          if (grading?.categories.length) grading.assign = { ...(grading.assign ?? {}), [row]: grading.categories[0].id };
        });
      } else {
        const cats = ws.databases[0]?.grading?.categories ?? [];
        const c = cats[cats.length - 1];
        if (c) {
          removedCategories.add(c.id, who);
          for (const mm of marksIn(c.name)) markDeleted(mm, self);
          tab.update((d) => {
            const grading = d.databases[0].grading;
            if (!grading) return;
            grading.categories = grading.categories.filter((x) => x.id !== c.id);
            for (const [row, id] of Object.entries(grading.assign ?? {})) if (id === c.id) delete grading.assign![row];
          });
        }
      }
    } else if (r < 0.69) {
      const before = tab.workspace;
      const isUndo = chance(0.7);
      const did = isUndo ? tab.undo() : tab.redo();
      say(`${self} ${isUndo ? "undo" : "redo"} ${did}`);
      if (did) {
        cover("undoRedo");
        const after = tab.workspace;
        const ma = markersOf(after);
        const mb = markersOf(before);
        for (const m of mb) if (!ma.includes(m)) markDeleted(m, self);
        for (const m of ma) {
          if (mb.includes(m)) continue;
          unmarkDeleted(m, self);
          const by = restoredBy.get(m) ?? new Map<string, number[]>();
          restoredBy.set(m, by.set(who, [...(by.get(who) ?? []), Date.now()]));
        }
        for (const x of before.pages[0].blocks) if (!after.pages[0].blocks.some((y) => y.id === x.id)) deletedBlocks.add(x.id, who);
        for (const x of after.pages[0].blocks) if (!before.pages[0].blocks.some((y) => y.id === x.id)) deletedBlocks.delete(x.id, who);
        for (const row of after.databases[0]?.rows ?? []) {
          if (cellOf(before, row.id) !== row.cells.x) noteUndone(row.id, cellOf(before, row.id), row.cells.x, self, isUndo);
        }
        if (!deepEqual(cardOf(before), cardOf(after))) reviewsUndone = true;
        if (!deepEqual(questionOf(before)?.stats, questionOf(after)?.stats)) answersUndone = true;
        const catsAfter = new Set((after.databases[0]?.grading?.categories ?? []).map((c) => c.id));
        const catsBefore = new Set((before.databases[0]?.grading?.categories ?? []).map((c) => c.id));
        for (const id of catsBefore) if (!catsAfter.has(id)) removedCategories.add(id, who);
        for (const id of catsAfter) if (!catsBefore.has(id)) removedCategories.delete(id, who);
      }
    } else if (r < 0.73 && config.agent) {
      if (!agent) {
        agent = await server.agentStart();
        agentOwner = ti;
        tab.setAgentBusy(true);
        cover("agentTasks");
      } else {
        const base = agent.base;
        const candidates = base.pages[0].blocks.filter((x) => textOf(x) !== null);
        const block = candidates.length ? pick(candidates) : null;
        counter += 1;
        const m = `[G${counter}]`;
        const kind = rnd();
        const n = counter;
        try {
          await agent.apply((d) => {
            if (kind < 0.5 && block) {
              const x = d.pages[0].blocks.find((y) => y.id === block.id);
              if (x && textOf(x) !== null) loose(x).text = `${textOf(x)} ${m}`;
            } else if (kind < 0.8) d.pages[0].blocks.push({ id: `gblk${n}`, type: "paragraph", text: `agent ${m}` } as Block);
            else {
              const x = d.databases[0].rows.find((y) => y.id === "r1");
              if (x) x.cells.x = n * 10 + 7;
            }
          });
          if (kind < 0.5 && block) typed.set(m, { tab: "agent", at: Date.now() });
          else if (kind < 0.8) {
            typed.set(m, { tab: "agent", at: Date.now() });
            createdBlocks.add(`gblk${n}`);
          } else if (base.databases[0].rows.some((y) => y.id === "r1")) noteWrite("r1", n * 10 + 7, "agent");
        } catch {
          // Refused: the agent's turn is lost, as in the app (the student is told).
          cover("agentRefused");
        }
        tabs[agentOwner]?.setAgentBusy(false);
        agent = null;
      }
    } else if (r < 0.77 && config.feed) {
      // A calendar sync in this tab: a re-run edit with deterministic ids.
      if (feedEvents.length === 0 || chance(0.4)) {
        counter += 1;
        feedEvents = [...feedEvents, { key: `ev${counter}@lms`, title: `Lab ${counter}`, when: { date: "2026-12-01" }, role: "deadline" }];
      }
      const events = json(feedEvents);
      const options = {
        databaseId: "d1",
        feedId: "feed1",
        mapping: { title: "n", due: "due" },
        today: "2026-11-12",
        timeZone: "UTC",
        mode: "sync",
        seen: new Set(feedSeen),
        newColumns: { due: { id: "nd", name: "Due" }, course: { id: "nc", name: "Course" }, link: { id: "nl", name: "Link" } },
      } as unknown as Parameters<typeof applyFeedEvents>[2];
      tab.update((d) => void applyFeedEvents(d, events as unknown as Parameters<typeof applyFeedEvents>[1], options), {
        coalesceKey: null,
        rebase: "rerun",
      });
      for (const e of events) feedSeen.add(String(e.key));
      cover("feedSyncs");
    } else if (r < 0.8 && config.checkoff) {
      // The Today view checks the to-do off (server-side, version-checked).
      const value = chance(0.7);
      try {
        await store.updateWorkspaceWith("w1", (d) => {
          const todo = d.pages[0].blocks.find((x) => x.id === "b3");
          if (!todo || loose(todo).checked === value) return { changed: false, result: null };
          loose(todo).checked = value;
          return { changed: true, result: null };
        });
        cover("checkoffs");
      } catch {
        // ignore
      }
    } else if (r < 0.86 && !config.calm) {
      const f = rnd();
      say(`fault ${self} f=${f.toFixed(2)}`);
      if (f < 0.3) {
        net.dropReplies += 1;
        cover("lostReplies");
      } else if (f < 0.5 && config.offline) {
        net.offline = true;
        const length = chance(0.5) ? 5_000 : 600_000; // a short drop, or ten minutes on the train
        setTimeout(() => {
          net.offline = false;
        }, length);
        cover("offlinePeriods");
      } else if (f < 0.7 && config.freeze) {
        // Requests stall on their way (and the tab shows no sign of life):
        // they arrive when it thaws, or after the tab is gone.
        freeze(net);
        cover("freezes");
      } else if (f < 0.9 && config.deploy) {
        // For a while this tab's requests reach instances of an older build.
        const build: Build = chance(0.5) ? "noLog" : "round3";
        if (chance(0.7)) net.saveBuild = build;
        if (chance(0.5)) net.readBuild = build;
        setTimeout(
          () => {
            net.saveBuild = "current";
            net.readBuild = "current";
          },
          chance(0.5) ? 3_000 : 30_000,
        );
        cover("oldBuildPeriods");
      } else {
        net.dropReplies += 1;
        cover("lostReplies");
      }
    } else if (r < 0.9) {
      if (config.comeBack && chance(0.35)) {
        // Hidden and shown again: pagehide (write, save, goodbye), then back.
        say(`${self} hidden and shown again`);
        tab.prepareToLeave();
        tab.releaseTab();
        await advance(Math.floor(rnd() * 20_000));
        tab.heartbeat();
        void tab.checkRemote();
        cover("comeBacks");
        continue;
      }
      const closed = chance(0.6);
      say(`${self} ${closed ? "closes" : "crashes"}`);
      cover(closed ? "closes" : "crashes");
      if (closed) tab.prepareToLeave();
      // Whatever it had on the wire may still arrive (now or later), or never.
      const frozenRequests = Boolean(net.frozen);
      if (frozenRequests && chance(0.5)) {
        const dead = net;
        setTimeout(() => thaw(dead), Math.floor(rnd() * 200_000));
        cover("requestsArrivingAfterDeath");
      }
      await advance(Math.floor(rnd() * 300));
      if (agentOwner === ti) agent = null;
      if (trace) {
        const left = storageOf(ti).getItem(draftKey("w1", tab.tabId));
        const draft = left ? (JSON.parse(left) as { ops: Array<{ op: string; path: unknown[] }>; replays?: unknown[]; replayKeys?: string[]; sends?: unknown[] }) : null;
        console.info(
          `DRAFT of ${self}: ${draft ? JSON.stringify({ ops: draft.ops.map((o) => `${o.op}${pathKey(o.path as never)}`), replays: draft.replays?.length ?? 0, replayKeys: draft.replayKeys, sends: draft.sends?.length ?? 0 }) : "none"}`,
        );
      }
      crash(tab, closed);
      tabs[ti] = null;
      await advance(chance(0.5) ? 100_000 : 1_000);
      generation[ti] += 1;
      nets[ti] = newNet();
      tabs[ti] = makeTab(ti);
    } else {
      await advance(Math.floor(rnd() * 3_000));
      if (chance(0.5)) for (const t of tabs) void t?.checkRemote();
    }
    if (chance(0.3)) await advance(Math.floor(rnd() * 1_200));
  }

  // Quiesce: the network heals, every tab is shown, everything is retried.
  for (const n of nets) {
    n.offline = false;
    n.dropReplies = 0;
    n.saveBuild = "current";
    n.readBuild = "current";
    thaw(n);
  }
  if (agent) tabs[agentOwner]?.setAgentBusy(false);
  for (let round = 0; round < 6; round += 1) {
    for (const t of tabs) {
      if (!t) continue;
      t.heartbeat();
      if (t.getSnapshot().conflict) {
        cover("lastResortConflicts");
        t.resolveConflict("mine");
      }
      t.retry();
      await advance(20_000);
      await t.checkRemote();
      t.adoptOrphans();
    }
    await advance(TAB_ALIVE_MS + 40_000);
    for (const t of tabs) t?.adoptOrphans();
    await advance(120_000);
  }

  // ---- the checks ------------------------------------------------------------
  const final = server.doc();
  const notes: string[] = [];
  const fail = (kind: keyof SimFailures, note: string) => {
    stats.failures[kind] += 1;
    notes.push(note);
  };
  const banners = [...everyTab.values()].flatMap((t) => t.banners.map((x) => ({ tab: t.tabId, ...x })));
  for (const x of banners) cover(`banner:${x.merge.source}`);
  for (const t of everyTab.values()) if (t.notices.includes("draftRestored")) cover("draftsRecovered");
  /** A banner offered `text` back by its value. */
  const offered = (marker: string, since: number) =>
    banners.some(
      (x) =>
        x.at >= since &&
        [...x.merge.report.overwritten, ...x.merge.report.unapplied, ...x.merge.replaced].some(
          (o) => JSON.stringify(o.mine ?? null).includes(marker) || JSON.stringify(o.theirs ?? null).includes(marker),
        ),
    );

  for (const t of tabs) {
    if (!t) continue;
    if (!deepEqual(t.workspace, final) || t.getSnapshot().dirty) {
      const where = diff(final, t.workspace).slice(0, 3).map((o) => `${o.op}${pathKey(o.path)}`);
      fail("diverged", `DIVERGED ${t.tabId} status=${t.getSnapshot().status} dirty=${t.getSnapshot().dirty} at ${where.join(" ")}`);
      break;
    }
  }
  for (const t of tabs) if (t && t.getSnapshot().status !== "saved") fail("stuck", `STUCK ${t.tabId} ${t.getSnapshot().status}`);

  if (!safeParseWorkspace(final).success) fail("invalidDoc", "INVALID final document");
  for (const list of [final.pages[0].blocks, final.databases[0]?.rows ?? [], final.databases[0]?.grading?.categories ?? []]) {
    const ids = list.map((x) => x.id);
    if (new Set(ids).size !== ids.length) fail("invalidDoc", `DUPLICATE-IDS ${ids.join(",")}`);
  }

  const finalPlaces = places(final);
  const keptPairs = new Set(final.pages.flatMap((p) => p.blocks.map((x) => loose(x).keptFrom).filter(Boolean)));
  const everOnServer = new Set(versions.flatMap((v) => markersOf(v.doc)));

  // Everything typed, in any tab, whether or not it ever reached the server.
  for (const [m, by] of typed) {
    const n = finalPlaces.filter((p) => p.marker === m).length;
    const deleted = (deletions.get(m)?.size ?? 0) > 0;
    if (n > 0 || deleted) continue;
    if (offered(m, by.at)) {
      cover("typedOfferedBack");
      continue;
    }
    fail("lostTyped", `LOST-TYPED ${m} by ${by.tab}${everOnServer.has(m) ? "" : " (never reached the server)"}`);
  }
  for (const id of createdBlocks) {
    if (deletedBlocks.has(id) || final.pages[0].blocks.some((x) => x.id === id)) continue;
    fail("lostBlock", `LOST-BLOCK ${id}`);
  }

  for (const m of new Set(finalPlaces.map((p) => p.marker))) {
    const ps = finalPlaces.filter((p) => p.marker === m);
    const perItem = new Map<string, number>();
    for (const p of ps) perItem.set(p.item, (perItem.get(p.item) ?? 0) + 1);
    if ([...perItem.values()].some((n) => n > 1)) fail("dupInBlock", `DUP-IN-BLOCK ${m}`);
    if (ps.length > 1) {
      cover("markersInKeptCopies");
      if (ps.filter((p) => !p.kept).length > 1) fail("dupUnmarked", `DUP-UNMARKED ${m} in ${ps.map((p) => p.item).join(",")}`);
    }
    const dels = deletions.get(m);
    if (dels && dels.size > 0) {
      const first = Math.min(...dels.values());
      // Back on purpose: the save that brought it back (the last time it went
      // from absent to present) was made by the person whose undo or redo
      // restored it.
      let broughtBackBy = "";
      let broughtBackAt = 0;
      versions.forEach((v, i) => {
        if (i > 0 && markersOf(v.doc).includes(m) && !markersOf(versions[i - 1].doc).includes(m)) {
          broughtBackBy = v.by.split("-")[2] ?? "";
          broughtBackAt = v.at;
        }
      });
      // ...or an undo or redo restored it after the deletion (the save may
      // then come from another tab, one that recovered that tab's draft).
      const takenBack =
        (restoredBy.get(m)?.get(broughtBackBy) ?? []).some((at) => at <= broughtBackAt) ||
        [...(restoredBy.get(m)?.values() ?? [])].flat().some((at) => at >= first && at <= broughtBackAt);
      if (!takenBack && versions.some((v) => v.at >= first && !markersOf(v.doc).includes(m))) {
        cover("deletedMarkerPresentAtEnd");
        // Allowed: in a marked copy or the block a copy was kept next to, or
        // a banner named that very block as brought back or kept.
        // (For text that is not a block's, a card's front say, "kept" means the
        // student's version replaced the other one and the banner offers that back.)
        const named = (item: string) =>
          banners.some(
            (x) =>
              x.at >= first &&
              (x.merge.report.where.some(
                (w) => (w.kind === "restored" || w.kind === "keptDeleted" || w.kind === "keptBoth") && pathKey(w.path).includes(`#${item}`),
              ) ||
                [...x.merge.report.overwritten, ...x.merge.report.unapplied].some(
                  (o) => pathKey(o.path).includes(`#${item}`) && typeof o.mine === "string" && typeof o.theirs === "string",
                )),
          );
        const silent = ps.filter((p) => !p.kept && !keptPairs.has(p.item) && !named(p.item));
        if (silent.length > 0) fail("resurrectedSilent", `RESURRECTED-SILENT ${m} in ${silent.map((p) => p.item).join(",")}`);
      }
    }
  }
  cover("keptCopiesAtEnd", final.pages[0].blocks.filter((x) => loose(x).keptFrom).length);

  // A cell holds the value written last, or the lost one was named in a banner.
  for (const [row, list] of writes) {
    const value = cellOf(final, row);
    if (value === undefined || list.length === 0) continue; // the row is gone, or every write was undone
    const last = list[list.length - 1];
    if (value === last.value) continue;
    cover("olderValueWon");
    const names = (o: { path: unknown[]; mine: unknown; theirs: unknown }) =>
      pathKey(o.path as never).includes(`#${row}.cells.x`) && (o.mine === last.value || o.theirs === last.value);
    const told = banners.some(
      (x) =>
        x.at >= last.at &&
        [...x.merge.report.overwritten, ...x.merge.report.unapplied, ...x.merge.replaced].some(names),
    );
    if (!told) fail("valueLostUntold", `VALUE-LOST ${row}: ${String(last.value)} (by ${last.tab}) lost to ${String(value)}, nobody told`);
    // The tab that wrote the lost value, if it saved it and is still open, is told on its own screen.
    const writer = everyTab.get(last.tab);
    const stillOpen = writer && tabs.includes(writer);
    const reachedServer = versions.some((v) => v.at >= last.at && cellOf(v.doc, row) === last.value);
    if (stillOpen && reachedServer) {
      cover("replacedAfterSaving");
      const toldThere = banners.some(
        (x) =>
          x.tab === writer.tabId &&
          x.at >= last.at &&
          [...x.merge.replaced, ...x.merge.report.overwritten, ...x.merge.report.unapplied].some(names),
      );
      if (!toldThere) fail("replacedUntold", `REPLACED-UNTOLD ${row}: ${String(last.value)} of ${last.tab} was replaced by ${String(value)}`);
    }
  }

  // Reviews and answers: each exactly once, the schedule as in time order.
  const card = cardOf(final);
  if (card && reviews.length > 0) {
    cover("reviews", reviews.length);
    const logged = (card.reviews ?? []).map((x) => x.id).sort();
    const made = reviews.map((x) => x.at.toISOString()).sort();
    if (new Set(logged).size !== logged.length || logged.some((id) => !made.includes(id))) {
      fail("reviewsWrong", `REVIEWS logged twice or never made: ${logged.join(",")}`);
    } else if (!reviewsUndone) {
      const holder = json(start);
      for (const rv of [...reviews].sort((x, y) => x.at.getTime() - y.at.getTime())) applyGrade(holder, CARD, rv.grade, rv.at);
      if (!deepEqual(logged, made)) fail("reviewsWrong", `REVIEWS logged ${logged.length} of ${made.length}`);
      else if (!deepEqual(scheduleOf(card), scheduleOf(cardOf(holder)!))) {
        fail("reviewsWrong", "REVIEWS schedule differs from reviewing in time order");
      }
    }
  }
  const question = questionOf(final);
  if (question && answers.length > 0) {
    cover("answers", answers.length);
    const want = { attempts: answers.length, correct: answers.filter((x) => x.correct).length };
    const got = { attempts: question.stats?.attempts ?? 0, correct: question.stats?.correct ?? 0 };
    const wrong = answersUndone
      ? got.attempts > want.attempts || got.correct > want.correct
      : got.attempts !== want.attempts || got.correct !== want.correct;
    if (wrong) fail("answersWrong", `ANSWERS ${got.attempts}/${got.correct} want ${want.attempts}/${want.correct}`);
  }

  if (config.feed) {
    const keys = (final.databases[0]?.rows ?? []).map((x) => loose(x.source ?? {}).key).filter(Boolean) as string[];
    const twice = keys.filter((k, i) => keys.indexOf(k) !== i);
    if (twice.length) fail("feedDup", `FEED-DUP ${twice.join(",")}`);
  }
  if (config.grading) {
    const cats = new Set((final.databases[0]?.grading?.categories ?? []).map((c) => c.id));
    for (const id of addedCategories) {
      if (!cats.has(id) && !removedCategories.has(id)) fail("lostCategory", `LOST-CATEGORY ${id}`);
    }
  }

  if (trace) {
    for (const v of versions) {
      console.info(
        `V t=${v.at % 1e7} ${JSON.stringify(v.doc.pages[0].blocks.map((x) => `${x.id}:${textOf(x) ?? ""}${loose(x).keptFrom ? "(kept)" : ""}`))} x=${cellOf(v.doc, "r1")},${cellOf(v.doc, "r2")}`,
      );
    }
    for (const v of versions) {
      console.info(
        `G t=${v.at % 1e7} ${JSON.stringify(v.doc.databases[0]?.grading ?? null)} rows=${JSON.stringify(v.doc.databases[0]?.rows.map((x) => `${x.id}:${String(x.cells.n)}`))} card=${JSON.stringify((cardOf(v.doc)?.reviews ?? []).length)} q=${JSON.stringify(questionOf(v.doc)?.stats ?? null)}`,
      );
    }
    console.info(
      "BANNERS",
      JSON.stringify(
        banners.map((x) => ({
          tab: x.tab,
          at: x.at % 1e7,
          source: x.merge.source,
          where: x.merge.report.where.map((w) => `${w.kind}${pathKey(w.path)}`),
          overwritten: x.merge.report.overwritten.map((o) => pathKey(o.path)),
          unapplied: x.merge.report.unapplied.map((o) => pathKey(o.path)),
          replaced: x.merge.replaced.map((o) => pathKey(o.path)),
        })),
      ),
    );
    console.info("FINAL", JSON.stringify(final.pages[0].blocks.map((x) => `${x.id}:${textOf(x)}${loose(x).keptFrom ? "(kept)" : ""}`)));
    console.info("NOTES", notes);
  }

  stats.histories += 1;
  if (notes.length && stats.examples.length < 12) stats.examples.push(`#${index}: ${notes.slice(0, 5).join("; ")}`);
  for (const t of everyTab.values()) crash(t);
  db.onWrite = null;
}
