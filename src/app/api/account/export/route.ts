import { auth, currentUser } from "@clerk/nextjs/server";
import { allowDataExport, streamUserDataExport } from "@/lib/account/export-user-data";
import { reportError } from "@/lib/ops/report-error";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * "Download my data": one JSON file with everything StudyOS stores for the
 * user, streamed (workspaces are read a couple at a time as the download is
 * consumed, never all at once).
 */
export async function GET() {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "unauthorized" }, { status: 401 });

  try {
    if (!(await allowDataExport(userId))) {
      return Response.json({ error: "rate_limited" }, { status: 429 });
    }
    const user = await currentUser().catch(() => null);
    const name = [user?.firstName, user?.lastName].filter(Boolean).join(" ") || null;
    const now = new Date();
    const body = await streamUserDataExport(
      userId,
      { email: user?.emailAddresses?.[0]?.emailAddress ?? null, name },
      now,
      // A failure after the download started can only cut it short (the
      // browser reports a failed download); it is still reported here.
      (error) =>
        reportError(error, { source: "api", route: "/api/account/export", method: "GET", userId }),
    );
    const day = now.toISOString().slice(0, 10);
    return new Response(body, {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="studyos-data-${day}.json"`,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    reportError(error, { source: "api", route: "/api/account/export", method: "GET", userId });
    return Response.json({ error: "export_failed" }, { status: 500 });
  }
}
