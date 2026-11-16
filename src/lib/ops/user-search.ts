/**
 * Operator console: find a student's Clerk user id from what support mail
 * actually carries, their email address. Read-only, server-side, admin pages
 * only; Clerk failures come back as an outcome, never as a thrown error.
 */
import "server-only";

import { clerkClient } from "@clerk/nextjs/server";

/** Longest address RFC 5321 allows; anything longer is a paste accident. */
const MAX_EMAIL = 254;
/** Accounts listed for one address (Clerk allows the same address only once, but be safe). */
const MAX_MATCHES = 5;

/** A trimmed, plausible email address, or null. */
export function parseLookupEmail(value: unknown): string | null {
  const text = (Array.isArray(value) ? value[0] : value) as unknown;
  if (typeof text !== "string") return null;
  const email = text.trim().toLowerCase();
  if (email.length === 0 || email.length > MAX_EMAIL) return null;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

export type EmailLookup =
  | { status: "found"; userIds: string[] }
  | { status: "none" }
  | { status: "unavailable" };

type UsersApi = {
  getUserList(params: { emailAddress: string[]; limit: number }): Promise<{ data: { id: string }[] }>;
};

/** The Clerk user ids with this email address (primary or not). */
export async function findUserIdsByEmail(
  email: string,
  users?: UsersApi,
): Promise<EmailLookup> {
  try {
    const api = users ?? ((await clerkClient()).users as unknown as UsersApi);
    const { data } = await api.getUserList({ emailAddress: [email], limit: MAX_MATCHES });
    const userIds = data.map((u) => u.id).filter((id) => typeof id === "string" && id.length > 0);
    return userIds.length > 0 ? { status: "found", userIds } : { status: "none" };
  } catch {
    return { status: "unavailable" };
  }
}
