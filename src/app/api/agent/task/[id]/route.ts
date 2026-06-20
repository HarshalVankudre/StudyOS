import { auth } from "@clerk/nextjs/server";
import { getTask } from "@/lib/ai/tasks/store";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { getLocale } from "@/lib/i18n/server";

export const runtime = "nodejs";

type Props = { params: Promise<{ id: string }> };

/** Reconnect: return an owner-scoped task's status and (when done) its result. */
export async function GET(_request: Request, { params }: Props) {
  const T = getDictionary(await getLocale());
  const { userId } = await auth();
  if (!userId) {
    return Response.json(
      { error: T.ai.errors.notAuthenticated },
      { status: 401 },
    );
  }
  const { id } = await params;
  const task = await getTask(id);
  if (!task) {
    return Response.json({ error: "Task not found" }, { status: 404 });
  }
  let response: unknown = null;
  if (task.result) {
    try {
      response = JSON.parse(task.result);
    } catch {
      response = null;
    }
  }
  let events: unknown[] = [];
  if (task.events) {
    try {
      events = JSON.parse(task.events) as unknown[];
    } catch {
      events = [];
    }
  }
  return Response.json({ status: task.status, response, events });
}
