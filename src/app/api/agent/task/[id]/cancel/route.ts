import { auth } from "@clerk/nextjs/server";
import { cancelTask } from "@/lib/ai/tasks/store";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { getLocale } from "@/lib/i18n/server";

export const runtime = "nodejs";

type Props = { params: Promise<{ id: string }> };

/** Cancel a running, owner-scoped task; the route refuses to apply afterwards. */
export async function POST(_request: Request, { params }: Props) {
  const T = getDictionary(await getLocale());
  const { userId } = await auth();
  if (!userId) {
    return Response.json(
      { error: T.ai.errors.notAuthenticated },
      { status: 401 },
    );
  }
  const { id } = await params;
  const cancelled = await cancelTask(id);
  return Response.json({ cancelled });
}
