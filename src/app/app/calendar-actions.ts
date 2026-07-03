"use server";

import { auth } from "@clerk/nextjs/server";
import { headers } from "next/headers";
import {
  getOrCreateCalendarToken,
  resetCalendarToken,
} from "@/lib/calendar/feed";

async function feedUrl(token: string): Promise<string> {
  const h = await headers();
  const host = h.get("host") ?? "localhost:3000";
  const proto = host.startsWith("localhost") ? "http" : "https";
  return `${proto}://${host}/api/calendar/${token}`;
}

/** The signed-in user's calendar feed URL (created on first call). */
export async function getCalendarFeedUrlAction(): Promise<string | null> {
  const { userId } = await auth();
  if (!userId) return null;
  return feedUrl(await getOrCreateCalendarToken(userId));
}

/** Rotate the feed token and return the new URL; the old link stops working. */
export async function resetCalendarFeedAction(): Promise<string | null> {
  const { userId } = await auth();
  if (!userId) return null;
  return feedUrl(await resetCalendarToken(userId));
}
