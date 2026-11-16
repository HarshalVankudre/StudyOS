/**
 * The write path of the operator console's "Errors" panel (/app/admin):
 * reportError (lib/ops/report-error.ts) hands every error it logs to
 * recordErrorEvent, which counts it in memory by fingerprint and writes the
 * counts to the ErrorEvent table in the background, at most every 30 seconds
 * (sooner when many different errors pile up), one upsert per fingerprint.
 *
 * Safe by construction:
 *  - Never throws to the caller and never calls reportError (this module does
 *    not import it), so a failing database cannot recurse into more errors.
 *    A failed write is dropped; at most one stderr line every few minutes
 *    says so. The log line reportError already wrote is the full record.
 *  - Prisma is imported lazily, at write time and only in the Node.js
 *    runtime: the import sits in a `NEXT_RUNTIME !== "edge"` branch the
 *    bundler drops from edge builds, and this module has no other runtime
 *    imports (no node:crypto either), so it is safe wherever reportError is.
 *  - Memory is bounded: at most MAX_BUFFERED distinct fingerprints are held
 *    between writes (each with a capped message and sample); anything beyond
 *    is counted in one "overflow" row.
 *  - Off in tests (Vitest, NODE_ENV=test) unless a test turns it on, off
 *    during `next build`, and STUDYOS_ERROR_EVENTS=off switches it off.
 *  - Stores only what the log line already scrubbed (report-error's scrub),
 *    with ids, UUIDs and long hex replaced on top: no user ids, emails or
 *    content, so the table needs no erasure or export handling.
 *
 * The buffer lives on globalThis: Next compiles route handlers, server
 * actions and instrumentation (onRequestError) into separate module
 * instances, and they should share one buffer, one timer and one client.
 */
import type { PrismaClient } from "@/generated/prisma";

export const ERROR_EVENT_LIMITS = {
  /** Writes happen at most this often (plus the threshold flush below). */
  flushIntervalMs: 30_000,
  /** This many distinct fingerprints waiting trigger an early write... */
  flushThreshold: 100,
  /** ...but never sooner than this after the previous write. */
  minFlushGapMs: 5_000,
  /** Distinct fingerprints held between writes; the rest go to "overflow". */
  maxBuffered: 200,
  maxSource: 100,
  maxRoute: 200,
  maxMessage: 500,
  maxSample: 2_000,
  sampleFrames: 8,
  maxRelease: 100,
  /** A write gives up after this many failed upserts (the database is likely down). */
  maxFailuresPerFlush: 3,
  /** At most one "not saved" stderr line per this long. */
  failureLogGapMs: 5 * 60_000,
} as const;

/** The row that counts errors past the buffer's limit. */
export const OVERFLOW_FINGERPRINT = "overflow";

const OVERFLOW_MESSAGE = `More than ${ERROR_EVENT_LIMITS.maxBuffered} different errors between two database writes; the rest are only counted here. The server log has each of them.`;

/** What reportError passes in: already scrubbed. */
export interface ErrorEventInput {
  source?: unknown;
  route?: unknown;
  /** "Name: message", scrubbed. */
  message: string;
  /** Stack frames ("at ..." lines), scrubbed, or null. */
  frames?: string | null;
}

/** One fingerprint's counts waiting to be written. */
export interface PendingErrorEvent {
  fingerprint: string;
  source: string;
  route: string | null;
  message: string;
  sample: string | null;
  count: number;
  firstSeen: Date;
  lastSeen: Date;
}

// ---- Normalization ---------------------------------------------------------------

/**
 * Identifiers that may name a person or a record: replaced in everything
 * stored (message, sample, route). Order matters: specific shapes first.
 */
const ID_PATTERNS: [RegExp, string][] = [
  [/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "<uuid>"],
  // Clerk (user_, org_, sess_) and Stripe (cus_, sub_, pi_, cs_test_ ...) ids.
  [
    /\b(?:user|org|sess|cus|sub|si|pi|pm|ch|py|in|ii|il|evt|cs|price|prod|re|dp|txn|seti|acct|src|tok|card|ba|po|tr)_(?:live_|test_)?[A-Za-z0-9]{10,}\b/g,
    "<id>",
  ],
  // Long tokens mixing letters and digits: cuids, nanoids, share tokens.
  [/\b(?=[A-Za-z0-9_-]*\d)(?=[A-Za-z0-9_-]*[A-Za-z])[A-Za-z0-9_-]{20,}\b/g, "<id>"],
  [/\b(?:0x)?(?=[0-9a-f]*\d)[0-9a-f]{12,}\b/gi, "<hex>"],
  [/\b\d{6,}\b/g, "<n>"],
];

export function redactIds(text: string): string {
  let out = text;
  for (const [re, replacement] of ID_PATTERNS) out = out.replace(re, replacement);
  return out;
}

