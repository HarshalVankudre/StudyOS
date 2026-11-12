import { auth } from "@clerk/nextjs/server";
import { z } from "zod";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { getLocale } from "@/lib/i18n/server";
import { reportError } from "@/lib/ops/report-error";
import {
  WorkspaceChangeUnavailableError,
  WorkspaceNotFoundError,
  undoAgentWorkspaceChange,
} from "@/lib/workspace/version-service";

export const runtime = "nodejs";

const requestSchema = z.object({
  changeId: z.string().min(1).max(100),
});

export async function POST(request: Request) {
  const T = getDictionary(await getLocale());
  const { userId } = await auth();
  if (!userId) {
    return Response.json(
      { error: T.ai.errors.notAuthenticated },
      { status: 401 },
    );
  }
  const parsed = requestSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) {
    return Response.json(
      { error: T.ai.errors.invalidAgentRequest },
      { status: 400 },
    );
  }

  try {
    const result = await undoAgentWorkspaceChange(parsed.data.changeId);
    return Response.json({
      workspace: result.workspace,
      version: result.version,
      changeId: result.changeId,
    });
  } catch (error) {
    if (error instanceof WorkspaceNotFoundError) {
      return Response.json(
        { error: T.ai.agent.workspaceNotFound },
        { status: 404 },
      );
    }
    if (error instanceof WorkspaceChangeUnavailableError) {
      return Response.json(
        { error: T.ai.agent.undoUnavailable },
        { status: 409 },
      );
    }
    reportError(error, { source: "api", route: "/api/agent/undo", method: "POST", userId });
    return Response.json(
      { error: T.ai.agent.error },
      { status: 500 },
    );
  }
}
