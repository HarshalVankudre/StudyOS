// @vitest-environment node
/**
 * Seeded random histories against the real engine, store and version service
 * (sync-sim/simulate.ts lists what a history contains and what is checked).
 * One test per configuration, so a failure names the mix that produced it.
 *
 * Part of every run with a modest number of histories. The larger sweep:
 *   SYNC_SIM_HISTORIES=2000 SYNC_SIM_SEED=7 npx pnpm@10 exec vitest run src/components/workspace/sync-sim.test.ts
 * SYNC_SIM_HISTORIES is per configuration; SYNC_SIM_CONFIG=<name> runs one;
 * SYNC_SIM_TRACE=<n> prints every step, request and version of history n;
 * SYNC_SIM_REPORT=<file> writes the counts.
 */
import { writeFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { CONFIGS, emptyStats, runHistory, type SimStats } from "./sync-sim/simulate";

vi.mock("@/lib/db", async () => {
  const { createMemoryPrisma } = await import("./sync-sim/memory-prisma");
  return { prisma: createMemoryPrisma() };
});
vi.mock("@clerk/nextjs/server", () => ({ auth: async () => ({ userId: "u1" }) }));
vi.mock("@/lib/ops/report-error", () => ({ reportError: () => {} }));

const HISTORIES = Number(process.env.SYNC_SIM_HISTORIES ?? 40);
const SEED = Number(process.env.SYNC_SIM_SEED ?? 1);
const ONLY = process.env.SYNC_SIM_CONFIG;
const report: Record<string, Omit<SimStats, "examples">> = {};

beforeAll(() => {
  vi.useFakeTimers({ now: Date.UTC(2026, 10, 12, 9, 0, 0) });
  // The engine logs what it recovers from; thousands of histories would flood the output.
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterAll(() => {
  vi.useRealTimers();
  if (process.env.SYNC_SIM_REPORT) writeFileSync(process.env.SYNC_SIM_REPORT, JSON.stringify(report, null, 1));
});

describe(`sync engine: seeded random histories (seed ${SEED})`, () => {
  for (const [name, config] of Object.entries(CONFIGS)) {
    if (ONLY && ONLY !== name) continue;
    it(
      `${name}: ${HISTORIES} histories, nothing lost, duplicated, brought back or replaced without a word`,
      async () => {
        const stats = emptyStats();
        for (let i = 0; i < HISTORIES; i += 1) await runHistory(i, SEED, config, stats);
        const { examples, ...numbers } = stats;
        report[name] = numbers;
        const zero = Object.fromEntries(Object.keys(stats.failures).map((k) => [k, 0]));
        const failed = Object.values(stats.failures).some(Boolean);
        expect({ failures: stats.failures, examples: failed ? examples : [] }).toEqual({ failures: zero, examples: [] });
        expect(stats.histories).toBe(HISTORIES);
      },
      Math.max(120_000, HISTORIES * 1_500),
    );
  }

  // A zero only means something if the histories went through the paths that
  // used to fail. (Checked over all configurations together.)
  it("the histories exercised lost replies, crashes, recovered drafts, older builds and every kind of banner", () => {
    if (ONLY || HISTORIES < 40) return;
    const total: Record<string, number> = {};
    for (const stats of Object.values(report)) {
      for (const [k, n] of Object.entries(stats.coverage)) total[k] = (total[k] ?? 0) + n;
    }
    for (const key of [
      "lostReplies",
      "offlinePeriods",
      "freezes",
      "oldBuildPeriods",
      "oldFormatDrafts",
      "crashes",
      "closes",
      "comeBacks",
      "draftsRecovered",
      "undoRedo",
      "agentTasks",
      "feedSyncs",
      "checkoffs",
      "reviews",
      "answers",
      "banner:remote",
      "banner:draft",
      "banner:unconfirmed",
    ]) {
      expect(total[key] ?? 0, `coverage of ${key}`).toBeGreaterThan(0);
    }
  });
});
