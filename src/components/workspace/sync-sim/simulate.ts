/**
 * Test helper for sync-sim.test.ts: seeded random concurrent histories.
 *
 * Two editor tabs (separate devices, or one device sharing localStorage), the
 * AI agent (a server-side strict merge from a stale snapshot), a re-run edit
 * (a flashcard grade), undo/redo, lost replies, failed saves and reads, and
 * crashes followed by draft recovery. Only the tab the student acts in says
 * it is alive (it is shown); the other sends no sign of life, as a phone
 * freezes a background tab, so a pause of 90 s makes it look closed and its
 * draft is taken over while it is in fact only asleep.
 *
 * At quiescence every tab must equal the server, and every unique marker,
 * block and cell value that ever reached the server is accounted for.
 */
import { deepEqual, type MergeReport } from "@/lib/workspace/changes";
import type { Block, Workspace } from "@/lib/workspace/types";
import type { WorkspaceSync } from "../workspace-sync";
import { MemoryStorage, Server, advance, crash, db, drain, openTab } from "./harness";

export interface SimStats {
  histories: number;
  steps: number;
  /** A tab that does not show what the server has once everything settled. */
  diverged: number;
  stuck: number;
  /** A marker that reached the server and vanished without anyone deleting it. */
  lostMarkers: number;
  /** A block that reached the server and vanished without anyone deleting it. */
  lostBlocks: number;
  /** The same marker twice inside one block (duplicated text). */
  dupInsideOneBlock: number;
  /** A marker in two blocks (a kept copy): fine when the student was told. */
  dupMarkers: number;
  dupUnreported: number;
  /** A marker deleted on purpose (and gone from the server) that came back. */
  resurrected: number;
  resurrectedUnreported: number;
  /** A value replaced on the server by a later deliberate write that came back, unreported. */
  staleValues: number;
  /** An older value won over a newer one (allowed: the student's version, reported). */
  overwroteNewer: number;
  overwroteNewerUnreported: number;
  gradeRuns: number;
  /** More reviews recorded than were made (a re-run edit applied twice). */
  gradeOver: number;
  /** Fewer: an older review of the same card from a tab that saved later. */
  gradeUnder: number;
  undoHistories: number;
  examples: string[];
}

export function emptyStats(): SimStats {
  return {
    histories: 0,
    steps: 0,
    diverged: 0,
    stuck: 0,
    lostMarkers: 0,
    lostBlocks: 0,
    dupInsideOneBlock: 0,
    dupMarkers: 0,
    dupUnreported: 0,
    resurrected: 0,
    resurrectedUnreported: 0,
    staleValues: 0,
    overwroteNewer: 0,
    overwroteNewerUnreported: 0,
    gradeRuns: 0,
    gradeOver: 0,
    gradeUnder: 0,
    undoHistories: 0,
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

type Loose = Record<string, unknown>;
const textOf = (b: Block): string | null => {
  const text = (b as unknown as Loose).text;
  return typeof text === "string" ? text : null;
};
const setTextOf = (b: Block, text: string) => {
  (b as unknown as Loose).text = text;
};
const cellX = (w: Workspace, row: string) => w.databases[0]?.rows.find((r) => r.id === row)?.cells.x;

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
      { id: "p2", title: "Cards", blocks: [{ id: "deck", type: "flashcards", cards: [{ id: "c1", front: "Q", back: "A" }] }] },
    ],
    databases: [
      {
        id: "d1",
        name: "T",
        properties: [
          { id: "n", name: "N", type: "text" },
          { id: "x", name: "X", type: "number" },
        ],
        rows: [
          { id: "r1", cells: { n: "row one", x: 0 } },
          { id: "r2", cells: { n: "row two", x: 0 } },
        ],
        views: [{ id: "v1", name: "All", type: "table" }],
      },
    ],
  } as Workspace;
}

const markersOf1 = (b: Block): string[] => textOf(b)?.match(MARK) ?? [];

function markersOf(w: Workspace): string[] {
  const out: string[] = [];
  for (const p of w.pages) for (const b of p.blocks) out.push(...(textOf(b)?.match(MARK) ?? []));
  return out;
}
const blockIds = (w: Workspace) => new Set(w.pages.flatMap((p) => p.blocks.map((b) => b.id)));

