// @vitest-environment node
/**
 * Seeded random histories against the real engine, store and version
 * service (sync-sim/simulate.ts). Two tabs, the AI agent, undo/redo, re-run
 * grades, lost replies, failed saves and reads, crashes and draft recovery.
 *
 * Default: a few hundred histories, part of every run. The full sweep:
 *   SYNC_SIM_HISTORIES=20000 SYNC_SIM_SEED=7 npx vitest run src/components/workspace/sync-sim.test.ts
 * SYNC_SIM_TRACE=<n> prints every step, request and version of history n.
 */
import { writeFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { emptyStats, runHistory } from "./sync-sim/simulate";

vi.mock("@/lib/db", async () => {
  const { createMemoryPrisma } = await import("./sync-sim/memory-prisma");
  return { prisma: createMemoryPrisma() };
});
vi.mock("@clerk/nextjs/server", () => ({ auth: async () => ({ userId: "u1" }) }));
vi.mock("@/lib/ops/report-error", () => ({ reportError: () => {} }));

const HISTORIES = Number(process.env.SYNC_SIM_HISTORIES ?? 300);
const SEED = Number(process.env.SYNC_SIM_SEED ?? 1);

beforeAll(() => {
  vi.useFakeTimers({ now: Date.UTC(2026, 10, 12, 9, 0, 0) });
  // The engine logs what it recovers from; thousands of histories would flood the output.
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterAll(() => {
  vi.useRealTimers();
});

describe("sync engine: seeded random histories", () => {
  it(
    `${HISTORIES} histories (seed ${SEED}): no divergence, nothing lost or duplicated, nothing counted twice, every surprise reported`,
    async () => {
      const stats = emptyStats();
      for (let i = 0; i < HISTORIES; i += 1) await runHistory(i, SEED, stats);
      const { examples, ...numbers } = stats;
      // SYNC_SIM_REPORT=<file>: the counts, for the record.
      if (process.env.SYNC_SIM_REPORT) writeFileSync(process.env.SYNC_SIM_REPORT, JSON.stringify(numbers, null, 1));
      const failures = {
        diverged: stats.diverged,
        stuck: stats.stuck,
        lostMarkers: stats.lostMarkers,
        lostBlocks: stats.lostBlocks,
        dupInsideOneBlock: stats.dupInsideOneBlock,
        dupUnreported: stats.dupUnreported,
        resurrectedUnreported: stats.resurrectedUnreported,
        staleValues: stats.staleValues,
        overwroteNewerUnreported: stats.overwroteNewerUnreported,
        gradeOver: stats.gradeOver,
      };
      expect({ failures, examples: Object.values(failures).some(Boolean) ? examples : [] }).toEqual({
        failures: {
          diverged: 0,
          stuck: 0,
          lostMarkers: 0,
          lostBlocks: 0,
          dupInsideOneBlock: 0,
          dupUnreported: 0,
          resurrectedUnreported: 0,
          staleValues: 0,
          overwroteNewerUnreported: 0,
          gradeOver: 0,
        },
        examples: [],
      });
      // The histories really exercised undo and the re-run path.
      expect(stats.undoHistories).toBeGreaterThan(HISTORIES / 3);
      expect(stats.gradeRuns).toBeGreaterThan(0);
    },
    Math.max(60_000, HISTORIES * 200),
  );
});
