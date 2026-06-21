import { auth } from "@clerk/nextjs/server";
import { abortActiveTask } from "@/lib/ai/tasks/cancellation";
import { cancelTask, getTask } from "@/lib/ai/tasks/store";
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

  if (cancelled) {
    return Response.json(
      {
        status: "cancelled",
        interrupted: abortActiveTask(id),
      },
      { status: 200 },
    );
  }

  const task = await getTask(id);
  if (!task) {
    return Response.json({ error: "Task not found" }, { status: 404 });
  }

  if (task.status === "cancelled") {
    return Response.json(
      {
        status: "cancelled",
        interrupted: false,
      },
      { status: 200 },
    );
  }

  return Response.json(
    {
      status: "already_finished",
      interrupted: false,
    },
    { status: 200 },
  );
}