/** One random history; adds to `stats`. */
export async function runHistory(index: number, seed: number, stats: SimStats): Promise<void> {
  const rnd = rng(seed * 100_003 + index);
  const pick = <T>(a: readonly T[]): T => a[Math.floor(rnd() * a.length)];
  const chance = (p: number) => rnd() < p;

  const server = new Server(initial());
  const trace = process.env.SYNC_SIM_TRACE === String(index);
  server.trace = trace;
  const say = (what: string) => {
    if (trace) console.info(`STEP t=${Date.now() % 1e6} ${what}`);
  };
  const versions: Array<{ doc: Workspace; at: number }> = [{ doc: server.doc(), at: Date.now() }];
  db.onWrite = (row) => versions.push({ doc: JSON.parse(String(row.data)) as Workspace, at: Date.now() });

  const storages = [new MemoryStorage(), new MemoryStorage()];
  const sameDevice = chance(0.3);
  const storageOf = (i: number) => (sameDevice ? storages[0] : storages[i]);
  const names = ["A", "B"];
  const generation = [0, 0];
  const reports: Array<{ report: MergeReport; at: number }> = [];
  const watch = (tab: WorkspaceSync) =>
    tab.subscribe(() => {
      const merge = tab.getSnapshot().merge;
      if (merge) reports.push({ report: merge.report, at: Date.now() });
    });
  const tabs: Array<WorkspaceSync | null> = [0, 1].map((i) => {
    const tab = openTab(server, { storage: storageOf(i), tabId: `${names[i]}0` });
    watch(tab);
    return tab;
  });

  let counter = 0;
  // marker -> the tab that deleted it on purpose ("A2") -> when (first time).
  // Counted: a word deleted twice (it showed again after this tab's edits
  // were taken over while it slept) and undone once stays deleted.
  const deletions = new Map<string, Map<string, number>>();
  const deleteCount = new Map<string, number>();
  const markDeleted = (m: string, tab: string) => {
    const by = deletions.get(m) ?? new Map<string, number>();
    if (!by.has(tab)) by.set(tab, Date.now());
    deletions.set(m, by);
    deleteCount.set(`${m}@${tab}`, (deleteCount.get(`${m}@${tab}`) ?? 0) + 1);
  };
  const unmarkDeleted = (m: string, tab: string) => {
    const n = (deleteCount.get(`${m}@${tab}`) ?? 0) - 1;
    deleteCount.set(`${m}@${tab}`, Math.max(0, n));
    if (n <= 0) deletions.get(m)?.delete(tab);
  };
  // marker -> the person ("A") whose undo/redo brought it back -> when. A tab
  // can undo what it merged in from a closed tab's draft (an undo step), so a
  // person taking back their own deletion is not a resurrection.
  const restoredBy = new Map<string, Map<string, number>>();
  const deletedBlocks = new Set<string>();
  // "row:value" -> times set on purpose: with undo/redo, and typed only
  const intended = new Map<string, number[]>();
  const typed = new Map<string, number[]>();
  const noteSet = (m: Map<string, number[]>, k: string) => m.set(k, [...(m.get(k) ?? []), Date.now()]);
  let grades = 0;
  let undoUsed = false;
  let crashed = false;
  let agent: Awaited<ReturnType<Server["agentStart"]>> | null = null;
  let agentOwner = -1;

  const steps = 20 + Math.floor(rnd() * 40);
  for (let step = 0; step < steps; step += 1) {
    stats.steps += 1;
    const ti = Math.floor(rnd() * 2);
    const tab = tabs[ti];
    const who = names[ti];
    // Intent is per tab: a reopened tab cannot take back what its predecessor did.
    const self = `${who}${generation[ti]}`;
    const r = rnd();
    if (!tab) continue;
    // The student is looking at this tab (it is shown: it says it is alive,
    // and learns whether its edits were taken over while it was asleep).
    // The other tab sends no sign of life: to the first it looks closed.
    tab.heartbeat();
    const ws = tab.workspace;
    const textBlocks = ws.pages[0].blocks.filter((b) => textOf(b) !== null);
    if (r < 0.3 && textBlocks.length) {
      // A unique marker typed at a word boundary.
      const b = pick(textBlocks);
      counter += 1;
      const m = `[${who}${counter}]`;
      const words = (textOf(b) ?? "").split(" ");
      words.splice(Math.floor(rnd() * (words.length + 1)), 0, m);
      const text = words.join(" ");
      say(`${who} types ${m} in ${b.id}`);
      tab.update((d) => {
        const x = d.pages[0].blocks.find((y) => y.id === b.id);
        if (x && textOf(x) !== null) setTextOf(x, text);
      }, `f-${b.id}`);
    } else if (r < 0.38) {
      const ms = markersOf(ws);
      if (ms.length) {
        const m = pick(ms);
        markDeleted(m, self);
        say(`${who} deletes ${m}`);
        tab.update((d) => {
          for (const x of d.pages[0].blocks) {
            const t = textOf(x);
            if (t !== null) setTextOf(x, t.replace(` ${m}`, "").replace(`${m} `, "").replace(m, ""));
          }
        });
      }
    } else if (r < 0.46) {
      counter += 1;
      const id = `${who.toLowerCase()}blk${counter}`;
      const pos = Math.floor(rnd() * (ws.pages[0].blocks.length + 1));
      say(`${who} adds block ${id}`);
      tab.update((d) => void d.pages[0].blocks.splice(pos, 0, { id, type: "paragraph", text: `new [${who}${counter}]` }));
    } else if (r < 0.5) {
      const bs = ws.pages[0].blocks;
      if (bs.length > 1) {
        const b = pick(bs);
        deletedBlocks.add(b.id);
        say(`${who} deletes block ${b.id}`);
        for (const m of textOf(b)?.match(MARK) ?? []) markDeleted(m, self);
        tab.update((d) => void (d.pages[0].blocks = d.pages[0].blocks.filter((x) => x.id !== b.id)));
      }
    } else if (r < 0.56) {
      const bs = ws.pages[0].blocks;
      if (bs.length > 1) {
        const from = Math.floor(rnd() * bs.length);
        const to = Math.floor(rnd() * bs.length);
        const id = bs[from].id;
        say(`${who} moves ${from} -> ${to}`);
        tab.update((d) => {
          const arr = d.pages[0].blocks;
          const i = arr.findIndex((x) => x.id === id);
          if (i < 0) return;
          const [x] = arr.splice(i, 1);
          arr.splice(Math.min(to, arr.length), 0, x);
        });
      }
    } else if (r < 0.64) {
      const row = pick(["r1", "r2"]);
      counter += 1;
      const v = counter * 10 + ti;
      noteSet(intended, `${row}:${v}`);
      noteSet(typed, `${row}:${v}`);
      say(`${who} sets ${row}=${v}`);
      tab.update((d) => {
        const x = d.databases[0].rows.find((y) => y.id === row);
        if (x) x.cells.x = v;
      });
    } else if (r < 0.68) {
      // A review, recorded the way applyGrade does: monotonic in time.
      counter += 1;
      const at = new Date(Date.now() + counter).toISOString();
      grades += 1;
      say(`${who} grades`);
      tab.update(
        (d) => {
          const deck = d.pages[1]?.blocks.find((b) => b.id === "deck") as unknown as { cards: Loose[] } | undefined;
          const c = deck?.cards.find((x) => x.id === "c1");
          if (!c || (typeof c.lastReviewedAt === "string" && c.lastReviewedAt >= at)) return;
          c.reps = (typeof c.reps === "number" ? c.reps : 0) + 1;
          c.lastReviewedAt = at;
        },
        { rebase: "rerun" },
      );
    } else if (r < 0.74) {
      undoUsed = true;
      const before = tab.workspace;
      const did = chance(0.7) ? tab.undo() : tab.redo();
      say(`${who} undo/redo (${did})`);
      if (did) {
        const after = tab.workspace;
        for (const m of markersOf(before)) if (!markersOf(after).includes(m)) markDeleted(m, self);
        for (const id of blockIds(before)) if (!blockIds(after).has(id)) deletedBlocks.add(id);
        for (const row of after.databases[0]?.rows ?? []) {
          const was = cellX(before, row.id);
          if (was === row.cells.x) continue;
          noteSet(intended, `${row.id}:${row.cells.x}`);
          typed.delete(`${row.id}:${was}`); // that edit was taken back
        }
        // Undo/redo may bring markers back on purpose: re-inserted.
        for (const m of markersOf(after)) {
          if (markersOf(before).includes(m)) continue;
          unmarkDeleted(m, self);
          restoredBy.set(m, (restoredBy.get(m) ?? new Map<string, number>()).set(who, Date.now()));
        }
      }
    } else if (r < 0.8) {
      if (!agent) {
        agent = await server.agentStart();
        agentOwner = ti;
        tab.setAgentBusy(true);
        say(`agent starts for ${who} at v${agent.baseVersion}`);
      } else {
        const base = agent.base;
        const candidates = base.pages[0].blocks.filter((x) => textOf(x) !== null);
        const b = candidates.length ? pick(candidates) : null;
        counter += 1;
        const m = `[G${counter}]`;
        const kind = rnd();
        const n = counter;
        try {
          await agent.apply((d) => {
            if (kind < 0.5 && b) {
              const x = d.pages[0].blocks.find((y) => y.id === b.id);
              if (x && textOf(x) !== null) setTextOf(x, `${textOf(x)} ${m}`);
            } else if (kind < 0.8) {
              d.pages[0].blocks.push({ id: `gblk${n}`, type: "paragraph", text: `agent ${m}` });
            } else {
              const x = d.databases[0].rows.find((y) => y.id === "r1");
              const v = n * 10 + 7;
              noteSet(intended, `r1:${v}`);
              noteSet(typed, `r1:${v}`);
              if (x) x.cells.x = v;
            }
          });
          say(`agent applied ${m}`);
        } catch {
          // refused (a version conflict): the agent's turn is lost, as in the app
          say("agent refused");
        }
        tabs[agentOwner]?.setAgentBusy(false);
        agent = null;
      }
    } else if (r < 0.86) {
      const f = rnd();
      if (f < 0.4) server.dropReplies += 1;
      else if (f < 0.7) server.failSaves += 1 + Math.floor(rnd() * 3);
      else server.failFetch += 1;
      say("fault");
    } else if (r < 0.9) {
      // A tab dies (or closes) and a new tab opens later on the same device.
      crashed = true;
      const closed = chance(0.5);
      if (closed) tab.prepareToLeave();
      await advance(Math.floor(rnd() * 300));
      if (agentOwner === ti) agent = null;
      crash(tab, closed);
      say(`${who} crashes (closed: ${closed})`);
      tabs[ti] = null;
      await advance(chance(0.5) ? 100_000 : 1000);
      generation[ti] += 1;
      const next = openTab(server, { storage: storageOf(ti), tabId: `${who}${generation[ti]}` });
      watch(next);
      tabs[ti] = next;
      say(`${who} reopens`);
    } else {
      await advance(Math.floor(rnd() * 3000));
      if (chance(0.5)) for (const t of tabs) void t?.checkRemote();
    }
    if (chance(0.3)) await advance(Math.floor(rnd() * 1200));
  }

  // Quiesce: no more faults, the agent done, everyone checks in until stable.
  server.dropReplies = 0;
  server.failSaves = 0;
  server.failFetch = 0;
  if (agent) tabs[agentOwner]?.setAgentBusy(false);
  for (let round = 0; round < 6; round += 1) {
    for (const t of tabs) {
      if (!t) continue;
      if (t.getSnapshot().conflict) t.resolveConflict("mine");
      t.retry();
      await advance(20_000);
      await t.checkRemote();
      t.adoptOrphans();
    }
    await advance(130_000);
    for (const t of tabs) t?.adoptOrphans();
    await drain();
  }

  const final = server.doc();
  if (trace) {
    for (const v of versions) console.info(`V t=${v.at % 1e6} r1=${cellX(v.doc, "r1")} r2=${cellX(v.doc, "r2")} ${JSON.stringify(v.doc.pages[0].blocks.map((b) => `${b.id}:${textOf(b) ?? ""}`))}`);
    console.info(`REPORTS ${JSON.stringify(reports.map((x) => ({ at: x.at % 1e6, ...x.report, overwritten: x.report.overwritten.length })))}`);
  }
  const notes: string[] = [];
  let diverged = false;
  for (const t of tabs) {
    if (!t) continue;
    if (!deepEqual(t.workspace, final) || t.getSnapshot().dirty) diverged = true;
    if (t.getSnapshot().status !== "saved") stats.stuck += 1;
  }
  if (diverged) {
    stats.diverged += 1;
    notes.push("DIVERGED");
  }

  const reported = (from: number, k: "keptBoth" | "restored" | "keptDeleted" | "overwritten") =>
    reports.some((x) => x.at >= from && (k === "overwritten" ? x.report.overwritten.length > 0 : x.report[k] > 0));
  const finalMarkers = markersOf(final);
  const everOnServer = new Set(versions.flatMap((v) => markersOf(v.doc)));
  for (const m of everOnServer) {
    const n = finalMarkers.filter((x) => x === m).length;
    const deleted = (deletions.get(m)?.size ?? 0) > 0;
    if (n === 0 && !deleted) {
      stats.lostMarkers += 1;
      notes.push(`LOST ${m}`);
    }
    if (final.pages[0].blocks.some((b) => (textOf(b)?.match(MARK) ?? []).filter((x) => x === m).length > 1)) {
      stats.dupInsideOneBlock += 1;
      notes.push(`DUP-IN-BLOCK ${m}`);
    }
    if (n > 1) {
      stats.dupMarkers += 1;
      if (!(reported(0, "keptBoth") || reported(0, "restored"))) {
        stats.dupUnreported += 1;
        notes.push(`DUP-UNREPORTED ${m}`);
      }
    }
    // Brought back on purpose (an undo/redo) after it was deleted: the two
    // intents conflict, and whichever arrives last is a fair outcome.
    const firstDeleted = Math.min(...(deletions.get(m)?.values() ?? []));
    const takenBack = [...(restoredBy.get(m)?.values() ?? [])].some((at) => at >= firstDeleted);
    if (n > 0 && deleted && !takenBack) {
      const t = Math.min(...(deletions.get(m)?.values() ?? []));
      if (versions.some((v) => v.at >= t && !markersOf(v.doc).includes(m))) {
        stats.resurrected += 1;
        // Back only inside a kept copy: that block is marked on every device
        // ("a second version of the text above", with Use / Keep both / Discard).
        const onlyInKeptCopies = final.pages[0].blocks.every(
          (b) => !markersOf1(b).includes(m) || Boolean((b as unknown as Loose).keptFrom),
        );
        const rep =
          onlyInKeptCopies ||
          (["restored", "keptDeleted", "overwritten", "keptBoth"] as const).some((k) => reported(t, k));
        if (!rep) {
          stats.resurrectedUnreported += 1;
          notes.push(`RESURRECTED-UNREPORTED ${m}`);
        }
      }
    }
  }
  const everBlocks = new Set(versions.flatMap((v) => [...blockIds(v.doc)]));
  for (const id of everBlocks) {
    if (!blockIds(final).has(id) && !deletedBlocks.has(id)) {
      stats.lostBlocks += 1;
      notes.push(`LOST-BLOCK ${id}`);
    }
  }
  for (const row of ["r1", "r2"]) {
    const fv = cellX(final, row);
    if (typeof fv !== "number" || fv === 0) continue;
    const lastSet = Math.max(...(intended.get(`${row}:${fv}`) ?? []), -1);
    const laterIn = (m: Map<string, number[]>, v: { doc: Workspace }) => {
      const w = cellX(v.doc, row);
      return w !== fv && (m.get(`${row}:${w}`) ?? []).some((t) => t > lastSet);
    };
    const firstOn = versions.findIndex((v) => cellX(v.doc, row) === fv);
    // Replaced by a value typed later (an undo that only takes back the
    // undoer's own unsaved edit changes nothing on the server, so it is no
    // competitor); unless the student was told their value replaced another
    // ("Use the other version for those" puts it back).
    if (
      firstOn >= 0 &&
      versions.some((v, j) => j > firstOn && v.at > lastSet && laterIn(typed, v)) &&
      !reported(lastSet, "overwritten")
    ) {
      stats.staleValues += 1;
      notes.push(`STALE ${row}=${fv}`);
    }
    if (lastSet >= 0 && versions.some((v) => v.at > lastSet && laterIn(typed, v))) {
      stats.overwroteNewer += 1;
      if (!reported(lastSet, "overwritten")) {
        stats.overwroteNewerUnreported += 1;
        notes.push(`OVERWROTE-NEWER-UNREPORTED ${row}=${fv}`);
      }
    }
  }
  if (!crashed) {
    stats.gradeRuns += 1;
    const deck = final.pages[1]?.blocks.find((b) => b.id === "deck") as unknown as { cards: Loose[] } | undefined;
    const reps = Number(deck?.cards[0]?.reps ?? 0);
    if (reps > grades) {
      stats.gradeOver += 1;
      notes.push(`GRADES ${reps} > ${grades}`);
    }
    if (reps < grades) stats.gradeUnder += 1;
  }
  if (undoUsed) stats.undoHistories += 1;
  if (notes.length && stats.examples.length < 10) stats.examples.push(`#${index}: ${notes.join("; ")}`);
  stats.histories += 1;
  for (const t of tabs) if (t) crash(t);
}
