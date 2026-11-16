/**
 * Who may open the operator console (/app/admin): the Clerk user ids listed
 * in STUDYOS_ADMIN_USER_IDS (comma-separated). Unset or empty = nobody.
 *
 * Everyone else gets a plain 404 from the console and its actions, so the
 * page never reveals that it exists. The list itself never leaves the server:
 * the client is only ever told a yes/no for the signed-in user.
 */
import "server-only";

import { auth } from "@clerk/nextjs/server";
import { notFound } from "next/navigation";

type Env = Record<string, string | undefined>;

/** The configured admin user ids (trimmed, empties dropped). */
export function adminUserIds(env: Env = process.env): Set<string> {
  return new Set(
    (env.STUDYOS_ADMIN_USER_IDS ?? "")
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean),
  );
}

/** True when `userId` is a signed-in user listed in STUDYOS_ADMIN_USER_IDS. */
export function isAdmin(userId: string | null | undefined, env: Env = process.env): boolean {
  if (!userId) return false;
  return adminUserIds(env).has(userId);
}

/**
 * The signed-in admin's user id, or a 404 (notFound) for anyone else,
 * signed out included. For the console page and its server actions.
 */
export async function requireAdmin(): Promise<string> {
  const { userId } = await auth();
  if (!userId || !isAdmin(userId)) notFound();
  return userId;
}
