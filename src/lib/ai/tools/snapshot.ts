import "server-only";
import { safeParseWorkspace } from "@/lib/workspace/schema";

export function parseSnapshot(json?: string) {
  if (!json) throw new Error("no workspace snapshot");
  const parsed = safeParseWorkspace(JSON.parse(json));
  if (!parsed.success) throw new Error("invalid workspace snapshot");
  return parsed.data;
}
