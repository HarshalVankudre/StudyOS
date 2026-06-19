/**
 * Outbound sandbox boundary: build the read-only workspace snapshot that is
 * handed to an isolated task.
 *
 * The snapshot is re-validated through the Workspace schema, which strips any
 * keys not in the model. The Workspace type carries no ownerId, no database
 * columns, and no secrets, so the sanitized snapshot contains only the user's
 * own content — never another tenant's data or server-side identifiers.
 */
import { safeParseWorkspace } from "@/lib/workspace/schema";
import type { Workspace } from "@/lib/workspace/types";

export function sanitizeWorkspaceForSandbox(workspace: Workspace): string {
  const parsed = safeParseWorkspace(workspace);
  if (!parsed.success) {
    throw new Error("workspace failed validation before sandbox handoff");
  }
  return JSON.stringify(parsed.data);
}