/**
 * The message as grouped: ids redacted, every number (a count, a size, a
 * status, "30000ms") replaced, whitespace collapsed. Codes stay apart:
 * "P2002" keeps its digits (they are not a separate word).
 */
export function normalizeMessage(text: string): string {
  return redactIds(text)
    .replace(/\b\d+(?:\.\d+)?/g, "<n>")
    .replace(/\s+/g, " ")
    .trim();
}

/** A 64-bit non-cryptographic hash as 16 hex digits (no node:crypto: runs anywhere). */
function hash64(text: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h2 >>> 0).toString(16).padStart(8, "0") + (h1 >>> 0).toString(16).padStart(8, "0");
}

/** Same source + route + normalized message = same fingerprint. */
export function errorFingerprint(source: string, route: string | null, message: string): string {
  return hash64(`${source}\n${route ?? ""}\n${normalizeMessage(message)}`);
}

/** A fingerprint as the console's clear action accepts it. */
export const FINGERPRINT_PATTERN = /^(?:[0-9a-f]{16}|overflow)$/;

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

/** Machine paths before .next/, node_modules/ or src/ (a home folder, the image layout). */
function shortenPaths(text: string): string {
  return text.replace(
    /(?:file:\/\/\/?)?(?:[A-Za-z]:)?(?:[\\/][^\\/\s():]+)*?[\\/](?=(?:\.next|node_modules|src)[\\/])/g,
    "",
  );
}

const label = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : null);

/** The row fields for one reported error (everything already scrubbed by reportError). */
export function toErrorEvent(input: ErrorEventInput): Omit<PendingErrorEvent, "count" | "firstSeen" | "lastSeen"> {
  const source = clip(redactIds(label(input.source) ?? "unknown"), ERROR_EVENT_LIMITS.maxSource);
  const routeLabel = label(input.route);
  const route = routeLabel ? clip(redactIds(routeLabel), ERROR_EVENT_LIMITS.maxRoute) : null;
  const message =
    clip(redactIds(input.message).replace(/\s+/g, " ").trim(), ERROR_EVENT_LIMITS.maxMessage) || "(no message)";
  const frames = (input.frames ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, ERROR_EVENT_LIMITS.sampleFrames);
  const sample = frames.length
    ? clip(redactIds(shortenPaths(frames.join("\n"))), ERROR_EVENT_LIMITS.maxSample)
    : null;
  return { fingerprint: errorFingerprint(source, route, message), source, route, message, sample };
}

// ---- Buffer ---------------------------------------------------------------------

interface State {
  buffer: Map<string, PendingErrorEvent>;
  timer: ReturnType<typeof setTimeout> | null;
  flushing: Promise<void> | null;
  lastFlushAt: number;
  lastFailureLogAt: number;
  /** Tests only: true/false forces recording on/off; null = decide from the environment. */
  override: boolean | null;
  client: Promise<PrismaClient> | null;
}

const STATE_KEY = "__studyosErrorEventsV1";

function state(): State {
  const g = globalThis as unknown as Record<typeof STATE_KEY, State | undefined>;
  const existing = g[STATE_KEY];
  if (existing) return existing;
  const fresh: State = {
    buffer: new Map(),
    timer: null,
    flushing: null,
    lastFlushAt: 0,
    lastFailureLogAt: 0,
    override: null,
    client: null,
  };
  g[STATE_KEY] = fresh;
  return fresh;
}

function enabled(s: State): boolean {
  if (s.override !== null) return s.override;
  const env = process.env;
  if (env.VITEST || env.NODE_ENV === "test") return false;
  if (env.NEXT_PHASE === "phase-production-build") return false;
  return env.STUDYOS_ERROR_EVENTS?.trim().toLowerCase() !== "off";
}

const distinctCount = (s: State) => s.buffer.size - (s.buffer.has(OVERFLOW_FINGERPRINT) ? 1 : 0);

/**
 * Count one reported error (called by reportError after its log line).
 * Never throws; does nothing in the browser, the edge runtime or tests.
 */
export function recordErrorEvent(input: ErrorEventInput, now: Date = new Date()): void {
  try {
    if (process.env.NEXT_RUNTIME === "edge" || typeof window !== "undefined") return;
    const s = state();
    if (!enabled(s)) return;
    const event = toErrorEvent(input);
    const existing = s.buffer.get(event.fingerprint);
    if (existing) {
      existing.count += 1;
      existing.lastSeen = now;
    } else if (distinctCount(s) < ERROR_EVENT_LIMITS.maxBuffered) {
      s.buffer.set(event.fingerprint, { ...event, count: 1, firstSeen: now, lastSeen: now });
    } else {
      const overflow = s.buffer.get(OVERFLOW_FINGERPRINT);
      if (overflow) {
        overflow.count += 1;
        overflow.lastSeen = now;
      } else {
        s.buffer.set(OVERFLOW_FINGERPRINT, {
          fingerprint: OVERFLOW_FINGERPRINT,
          source: "ops",
          route: null,
          message: OVERFLOW_MESSAGE,
          sample: null,
          count: 1,
          firstSeen: now,
          lastSeen: now,
        });
      }
    }
    scheduleFlush(s);
  } catch {
    // Counting is best effort; the log line is already written.
  }
}

