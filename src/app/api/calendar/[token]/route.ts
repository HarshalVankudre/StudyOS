import { buildUserFeed, resolveUserByToken } from "@/lib/calendar/feed";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Read-only ICS calendar feed. The token in the path IS the credential — this
 * URL is fetched by calendar apps (Google/Apple/Outlook) that can't do Clerk
 * auth, exactly like Google Calendar's "secret address" feeds. Unknown or
 * rotated tokens 404. No write surface; exposes only deadline titles/dates.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const userId = await resolveUserByToken(token);
  if (!userId) {
    return new Response("Calendar not found", { status: 404 });
  }

  const body = await buildUserFeed(userId, new Date());
  return new Response(body, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'inline; filename="studyos.ics"',
      // Calendar clients poll; let them cache briefly to avoid hammering.
      "Cache-Control": "private, max-age=3600",
    },
  });
}
