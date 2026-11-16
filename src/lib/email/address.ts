/**
 * A student's email address, read from Clerk when it is needed and never
 * stored by StudyOS. Only the PRIMARY address counts, and only once Clerk
 * says it is verified: a reminder never goes to an address the student has
 * not proven is theirs.
 *
 * Kept briefly in memory (per server instance) so a dispatch run does not ask
 * Clerk again for every reminder of a student: a verified address for
 * ADDRESS_TTL_MS, an unverified or missing one for a shorter while (the
 * student may be verifying it right now). Short on purpose: an address the
 * student changed in Clerk is the one written to within a minute, so an
 * email never goes to an old address the student has just replaced. A run
 * reads each student's address within seconds, so this still means one
 * Clerk call per student per run. Bounded: the oldest entries go first.
 *
 * A `fresh` lookup (turning email on) skips the memory, but asks Clerk at most
 * once per student every FRESH_INTERVAL_MS (a quicker repeat gets the answer
 * just fetched), so a script toggling the switch cannot turn into a stream of
 * Clerk calls.
 *
 * When Clerk cannot be reached, or does not answer within LOOKUP_TIMEOUT_MS,
 * the answer is "unavailable" (not reachable this run; the dispatch looks
 * again in a few minutes), and every lookup, fresh ones included, pauses for
 * BACKOFF_MS so a Clerk outage is not met with a request per student.
 */
import "server-only";

import { clerkClient } from "@clerk/nextjs/server";

export type AddressLookup =
  | { kind: "verified"; email: string }
  | { kind: "unverified"; email: string }
  | { kind: "missing" }
  | { kind: "unavailable" };

export interface AddressBook {
  /** `fresh`: ask Clerk even when an answer is in memory (see FRESH_INTERVAL_MS). */
  lookup(userId: string, options?: { fresh?: boolean }): Promise<AddressLookup>;
}

/** Reads one student's primary address from the source. Throws when it cannot be reached. */
export type AddressSource = (userId: string) => Promise<Exclude<AddressLookup, { kind: "unavailable" }>>;

export const ADDRESS_TTL_MS = 60 * 1000;
const UNVERIFIED_TTL_MS = 30 * 1000;
export const FRESH_INTERVAL_MS = 30 * 1000;
export const LOOKUP_TIMEOUT_MS = 5 * 1000;
const BACKOFF_MS = 30 * 1000;
const MAX_ENTRIES = 5_000;

export interface AddressBookOptions {
  source: AddressSource;
  now?: () => number;
  maxEntries?: number;
  /** Give up on the source after this long (counts as unreachable). */
  timeoutMs?: number;
}

/** The source's answer, or a rejection when it takes longer than `ms` (the late answer is dropped). */
function withDeadline<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("address lookup timed out")), ms);
  });
  promise.catch(() => {});
  return Promise.race([promise, late]).finally(() => clearTimeout(timer));
}

export function createAddressBook(options: AddressBookOptions): AddressBook {
  const now = options.now ?? Date.now;
  const maxEntries = options.maxEntries ?? MAX_ENTRIES;
  const timeoutMs = options.timeoutMs ?? LOOKUP_TIMEOUT_MS;
  const cache = new Map<string, { value: AddressLookup; fetchedAt: number; until: number }>();
  let pausedUntil = 0;

  const remember = (userId: string, value: AddressLookup) => {
    const t = now();
    cache.delete(userId);
    cache.set(userId, { value, fetchedAt: t, until: t + (value.kind === "verified" ? ADDRESS_TTL_MS : UNVERIFIED_TTL_MS) });
    while (cache.size > maxEntries) {
      const oldest = cache.keys().next().value;
      if (oldest === undefined) break;
      cache.delete(oldest);
    }
  };

  return {
    async lookup(userId, { fresh = false } = {}) {
      const hit = cache.get(userId);
      const t = now();
      if (hit && (fresh ? t - hit.fetchedAt < FRESH_INTERVAL_MS : hit.until > t)) return hit.value;
      if (t < pausedUntil) return { kind: "unavailable" };
      try {
        const value = await withDeadline(options.source(userId), timeoutMs);
        remember(userId, value);
        return value;
      } catch {
        pausedUntil = now() + BACKOFF_MS;
        return { kind: "unavailable" };
      }
    },
  };
}

function isNotFound(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && (error as { status?: unknown }).status === 404);
}

/** The primary address from Clerk's backend API. */
export const clerkAddressSource: AddressSource = async (userId) => {
  const client = await clerkClient();
  let user: Awaited<ReturnType<typeof client.users.getUser>>;
  try {
    user = await client.users.getUser(userId);
  } catch (error) {
    // A deleted account has no address; anything else is Clerk being unreachable.
    if (isNotFound(error)) return { kind: "missing" };
    throw error;
  }
  const primary =
    user.primaryEmailAddress ?? user.emailAddresses.find((e) => e.id === user.primaryEmailAddressId) ?? null;
  if (!primary?.emailAddress) return { kind: "missing" };
  return primary.verification?.status === "verified"
    ? { kind: "verified", email: primary.emailAddress }
    : { kind: "unverified", email: primary.emailAddress };
};

/** The shared address book of this server instance. */
export const emailAddresses: AddressBook = createAddressBook({ source: clerkAddressSource });
