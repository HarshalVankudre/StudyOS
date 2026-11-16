/**
 * The read side of the operator console's "Errors" panel (/app/admin): the
 * ErrorEvent rows that lib/ops/error-events.ts writes, one per kind of error.
 * Two small aggregates and one short list over the lastSeen index; the table
 * itself stays small (one row per kind, gone 30 days after it was last seen).
 */
import "server-only";

import { prisma } from "@/lib/db";
import { reportError } from "@/lib/ops/report-error";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Kinds of error listed in the console. */
export const ERRORS_SHOWN = 20;

export interface ErrorGroup {
  fingerprint: string;
  source: string;
  route: string | null;
  message: string;
  sample: string | null;
  count: number;
  firstSeen: Date;
  lastSeen: Date;
  release: string | null;
}

export interface ErrorOverview {
  /**
   * Summed counts of the kinds last seen in the window. Approximate: a kind
   * seen in the window brings its whole count, older occurrences included.
   */
  seen: { day: number; week: number };
  /** Kinds of error last seen in the window. */
  kinds: { day: number; week: number };
  /** The most frequent kinds seen in the last 7 days, largest count first. */
  top: ErrorGroup[];
}

const ago = (now: Date, ms: number) => new Date(now.getTime() - ms);

/**
 * The panel's numbers, or null when they cannot be read (the table is not
 * migrated yet, the database hiccups): the rest of the console still loads.
 */
export async function errorOverview(now = new Date()): Promise<ErrorOverview | null> {
  try {
    const day = ago(now, DAY_MS);
    const week = ago(now, 7 * DAY_MS);
    const [inDay, inWeek, top] = await Promise.all([
      prisma.errorEvent.aggregate({ where: { lastSeen: { gte: day } }, _sum: { count: true }, _count: { _all: true } }),
      prisma.errorEvent.aggregate({ where: { lastSeen: { gte: week } }, _sum: { count: true }, _count: { _all: true } }),
      prisma.errorEvent.findMany({
        where: { lastSeen: { gte: week } },
        orderBy: [{ count: "desc" }, { lastSeen: "desc" }],
        take: ERRORS_SHOWN,
        select: {
          fingerprint: true, source: true, route: true, message: true, sample: true,
          count: true, firstSeen: true, lastSeen: true, release: true,
        },
      }),
    ]);
    return {
      seen: { day: inDay._sum.count ?? 0, week: inWeek._sum.count ?? 0 },
      kinds: { day: inDay._count._all, week: inWeek._count._all },
      top,
    };
  } catch (error) {
    reportError(error, { source: "admin", route: "lib/ops/error-overview" });
    return null;
  }
}

/** "Clear" in the console (for a fixed issue): it comes back if the error does. */
export async function clearErrorEvent(fingerprint: string): Promise<number> {
  const result = await prisma.errorEvent.deleteMany({ where: { fingerprint } });
  return result.count;
}
