import { rejectCrossSite } from "@/lib/http/same-origin";
import { auth } from "@clerk/nextjs/server";
import { z } from "zod";
import { clearChat, loadChat, loadUndoStates } from "@/lib/ai/agent-history";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { getLocale } from "@/lib/i18n/server";
import { reportError } from "@/lib/ops/report-error";

export const runtime = "nodejs";

const workspaceIdSchema = z.string().min(1).max(100);

async function context(request: Request) {
  const T = getDictionary(await getLocale());
  const { userId } = await auth();
  const workspaceId = workspaceIdSchema.safeParse(
    new URL(request.url).searchParams.get("workspaceId"),
  );
  return { T, userId, workspaceId: workspaceId.success ? workspaceId.data : null };
}

/**
 * The agent chat for one workspace (owner-scoped; 404 for a trashed or
 * foreign workspace). `?undo=1` returns only the current undo state of each
 * change in it, for a cheap re-check after the student edits.
 */
export async function GET(request: Request) {
  const { T, userId, workspaceId } = await context(request);
  if (!userId) return Response.json({ error: T.ai.errors.notAuthenticated }, { status: 401 });
  if (!workspaceId) return Response.json({ error: T.ai.errors.invalidAgentRequest }, { status: 400 });
  try {
    if (new URL(request.url).searchParams.get("undo") === "1") {
      const undo = await loadUndoStates(userId, workspaceId);
      if (!undo) return Response.json({ error: T.ai.agent.workspaceNotFound }, { status: 404 });
      return Response.json({ undo });
    }
    const messages = await loadChat(userId, workspaceId);
    if (!messages) return Response.json({ error: T.ai.agent.workspaceNotFound }, { status: 404 });
    return Response.json({ messages });
  } catch (error) {
    reportError(error, { source: "api", route: "/api/agent/history", method: "GET", userId, workspaceId });
    return Response.json({ error: T.ai.agent.error }, { status: 500 });
  }
}

/** Forget the conversation. The workspace itself is not changed. */
export async function DELETE(request: Request) {
  const crossSite = rejectCrossSite(request);
  if (crossSite) return crossSite;
  const { T, userId, workspaceId } = await context(request);
  if (!userId) return Response.json({ error: T.ai.errors.notAuthenticated }, { status: 401 });
  if (!workspaceId) return Response.json({ error: T.ai.errors.invalidAgentRequest }, { status: 400 });
  try {
    const cleared = await clearChat(userId, workspaceId);
    return Response.json({ cleared });
  } catch (error) {
    reportError(error, { source: "api", route: "/api/agent/history", method: "DELETE", userId, workspaceId });
    return Response.json({ error: T.ai.agent.error }, { status: 500 });
  }
}
