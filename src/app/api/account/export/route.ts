import { auth, currentUser } from "@clerk/nextjs/server";
import { allowDataExport, buildUserDataExport } from "@/lib/account/export-user-data";
import { reportError } from "@/lib/ops/report-error";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** "Download my data": one JSON file with everything StudyOS stores for the user. */
export async function GET() {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "unauthorized" }, { status: 401 });

  try {
    if (!(await allowDataExport(userId))) {
      return Response.json({ error: "rate_limited" }, { status: 429 });
    }
    const user = await currentUser().catch(() => null);
    const name = [user?.firstName, user?.lastName].filter(Boolean).join(" ") || null;
    const data = await buildUserDataExport(userId, {
      email: user?.emailAddresses?.[0]?.emailAddress ?? null,
      name,
    });
    const day = data.exportedAt.slice(0, 10);
    return new Response(JSON.stringify(data, null, 2), {
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