function scheduleFlush(s: State): void {
  const now = Date.now();
  if (
    distinctCount(s) >= ERROR_EVENT_LIMITS.flushThreshold &&
    !s.flushing &&
    now - s.lastFlushAt >= ERROR_EVENT_LIMITS.minFlushGapMs
  ) {
    void flushErrorEvents();
    return;
  }
  if (s.timer) return;
  const wait = Math.max(0, s.lastFlushAt + ERROR_EVENT_LIMITS.flushIntervalMs - now);
  s.timer = setTimeout(() => {
    s.timer = null;
    void flushErrorEvents();
  }, wait);
  // Never keep a process (a build, a script) alive just to write error counts.
  (s.timer as { unref?: () => void }).unref?.();
}

/**
 * Write everything buffered now: one upsert per fingerprint. Resolves when
 * done (never rejects). Concurrent calls share one write.
 */
export function flushErrorEvents(): Promise<void> {
  try {
    const s = state();
    if (s.flushing) return s.flushing;
    if (s.timer) {
      clearTimeout(s.timer);
      s.timer = null;
    }
    if (s.buffer.size === 0) return Promise.resolve();
    const batch = [...s.buffer.values()];
    s.buffer = new Map();
    s.lastFlushAt = Date.now();
    s.flushing = writeBatch(s, batch)
      .catch((error: unknown) => logNotSaved(s, error, batch.length))
      .finally(() => {
        s.flushing = null;
        // Errors that arrived during the write wait for the next one.
        if (s.buffer.size > 0) {
          try {
            scheduleFlush(s);
          } catch {
            // Best effort.
          }
        }
      });
    return s.flushing;
  } catch {
    return Promise.resolve();
  }
}

function currentRelease(): string | null {
  const value = process.env.DEPLOYMENT_VERSION?.trim() || process.env.NEXT_DEPLOYMENT_ID?.trim() || "";
  return value ? value.slice(0, ERROR_EVENT_LIMITS.maxRelease) : null;
}

async function writeBatch(s: State, batch: PendingErrorEvent[]): Promise<void> {
  // A literal branch on NEXT_RUNTIME, so edge builds drop the Prisma import.
  if (process.env.NEXT_RUNTIME !== "edge") {
    s.client ??= import("@/lib/db").then((mod) => mod.prisma);
    let prisma: PrismaClient;
    try {
      prisma = await s.client;
    } catch (error) {
      s.client = null; // Retry the import next time.
      throw error;
    }
    const release = currentRelease();
    let failures = 0;
    let written = 0;
    let lastError: unknown = null;
    for (const event of batch) {
      try {
        await prisma.errorEvent.upsert({
          where: { fingerprint: event.fingerprint },
          create: { ...event, release },
          update: { count: { increment: event.count }, lastSeen: event.lastSeen, release },
        });
        written += 1;
      } catch (error) {
        failures += 1;
        lastError = error;
        if (failures >= ERROR_EVENT_LIMITS.maxFailuresPerFlush) break;
      }
    }
    if (failures > 0) logNotSaved(s, lastError, batch.length - written);
  }
}

/** One throttled stderr line; never reportError (that would recurse into here). */
function logNotSaved(s: State, error: unknown, dropped: number): void {
  try {
    const now = Date.now();
    if (s.lastFailureLogAt && now - s.lastFailureLogAt < ERROR_EVENT_LIMITS.failureLogGapMs) return;
    s.lastFailureLogAt = now;
    const code = (error as { code?: unknown } | null)?.code;
    const name = error instanceof Error ? (error.constructor?.name ?? error.name) : typeof error;
    console.error(
      JSON.stringify({
        severity: "WARNING",
        message: "[StudyOS] error counts not saved for the operator console",
        dropped,
        error: typeof code === "string" ? `${name} ${code}` : name,
      }),
    );
  } catch {
    // Nothing else to do.
  }
}

// ---- Tests -------------------------------------------------------------------------

/** Tests only: force recording on (true), off (false) or back to the environment default (null). */
export function setErrorEventsEnabledForTests(on: boolean | null): void {
  state().override = on;
}

/** Tests only: drop the buffer, timer and cached client, and restore the defaults. */
export function resetErrorEventsForTests(): void {
  const s = state();
  if (s.timer) clearTimeout(s.timer);
  s.buffer = new Map();
  s.timer = null;
  s.flushing = null;
  s.lastFlushAt = 0;
  s.lastFailureLogAt = 0;
  s.override = null;
  s.client = null;
}

/** Tests only: what is waiting to be written. */
export function bufferedErrorEvents(): PendingErrorEvent[] {
  return [...state().buffer.values()].map((event) => ({ ...event }));
}
